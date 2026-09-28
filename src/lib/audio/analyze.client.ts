/**
 * Browser-only audio analysis using Essentia.js WASM.
 * Safe to import in client components — does NOT pull in audio-decode/music-tempo.
 *
 * Two entry points:
 *   - `analyzeAudio(file)`         → during upload (we already have the File)
 *   - `analyzeAudioFromUrl(url)`   → for Re-analyze on existing tracks
 *
 * Both share a single Essentia pipeline. The server route at
 * /api/tracks/[id]/analyze prioritizes client-provided features over its
 * own server-side decode — Essentia in the browser is more accurate than
 * the Node-side music-tempo / Krumhansl heuristics, so this is the
 * preferred path when the browser can read the audio.
 *
 * When the browser can't decode (CORS / unsupported codec / very large
 * file), the caller falls back to the server endpoint without features
 * and lets the server's pipeline take a swing.
 */

import {
  EMPTY_ESSENTIA_FEATURES,
  ESSENTIA_SAMPLE_RATE,
  analysisWindow,
  downmix,
  extractEssentiaFeatures,
  type EssentiaCore,
  type EssentiaFeatures,
} from './essentia-extract';

export interface AudioFeatures {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  /**
   * Always null from the browser. Integrated loudness is a whole-file measure
   * and the browser analyses a 60 s excerpt, so the server's full-file value
   * (merge falls through to it) is the only honest one.
   */
  loudness: number | null;
  duration: number | null;
  /** Essentia's own confidence, 0–5.32. See `RELIABLE_BPM_CONFIDENCE`. */
  bpmConfidence?: number | null;
  /** Essentia's key strength, 0–1. See `RELIABLE_KEY_STRENGTH`. */
  keyStrength?: number | null;
}

const EMPTY: AudioFeatures = { bpm: null, key: null, scale: null, loudness: null, duration: null };

/** A worker that has not answered in this long is abandoned for the main-thread path. */
const WORKER_TIMEOUT_MS = 45_000;

export async function analyzeAudio(file: File): Promise<AudioFeatures> {
  if (typeof window === 'undefined') return { ...EMPTY };
  return runEssentia(await file.arrayBuffer());
}

/**
 * Fetch an audio URL and analyze it in the browser. We route through the
 * same-origin /api/audio proxy so cross-origin R2 URLs don't trip CORS,
 * and so any signed-URL logic on the server (presigning, allowlist) is
 * applied transparently.
 */
export async function analyzeAudioFromUrl(rawUrl: string): Promise<AudioFeatures> {
  if (typeof window === 'undefined') return { ...EMPTY };

  // Same-origin local paths go direct; everything else proxies through
  // /api/audio so we never have to fight R2 CORS in the browser.
  const url = rawUrl.startsWith('/')
    ? rawUrl
    : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Audio fetch for analysis failed:', err);
    return { ...EMPTY };
  }
  return runEssentia(buffer);
}

async function runEssentia(buffer: ArrayBuffer): Promise<AudioFeatures> {
  // Decode AND resample in one step: an OfflineAudioContext decodes to its own
  // rate. A plain AudioContext decodes at the device rate (usually 48 kHz),
  // and Essentia's extractors assume 44.1 kHz — at 48 kHz a 140 BPM F-minor
  // beat reads as 128.6 BPM C major.
  let mono: Float32Array;
  let duration: number;
  try {
    const ctx = new OfflineAudioContext(1, 1, ESSENTIA_SAMPLE_RATE);
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    duration = Math.round(decoded.duration);
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    mono = downmix(channels);
  } catch (err) {
    console.warn('Audio decode for analysis failed:', err);
    return { ...EMPTY };
  }

  // Only the analysed window crosses to the worker; it is transferred, not copied.
  const { start, end } = analysisWindow(mono.length);
  const excerpt = mono.slice(start, end);

  let features: EssentiaFeatures;
  try {
    features = await runEssentiaInWorker(excerpt.slice());
  } catch (err) {
    console.warn('Essentia worker failed, analysing on the main thread:', err);
    try {
      features = await runEssentiaOnMainThread(excerpt);
    } catch (fallbackErr) {
      console.warn('Essentia failed on the main thread too:', fallbackErr);
      features = { ...EMPTY_ESSENTIA_FEATURES };
    }
  }

  return {
    bpm: features.bpm,
    key: features.key,
    scale: features.scale,
    loudness: null,
    duration,
    bpmConfidence: features.bpmConfidence,
    keyStrength: features.keyStrength,
  };
}

let mainThreadEssentia: EssentiaCore | null = null;

async function runEssentiaOnMainThread(signal: Float32Array): Promise<EssentiaFeatures> {
  if (!mainThreadEssentia) {
    const [{ EssentiaWASM }, { default: Essentia }] = await Promise.all([
      import('essentia.js/dist/essentia-wasm.es.js'),
      import('essentia.js/dist/essentia.js-core.es.js'),
    ]);
    mainThreadEssentia = new Essentia(EssentiaWASM) as unknown as EssentiaCore;
  }
  return extractEssentiaFeatures(mainThreadEssentia, signal);
}

let worker: Worker | null = null;

/**
 * Same-origin URLs for the classic worker and the two essentia.js UMD builds
 * it loads. The bundler copies each `new URL(…, import.meta.url)` target into
 * /_next/static/media verbatim — see the header of `essentia.worker.js`.
 */
const ESSENTIA_WORKER_URL = () => new URL('./essentia.worker.js', import.meta.url);
const ESSENTIA_WASM_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia-wasm.umd.js', import.meta.url).href;
const ESSENTIA_CORE_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia.js-core.umd.js', import.meta.url).href;

function createEssentiaWorker(): Worker {
  return new Worker(ESSENTIA_WORKER_URL());
}
let nextId = 0;

function runEssentiaInWorker(signal: Float32Array): Promise<EssentiaFeatures> {
  return new Promise((resolve, reject) => {
    try {
      worker ??= createEssentiaWorker();
    } catch (err) {
      reject(err);
      return;
    }
    const w = worker;
    const id = ++nextId;
    const cleanup = () => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; features?: EssentiaFeatures; error?: string }>) => {
      if (e.data?.id !== id) return;
      cleanup();
      if (e.data.ok && e.data.features) resolve(e.data.features);
      else reject(new Error(e.data.error || 'Essentia worker error'));
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      // A worker that failed to load stays broken; drop it so the next file retries.
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'Essentia worker failed to load'));
    };
    const timer = setTimeout(() => {
      cleanup();
      worker?.terminate();
      worker = null;
      reject(new Error('Essentia worker timed out'));
    }, WORKER_TIMEOUT_MS);
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, wasmUrl: ESSENTIA_WASM_URL(), coreUrl: ESSENTIA_CORE_URL(), signal }, [signal.buffer]);
  });
}
