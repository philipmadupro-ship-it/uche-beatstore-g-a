/**
 * Chord timeline from Essentia HPCP chroma + 24 triad templates.
 *
 * The algorithm is the one `chords.client.ts` always meant to run (4096/2048
 * frames, HPCP chroma, 1 s buckets, binary major/minor templates, a 0.45
 * energy-share floor below which a bucket is `N`); what changes is that it now
 * RUNS. The old worker `importScripts`-ed essentia.js from jsDelivr, looked for
 * an `EssentiaWASM` global that file never defines and called it as a factory
 * — the same broken loader BPM/key analysis had until AUDIO-04 — so every
 * detection threw inside the worker and resolved `[]`.
 *
 * It has no browser APIs, so `essentia.worker.js` (a copy — see its header),
 * the tests and any future caller share it. The input must be mono at
 * `ESSENTIA_SAMPLE_RATE`: HPCP defaults to 44.1 kHz and the old code handed
 * `SpectralPeaks` the device rate (usually 48 kHz), so the two disagreed about
 * what frequency every bin was.
 */
import { ESSENTIA_SAMPLE_RATE } from './essentia-extract';

export interface ChordSegment {
  time: number;
  chord: string;
}

/** The framewise algorithms this uses, as the `Essentia` core class exposes them. */
export interface EssentiaChordCore {
  arrayToVector(input: Float32Array): unknown;
  Windowing(frame: unknown, normalized: boolean, size: number, type: string): { frame: unknown };
  Spectrum(frame: unknown, size?: number): { spectrum: unknown };
  SpectralPeaks(
    spectrum: unknown, magnitudeThreshold: number, maxFrequency: number, maxPeaks: number,
    minFrequency: number, orderBy: string, sampleRate: number,
  ): { frequencies: unknown; magnitudes: unknown };
  HPCP(frequencies: unknown, magnitudes: unknown): { hpcp: unknown };
  vectorToArray(v: unknown): Float32Array;
}

export const CHORD_FRAME_SIZE = 4096;
export const CHORD_HOP_SIZE = 2048;
export const CHORD_BUCKET_SECONDS = 1;
/** Share of a bucket's chroma energy the best triad must carry, or the bucket is `N`. */
export const CHORD_MIN_SCORE = 0.45;

/** HPCP bin 0 is the reference pitch, A at 440 Hz. */
export const HPCP_PITCH_CLASSES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'] as const;

interface Template { label: string; v: number[] }

export function chordTemplates(): Template[] {
  const out: Template[] = [];
  for (let root = 0; root < 12; root++) {
    const maj = new Array(12).fill(0);
    maj[root] = 1; maj[(root + 4) % 12] = 1; maj[(root + 7) % 12] = 1;
    out.push({ label: HPCP_PITCH_CLASSES[root], v: maj });
    const min = new Array(12).fill(0);
    min[root] = 1; min[(root + 3) % 12] = 1; min[(root + 7) % 12] = 1;
    out.push({ label: `${HPCP_PITCH_CLASSES[root]}m`, v: min });
  }
  return out;
}

/** Best triad for a 12-bin chroma, or `N` when silent or no triad dominates. */
export function classifyChroma(chroma: ArrayLike<number>, templates = chordTemplates()): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i] || 0;
  if (sum < 1e-6) return 'N';
  let best = 'N';
  let bestScore = -1;
  for (const t of templates) {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += ((chroma[i] || 0) / sum) * t.v[i];
    if (dot > bestScore) { bestScore = dot; best = t.label; }
  }
  return bestScore < CHORD_MIN_SCORE ? 'N' : best;
}

/**
 * Sum framewise chroma into `CHORD_BUCKET_SECONDS` buckets, label each (a
 * silent one is `N`), merge runs of the same chord, and trim leading/trailing `N`.
 */
export function segmentChords(frames: Array<{ time: number; chroma: ArrayLike<number> }>): ChordSegment[] {
  const templates = chordTemplates();
  const segments: ChordSegment[] = [];
  let bucket = -1;
  let bucketTime = 0;
  let acc = new Array(12).fill(0);
  // A silent bucket is `N`, not skipped: skipping it made the chord before a
  // break read as ringing on through the silence.
  const flush = () => {
    if (bucket >= 0) segments.push({ time: +bucketTime.toFixed(2), chord: classifyChroma(acc, templates) });
  };
  for (const f of frames) {
    const b = Math.floor(f.time / CHORD_BUCKET_SECONDS);
    if (b !== bucket) {
      flush();
      bucket = b;
      bucketTime = f.time;
      acc = new Array(12).fill(0);
    }
    for (let j = 0; j < 12; j++) acc[j] += f.chroma[j] || 0;
  }
  flush();

  const merged: ChordSegment[] = [];
  for (const s of segments) {
    if (merged.length && merged[merged.length - 1].chord === s.chord) continue;
    merged.push(s);
  }
  while (merged.length && merged[0].chord === 'N') merged.shift();
  while (merged.length && merged[merged.length - 1].chord === 'N') merged.pop();
  return merged;
}

/**
 * Frame start offsets: every hop from 0 while a whole frame fits.
 *
 * Framed here rather than with Essentia's `FrameGenerator`, which DROPS silent
 * frames: a 7 s signal with a 3 s break comes back as 90 frames, not 149. The
 * timeline takes each frame's time from its index, so every chord after a
 * break or a drop-out would be stamped seconds early — and an all-silent
 * signal yields no frames at all and throws.
 */
export function frameOffsets(length: number): number[] {
  const out: number[] = [];
  for (let start = 0; start + CHORD_FRAME_SIZE <= length; start += CHORD_HOP_SIZE) out.push(start);
  return out;
}

/** Framewise HPCP over a mono 44.1 kHz signal, then `segmentChords`. */
export function extractChords(essentia: EssentiaChordCore, mono44k: Float32Array): ChordSegment[] {
  const perFrame: Array<{ time: number; chroma: Float32Array }> = [];
  for (const start of frameOffsets(mono44k.length)) {
    const frame = essentia.arrayToVector(mono44k.subarray(start, start + CHORD_FRAME_SIZE));
    const windowed = essentia.Windowing(frame, true, CHORD_FRAME_SIZE, 'hann').frame;
    const spectrum = essentia.Spectrum(windowed).spectrum;
    const peaks = essentia.SpectralPeaks(spectrum, 0, 5000, 100, 0, 'frequency', ESSENTIA_SAMPLE_RATE);
    const hpcp = essentia.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
    perFrame.push({ time: start / ESSENTIA_SAMPLE_RATE, chroma: essentia.vectorToArray(hpcp) });
  }
  return segmentChords(perFrame);
}
