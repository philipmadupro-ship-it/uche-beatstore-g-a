/**
 * Server-side waveform peak extraction.
 *
 * WHY: WaveSurfer.js otherwise re-decodes the entire audio file in the
 * browser to render the waveform — that's the chief reason the player
 * feels heavy on long tracks. Precomputing peaks at upload + serving
 * them as a tiny JSON sidecar lets WaveSurfer skip the decode entirely
 * and draw the waveform from the cached numbers.
 *
 * The format is intentionally minimal: a single normalized channel of
 * `length` samples in -1..1. WaveSurfer renders fine from that, the
 * file gzips down to a few KB, and there's no schema versioning game.
 *
 * NEVER import this from a client component — it pulls in audio-decode.
 */

import 'server-only';

export interface PeaksFile {
  /** Bumped if we ever change the layout. Consumers can ignore unknown versions. */
  version: 1;
  /** Total samples in the peaks array. Always === peaks.length. */
  length: number;
  /** Audio duration in seconds. WaveSurfer needs this when peaks are pre-supplied. */
  duration: number;
  /** Min/max normalized to -1..1. Single (mixed-down) channel. */
  peaks: number[];
}

/**
 * Default resolution. 1000 samples renders cleanly across any waveform
 * width up to a few thousand pixels and keeps the JSON ~8KB after JSON
 * encoding. Lower if you want to save more bytes; higher if you have
 * hi-DPI 5K displays to feed.
 */
export const DEFAULT_PEAK_LENGTH = 1000;

/**
 * Decode an audio buffer (MP3/WAV/FLAC/OGG/AAC via audio-decode) and
 * return a `PeaksFile`. On any decoder failure returns null — callers
 * should treat peaks as best-effort, not a hard requirement.
 */
export async function extractPeaks(
  buffer: Buffer,
  length = DEFAULT_PEAK_LENGTH,
): Promise<PeaksFile | null> {
  try {
    const decode = (await import('audio-decode')).default as (
      b: Buffer,
    ) => Promise<{
      // v3 shape
      channelData?: Float32Array[];
      // v2 fallback
      getChannelData?: (i: number) => Float32Array;
      _channelData?: Float32Array[];
      sampleRate?: number;
      duration?: number;
      numberOfChannels?: number;
      length?: number;
    }>;
    const audioBuffer = await decode(buffer);

    // Mix down to mono. We average channels rather than just taking [0] so
    // tracks that put the kick on one side and the snare on the other
    // still render a representative waveform.
    const channels: Float32Array[] = [];
    if (audioBuffer.channelData && audioBuffer.channelData.length > 0) {
      // v3
      channels.push(...audioBuffer.channelData);
    } else {
      const channelCount = audioBuffer.numberOfChannels ?? 1;
      for (let c = 0; c < channelCount; c++) {
        const ch = audioBuffer.getChannelData
          ? audioBuffer.getChannelData(c)
          : audioBuffer._channelData?.[c];
        if (ch) channels.push(ch);
      }
    }
    if (channels.length === 0) return null;

    const total = channels[0].length;
    if (!total || !isFinite(total)) return null;

    const sampleRate = audioBuffer.sampleRate ?? 44100;
    const duration = audioBuffer.duration ?? total / sampleRate;

    const peaks = computePeaks(channels, total, length);
    return {
      version: 1,
      length: peaks.length,
      duration: +duration.toFixed(3),
      peaks,
    };
  } catch (err) {
    console.warn('extractPeaks failed:', err);
    return null;
  }
}

/**
 * Bucket the channel data into `length` peaks. Each output sample is the
 * absolute-max amplitude in its bucket — that's the convention WaveSurfer
 * uses for single-channel waveform display, and it preserves transients
 * (drums, vocal sibilance) that an averaged RMS would smooth away.
 */
function computePeaks(
  channels: Float32Array[],
  totalSamples: number,
  outLength: number,
): number[] {
  const bucket = totalSamples / outLength;
  const out = new Array<number>(outLength);

  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(totalSamples, Math.floor((i + 1) * bucket));
    let peak = 0;

    // Mono mix on the fly — avoids allocating a mixed buffer.
    for (let s = start; s < end; s++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][s] || 0;
      const v = Math.abs(sum / channels.length);
      if (v > peak) peak = v;
    }

    // Round to 3 decimals — keeps the JSON small without any visible
    // difference at typical waveform render sizes.
    out[i] = Math.round(peak * 1000) / 1000;
  }

  return out;
}
