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

import { extractBandEnergies, mixToMono, sliceRms } from './band-filter';
import { detectPitchSeries, rmsToDb } from './pitch';

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
 * Spectral sidecar for the beat preview player — written to a SEPARATE object
 * key from the peaks file, deliberately.
 *
 * Peaks sidecars are uploaded `Cache-Control: immutable, max-age=31536000`, so
 * editing them in place would leave up to a year of stale CDN copies. A new key
 * sidesteps that entirely, and keeps amplitude-only consumers (MiniWaveform,
 * /embed) off a payload three times the size they need.
 */
export interface BandsFile {
  version: 2;
  /** Number of entries in every array below. */
  slices: number;
  duration: number;
  /** Per-slice RMS energy per frequency band; drives the waveform colouring. */
  low: number[];
  mid: number[];
  high: number[];
  /** Per-slice level in dBFS, for the readout. */
  db: number[];
  /** Per-slice dominant frequency in Hz; null where the audio has no pitch. */
  hz: (number | null)[];
}

/**
 * Resolution of the spectral sidecar.
 *
 * 512 is the resolution the client already cached at, so colours are unchanged.
 * Pitch is computed at a quarter of that (see BANDS_PITCH_SLICES): autocorrelation
 * is the expensive part, and a readout does not need sub-second pitch resolution.
 */
export const BANDS_SLICES = 512;
export const BANDS_PITCH_SLICES = 128;

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
  const decoded = await decodeChannels(buffer);
  if (!decoded) return null;
  const peaks = computePeaks(decoded.channels, decoded.total, length);
  return {
    version: 1,
    length: peaks.length,
    duration: +decoded.duration.toFixed(3),
    peaks,
  };
}

interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  total: number;
}

/**
 * Decode to raw channel data. Extracted so peaks and bands can share one
 * decode; previously this was inlined in `extractPeaks`.
 */
async function decodeChannels(buffer: Buffer): Promise<DecodedAudio | null> {
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

    return { channels, sampleRate, duration, total };
  } catch (err) {
    console.warn('audio decode failed:', err);
    return null;
  }
}

/**
 * Decode once, return BOTH the amplitude peaks and the spectral bands.
 *
 * Sharing the decode matters: `audio-decode` on a full master is by far the
 * most expensive step, and the write paths run inside functions with a 60s
 * (single) / 300s (batch) ceiling. Calling `extractPeaks` and then a separate
 * band extractor would double that cost for no benefit.
 *
 * Both halves are independently best-effort — a decode failure yields nulls,
 * and a band-analysis failure still returns usable peaks rather than losing the
 * waveform entirely.
 */
export async function extractPeaksAndBands(
  buffer: Buffer,
  length = DEFAULT_PEAK_LENGTH,
): Promise<{ peaks: PeaksFile | null; bands: BandsFile | null }> {
  const decoded = await decodeChannels(buffer);
  if (!decoded) return { peaks: null, bands: null };

  const { channels, sampleRate, duration, total } = decoded;

  const peaks: PeaksFile = {
    version: 1,
    length,
    duration: +duration.toFixed(3),
    peaks: computePeaks(channels, total, length),
  };
  peaks.length = peaks.peaks.length;

  let bands: BandsFile | null = null;
  try {
    const mono = mixToMono(channels);
    const energies = extractBandEnergies(mono, sampleRate, BANDS_SLICES);

    // Level per slice comes from the *unfiltered* mono signal — the readout
    // should report what you hear, not the energy of one band.
    const levelRms = sliceRms(mono, BANDS_SLICES);
    const db = levelRms.map(rmsToDb);

    // Pitch at lower resolution, then stretched to match the band arrays so
    // every array in the file shares one index space and the client can look
    // up all four values with a single slice index.
    const coarsePitch = detectPitchSeries(mono, sampleRate, BANDS_PITCH_SLICES);
    const hz = stretchNullable(coarsePitch, BANDS_SLICES);

    bands = {
      version: 2,
      slices: BANDS_SLICES,
      duration: +duration.toFixed(3),
      low: energies.low,
      mid: energies.mid,
      high: energies.high,
      db,
      hz,
    };
  } catch (err) {
    // Losing colour is survivable; losing the waveform is not.
    console.warn('extractBands failed, peaks still returned:', err);
  }

  return { peaks, bands };
}

/** Nearest-neighbour stretch of a sparse series onto a denser index space. */
function stretchNullable(values: (number | null)[], target: number): (number | null)[] {
  if (values.length === 0) return new Array<number | null>(target).fill(null);
  if (values.length === target) return values.slice();
  const out = new Array<number | null>(target);
  for (let i = 0; i < target; i++) {
    out[i] = values[Math.min(values.length - 1, Math.floor((i * values.length) / target))];
  }
  return out;
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
