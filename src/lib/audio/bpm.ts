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
    const decodeMod = await import('audio-decode');
    const decode = (decodeMod as any).default ?? (decodeMod as any).decodeAudio;
    if (typeof decode !== 'function') {
      console.warn('[bpm] audio-decode export not a function', Object.keys(decodeMod));
      return null;
    }

    // audio-decode v3 returns { channelData: Float32Array[], sampleRate }
    // — no getChannelData, no length, no duration. Normalise to the
    // older AudioBuffer-like shape so the rest of the code reads naturally.
    let raw: {
      channelData?: Float32Array[];
      sampleRate?: number;
      // v2 fallback fields
      getChannelData?: (ch: number) => Float32Array;
      numberOfChannels?: number;
      length?: number;
      duration?: number;
    } | null = null;
    try {
      raw = await decode(buffer);
    } catch (decodeErr) {
      console.warn('[bpm] audio-decode threw:', (decodeErr as Error)?.message);
      return null;
    }
    if (!raw) return null;

    let left: Float32Array | undefined;
    let right: Float32Array | undefined;
    let sampleRate: number;
    let length: number;
    if (raw.channelData && raw.channelData.length > 0) {
      left = raw.channelData[0];
      right = raw.channelData[1] ?? left;
      sampleRate = raw.sampleRate ?? 44100;
      length = left?.length ?? 0;
    } else if (typeof raw.getChannelData === 'function') {
      left = raw.getChannelData(0);
      right = (raw.numberOfChannels ?? 1) > 1 ? raw.getChannelData(1) : left;
      sampleRate = raw.sampleRate ?? 44100;
      length = raw.length ?? left?.length ?? 0;
    } else {
      console.warn('[bpm] decoded audio has no channel data', Object.keys(raw));
      return null;
    }
    if (!left || length === 0) {
      console.warn('[bpm] empty left channel');
      return null;
    }
    const rightChan = right ?? left;
    const duration = length / sampleRate;

    // Mix to mono so music-tempo gets one channel.
    const downLen = Math.floor(length / SAMPLE_DOWN);
    const mono = new Float32Array(downLen);
    for (let i = 0; i < downLen; i++) {
      const j = i * SAMPLE_DOWN;
      mono[i] = ((left[j] ?? 0) + (rightChan[j] ?? 0)) * 0.5;
    }

    const MusicTempoMod = await import('music-tempo');
    const MusicTempo = ((MusicTempoMod as any).default ?? MusicTempoMod) as new (
      input: Float32Array | number[],
    ) => MusicTempoResult;
    let result: MusicTempoResult;
    try {
      result = new MusicTempo(Array.from(mono));
    } catch (tempoErr) {
      console.warn('[bpm] music-tempo threw:', (tempoErr as Error)?.message);
      return null;
    }
    // music-tempo returns tempo as a string ("182.764") in v1.x — coerce
    // before treating it as a number.
    const rawTempo = Number(result?.tempo);
    if (!Number.isFinite(rawTempo) || rawTempo <= 0) {
      console.warn('[bpm] music-tempo returned non-finite tempo:', result?.tempo);
      return null;
    }

    // music-tempo sometimes returns half/double-time on shorter clips.
    // Clamp into the 60–200 BPM range that covers ~all useful music.
    let bpm = rawTempo;
    while (bpm < 60) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    bpm = Math.round(bpm);

    return { bpm, duration };
  } catch (err) {
    console.warn('[bpm] unexpected:', (err as Error)?.message);
    return null;
  }
}
