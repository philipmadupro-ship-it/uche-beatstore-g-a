/**
 * Browser-only chord detection, run off the main thread in the shared
 * same-origin Essentia worker: Essentia HPCP chroma blended with Spotify
 * basic-pitch note activations (tfjs, WASM backend), matched against 24
 * major/minor triad templates.
 *
 * Output: an ordered array of { time, chord } segments where `chord` is a
 * label like "C", "Am", "F#m" (or "N" for silence / no confident chord).
 * Adjacent identical chords are merged so the timeline is compact.
 *
 * On 40 GuitarSet comping takes (real acoustic guitar, lead-sheet chords
 * reduced to triads) HPCP alone labelled 52.7% of seconds correctly, basic-pitch
 * alone 72.3%, and the blend 77.2%; see docs/codex-execution-log.md (AUDIO-06).
 * If basic-pitch cannot load or run, the result is HPCP alone.
 *
 * The algorithm lives in `chord-extract.ts` + `basic-pitch.ts` (tested against
 * the real packages); `essentia.worker.js` carries their copy. This file used
 * to carry its own inline worker, which `importScripts`-ed essentia.js from
 * jsDelivr (not in the CSP) and then called an API the package does not have,
 * so it resolved `[]` every time.
 */
import {
  basicPitchAssets, decodeMono44k, decodeMonoAt, runEssentiaTask, type ChordResult,
} from './essentia-worker-client';
import { BASIC_PITCH_SAMPLE_RATE } from './basic-pitch';
import type { ChordSegment } from './chord-extract';

export type { ChordSegment } from './chord-extract';
export type { ChordEngine } from './essentia-worker-client';

export interface ChordDetection {
  chords: ChordSegment[];
  engine: ChordResult['engine'] | null;
}

/**
 * HPCP takes ≈3.3 s per 3 minutes in Node and basic-pitch on the WASM backend
 * runs ~9x faster than realtime, so a long track finishes well inside this; it
 * only stops a hung worker from leaving the caller waiting forever.
 */
const CHORD_TIMEOUT_MS = 180_000;

export async function detectChordsFromUrl(rawUrl: string): Promise<ChordSegment[]> {
  return (await detectChordsWithEngine(rawUrl)).chords;
}

/** As `detectChordsFromUrl`, and says which analysis produced the timeline. */
export async function detectChordsWithEngine(rawUrl: string): Promise<ChordDetection> {
  const none: ChordDetection = { chords: [], engine: null };
  if (typeof window === 'undefined') return none;

  const url = rawUrl.startsWith('/') ? rawUrl : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Chord detection: audio fetch failed', err);
    return none;
  }

  let mono44k: Float32Array;
  try {
    mono44k = (await decodeMono44k(buffer)).mono;
  } catch (err) {
    console.warn('Chord detection: decode failed', err);
    return none;
  }
  // basic-pitch wants 22.05 kHz; decoding again is cheaper than resampling in JS.
  let mono22k: Float32Array | null = null;
  try {
    mono22k = (await decodeMonoAt(buffer, BASIC_PITCH_SAMPLE_RATE)).mono;
  } catch (err) {
    console.warn('Chord detection: 22.05 kHz decode failed; using HPCP alone', err);
  }

  try {
    const result = await runEssentiaTask(
      'chords',
      mono44k,
      CHORD_TIMEOUT_MS,
      mono22k ? { signal: mono22k, ...basicPitchAssets() } : undefined,
    );
    if (result.basicPitchError) console.warn('basic-pitch unavailable; chords from HPCP alone:', result.basicPitchError);
    return { chords: result.chords, engine: result.engine };
  } catch (err) {
    console.warn('Chord detection failed', err);
    return none;
  }
}
