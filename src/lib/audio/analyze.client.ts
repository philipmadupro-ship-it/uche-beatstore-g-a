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

import { decodeMono44k, runEssentiaTask } from './essentia-worker-client';
import {
  EMPTY_ESSENTIA_FEATURES,
  analysisWindow,
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
  let mono: Float32Array;
  let duration: number;
  try {
    ({ mono, duration } = await decodeMono44k(buffer));
  } catch (err) {
    console.warn('Audio decode for analysis failed:', err);
    return { ...EMPTY };
  }

  // Only the analysed window crosses to the worker; it is transferred, not copied.
  const { start, end } = analysisWindow(mono.length);
  const excerpt = mono.slice(start, end);

  let features: EssentiaFeatures;
  try {
    features = await runEssentiaTask('features', excerpt.slice(), WORKER_TIMEOUT_MS);
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
