/**
 * Browser-only chord detection: Essentia HPCP chroma + 24 triad templates,
 * run off the main thread in the shared same-origin Essentia worker.
 *
 * Output: an ordered array of { time, chord } segments where `chord` is a
 * label like "C", "Am", "F#m" (or "N" for silence / no confident chord).
 * Adjacent identical chords are merged so the timeline is compact.
 *
 * The algorithm lives in `chord-extract.ts` (tested against the real
 * package). This file used to carry its own inline worker, which
 * `importScripts`-ed essentia.js from jsDelivr (not in the CSP) and then
 * called an API the package does not have, so it resolved `[]` every time —
 * the same broken loader BPM/key analysis had until AUDIO-04.
 */
import { decodeMono44k, runEssentiaTask } from './essentia-worker-client';
import type { ChordSegment } from './chord-extract';

export type { ChordSegment } from './chord-extract';

/**
 * A full-length track takes a few seconds (≈3.3 s per 3 minutes in Node); this
 * only stops a hung worker from leaving the caller waiting forever.
 */
const CHORD_TIMEOUT_MS = 120_000;

export async function detectChordsFromUrl(rawUrl: string): Promise<ChordSegment[]> {
  if (typeof window === 'undefined') return [];

  const url = rawUrl.startsWith('/') ? rawUrl : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Chord detection: audio fetch failed', err);
    return [];
  }

  try {
    const { mono } = await decodeMono44k(buffer);
    return await runEssentiaTask('chords', mono, CHORD_TIMEOUT_MS);
  } catch (err) {
    console.warn('Chord detection failed', err);
    return [];
  }
}
