/**
 * The one place Essentia.js is called for BPM + key.
 *
 * It has no browser APIs in it, so the worker (`essentia.worker.ts`), the
 * main-thread fallback in `analyze.client.ts` and the Vitest suite all run
 * this exact code against the real package.
 *
 * Two things about essentia.js 0.1.3 that the previous copies got wrong, and
 * which together meant client-side analysis never returned a BPM or key:
 *
 *   1. `EssentiaWASM` is the already-instantiated WASM MODULE, not a factory,
 *      and the algorithms (`RhythmExtractor2013`, `KeyExtractor`) live on the
 *      `Essentia` core class that wraps it — `new Essentia(EssentiaWASM)`.
 *      Calling them on the module, or looking for `EssentiaWASM.EssentiaWASM`,
 *      throws, and the old code swallowed that and shipped duration only.
 *   2. Both extractors assume 44.1 kHz and take no sample-rate argument. A
 *      browser decodes at the device rate (usually 48 kHz), and fed 48 kHz
 *      audio Essentia reports a 140 BPM F-minor beat as 128.6 BPM C major.
 *      Callers must resample to `ESSENTIA_SAMPLE_RATE` first.
 *
 * Essentia.js is AGPL-3.0. See docs/codex-execution-log.md (AUDIO-04).
 */

export const ESSENTIA_SAMPLE_RATE = 44100;

/** Longest stretch analysed. Tempo and key are stable well inside a minute; the whole file costs ~4 s per minute. */
export const ANALYSIS_WINDOW_SECONDS = 60;

/**
 * `RhythmExtractor2013` (multifeature) reports confidence on 0–5.32. Essentia
 * documents above 3.5 as reliable and below 1.5 as poor.
 */
export const RELIABLE_BPM_CONFIDENCE = 3.5;
/** `KeyExtractor` strength is 0–1; below this the key profile barely beat the runner-up. */
export const RELIABLE_KEY_STRENGTH = 0.6;

/** The subset of the `Essentia` core class this module uses. */
export interface EssentiaCore {
  arrayToVector(input: Float32Array): unknown;
  RhythmExtractor2013(signal: unknown): { bpm: number; confidence: number };
  KeyExtractor(signal: unknown): { key?: string | null; scale?: string | null; strength?: number };
}

export interface EssentiaFeatures {
  bpm: number | null;
  /** 0–5.32, see `RELIABLE_BPM_CONFIDENCE`. */
  bpmConfidence: number | null;
  key: string | null;
  scale: 'major' | 'minor' | null;
  /** 0–1, see `RELIABLE_KEY_STRENGTH`. */
  keyStrength: number | null;
}

export const EMPTY_ESSENTIA_FEATURES: EssentiaFeatures = {
  bpm: null, bpmConfidence: null, key: null, scale: null, keyStrength: null,
};

/**
 * The slice of a 44.1 kHz signal to analyse: the middle `ANALYSIS_WINDOW_SECONDS`,
 * which skips a sparse intro and outro, or the whole thing when shorter.
 */
export function analysisWindow(length: number, sampleRate = ESSENTIA_SAMPLE_RATE): { start: number; end: number } {
  const window = Math.round(ANALYSIS_WINDOW_SECONDS * sampleRate);
  if (length <= window) return { start: 0, end: length };
  const start = Math.floor((length - window) / 2);
  return { start, end: start + window };
}

/** Average every channel into one. Channel 0 alone drops anything panned right. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  }
  return out;
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Run tempo + key on a mono signal that is ALREADY at 44.1 kHz.
 *
 * A value Essentia cannot stand behind comes back null rather than as a
 * number: a BPM of 0 or NaN from silence, or a key with no scale.
 */
export function extractEssentiaFeatures(essentia: EssentiaCore, mono44k: Float32Array): EssentiaFeatures {
  if (mono44k.length < ESSENTIA_SAMPLE_RATE * 2) return { ...EMPTY_ESSENTIA_FEATURES };
  const { start, end } = analysisWindow(mono44k.length);
  const signal = essentia.arrayToVector(mono44k.subarray(start, end));

  const rhythm = essentia.RhythmExtractor2013(signal);
  const rawBpm = finite(rhythm.bpm);
  const bpm = rawBpm != null && rawBpm >= 30 && rawBpm <= 300 ? Math.round(rawBpm * 10) / 10 : null;

  const keyData = essentia.KeyExtractor(signal);
  const scale = keyData.scale === 'major' || keyData.scale === 'minor' ? keyData.scale : null;
  const key = keyData.key && scale ? keyData.key : null;

  return {
    bpm,
    bpmConfidence: bpm != null ? finite(rhythm.confidence) : null,
    key,
    scale: key ? scale : null,
    keyStrength: key ? finite(keyData.strength) : null,
  };
}
