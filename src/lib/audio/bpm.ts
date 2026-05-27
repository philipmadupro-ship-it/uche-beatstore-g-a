/**
 * Server-side BPM estimator.
 *
 * Decodes the audio buffer via audio-decode (same lib we use for
 * peaks extraction) then runs music-tempo on the mixed-down mono
 * samples. Returns null on any decoder/tempo failure — callers
 * should treat the result as best-effort.
 *
 * The Type for music-tempo's class is loose so we declare it ourselves
 * rather than pulling its bundled @types.
 */

interface MusicTempoResult {
  tempo: number;
  beats?: number[];
}

export interface BpmResult {
  bpm: number;
  /** Total decoded duration in seconds. */
  duration: number;
}

const SAMPLE_DOWN = 4; // music-tempo handles ~5-10 sec at 44.1k just fine; we downsample to lower cost on long clips

export async function estimateBpm(buffer: Buffer): Promise<BpmResult | null> {
  try {
    const decode = (await import('audio-decode')).default as (
      b: Buffer,
    ) => Promise<{
      length: number;
      duration: number;
      numberOfChannels: number;
      sampleRate: number;
      getChannelData: (ch: number) => Float32Array;
    }>;
    const audio = await decode(buffer);
    if (!audio || !audio.length) return null;

    // Mix to mono so music-tempo gets one channel.
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
    const downLen = Math.floor(audio.length / SAMPLE_DOWN);
    const mono = new Float32Array(downLen);
    for (let i = 0; i < downLen; i++) {
      const j = i * SAMPLE_DOWN;
      mono[i] = (left[j]! + right[j]!) * 0.5;
    }

    const MusicTempo = (await import('music-tempo')).default as new (
      input: Float32Array | number[],
    ) => MusicTempoResult;
    const result = new MusicTempo(Array.from(mono));
    if (!result || !Number.isFinite(result.tempo)) return null;

    // music-tempo sometimes returns half/double-time on shorter clips.
    // Clamp into the 60–200 BPM range that covers ~all useful music.
    let bpm = result.tempo;
    while (bpm < 60) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    bpm = Math.round(bpm);

    return { bpm, duration: audio.duration };
  } catch {
    return null;
  }
}
