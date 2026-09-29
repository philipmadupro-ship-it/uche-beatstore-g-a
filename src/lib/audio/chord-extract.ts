/**
 * The one place chords are extracted: Essentia.js HPCP chroma and, when
 * available, basic-pitch note activations (`basic-pitch.ts`) → 1 s buckets →
 * blended → 24 major/minor triad templates.
 *
 * No browser APIs, so the Vitest suite runs this against the real package,
 * and `chords.worker.js` carries a line-for-line copy that
 * `chords-worker.test.ts` holds equal to it (the bundler cannot bundle a
 * worker entry here — see the header of `essentia.worker.js`).
 *
 * Notes on essentia.js 0.1.3, which the previous in-worker code got wrong:
 *
 *   - Algorithms live on `new Essentia(EssentiaWASM)`; `EssentiaWASM` is the
 *     instantiated module, not a factory (same bug as AUDIO-04).
 *   - A Hann window leaks enough sidelobe energy into SpectralPeaks that a
 *     pure C-E-G triad lights up A, A# and G# at ~0.6 of the root. The
 *     `blackmanharris62` window Essentia's own tonal extractor uses does not.
 *   - `FrameGenerator` DROPS silent frames (and throws when every frame is
 *     silent), so a frame's index stops being its position: after a 2 s
 *     silent intro every chord would be stamped 2 s early. Frames are cut
 *     here instead, one per hop, silent or not.
 *   - An absolute peak threshold lets dozens of noise/hat peaks through and
 *     HPCP smears them until every bin reads ~0.5; peaks are floored relative
 *     to the frame's loudest bin, and a silent frame (where HPCP would throw
 *     on an empty peak list) contributes nothing.
 *   - Every returned vector is WASM heap memory and is freed as we go.
 *
 * Input is mono at `ESSENTIA_SAMPLE_RATE` (decode through an
 * OfflineAudioContext at that rate, as `analyze.client.ts` does), so a
 * timestamp means the same thing on a 44.1 kHz and a 48 kHz device.
 *
 * HPCP bin 0 is the reference pitch A (440 Hz); `PITCH_CLASSES` starts there.
 */

import { ESSENTIA_SAMPLE_RATE } from './essentia-extract';

export interface ChordSegment {
  /** Seconds from the start of the signal. */
  time: number;
  /** "C", "Am", "F#m" … or "N" for no confident chord. */
  chord: string;
}

interface WasmVector {
  delete(): void;
}

/** The subset of the `Essentia` core class this module uses. */
export interface ChordEssentiaCore {
  arrayToVector(input: Float32Array): WasmVector;
  Windowing(frame: WasmVector, normalized: boolean, size: number, type: string): { frame: WasmVector };
  Spectrum(frame: WasmVector, size: number): { spectrum: WasmVector };
  SpectralPeaks(
    spectrum: WasmVector, magnitudeThreshold: number, maxFrequency: number, maxPeaks: number,
    minFrequency: number, orderBy: string, sampleRate: number,
  ): { frequencies: WasmVector; magnitudes: WasmVector };
  HPCP(frequencies: WasmVector, magnitudes: WasmVector): { hpcp: WasmVector };
  vectorToArray(v: WasmVector): Float32Array;
}

export const CHORD_FRAME_SIZE = 4096;
export const CHORD_HOP_SIZE = 2048;
export const CHORD_WINDOW_SECONDS = 1;
/** Peaks quieter than this fraction of the frame's loudest bin (−40 dB) are ignored. */
export const CHORD_PEAK_FLOOR = 0.01;
/** A frame whose peak floor is below this is silence: no peaks, and HPCP throws on an empty list. */
export const CHORD_SILENCE = 1e-5;
/** basic-pitch activations at or below this are ignored (see `noteBuckets`). */
export const NOTE_ACTIVATION_FLOOR = 0.3;
/** Keys below E3 (MIDI 52) are weighted `BASS_WEIGHT` times. */
export const BASS_KEY_MIDI = 52;
export const BASS_WEIGHT = 2;
/** Share of the blended chroma taken from basic-pitch; the rest is HPCP. */
export const NOTE_WEIGHT = 0.75;
/** Share of a bucket's chroma energy the best triad must carry, else "N". */
export const CHORD_MIN_TRIAD_SHARE = 0.45;

export const PITCH_CLASSES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'] as const;

interface Template {
  label: string;
  bins: [number, number, number];
}

const TEMPLATES: Template[] = PITCH_CLASSES.flatMap((pc, root) => [
  { label: pc, bins: [root, (root + 4) % 12, (root + 7) % 12] as [number, number, number] },
  { label: `${pc}m`, bins: [root, (root + 3) % 12, (root + 7) % 12] as [number, number, number] },
]);

/** Best major/minor triad for a 12-bin chroma sum, or "N". */
export function classifyChroma(chroma: ArrayLike<number>): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i] || 0;
  if (!(sum > 1e-6)) return 'N';
  let best = 'N';
  let bestScore = -1;
  for (const t of TEMPLATES) {
    const score = ((chroma[t.bins[0]] || 0) + (chroma[t.bins[1]] || 0) + (chroma[t.bins[2]] || 0)) / sum;
    if (score > bestScore) {
      bestScore = score;
      best = t.label;
    }
  }
  return bestScore < CHORD_MIN_TRIAD_SHARE ? 'N' : best;
}

/** Merge consecutive repeats and trim leading/trailing "N". */
export function compactChordTimeline(segments: ChordSegment[]): ChordSegment[] {
  const merged: ChordSegment[] = [];
  for (const s of segments) {
    if (merged.length && merged[merged.length - 1].chord === s.chord) continue;
    merged.push(s);
  }
  while (merged.length && merged[0].chord === 'N') merged.shift();
  while (merged.length && merged[merged.length - 1].chord === 'N') merged.pop();
  return merged;
}

function spectrumMax(spectrum: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < spectrum.length; i++) if (spectrum[i] > max) max = spectrum[i];
  return max;
}

/** One `CHORD_WINDOW_SECONDS` bucket of summed chroma. */
export interface ChromaBucket {
  acc: number[];
  /** Analysis frames whose centre falls in this bucket. */
  frames: number;
  /** Of those, frames that carried sound (HPCP) or an active note (basic-pitch). */
  voiced: number;
}

function newBucket(): ChromaBucket {
  return { acc: new Array<number>(12).fill(0), frames: 0, voiced: 0 };
}

/** Essentia HPCP chroma per bucket, for mono audio ALREADY at 44.1 kHz. */
export function hpcpBuckets(essentia: ChordEssentiaCore, mono44k: Float32Array): ChromaBucket[] {
  const sr = ESSENTIA_SAMPLE_RATE;
  const buckets: ChromaBucket[] = [];
  for (let start = 0; start + CHORD_FRAME_SIZE <= mono44k.length; start += CHORD_HOP_SIZE) {
    // Bucket by the frame's centre, not its start, or a frame reaching into
    // the next second lends that second's chord to this one.
    const b = Math.floor((start + CHORD_FRAME_SIZE / 2) / sr / CHORD_WINDOW_SECONDS);
    const bucket = (buckets[b] ??= newBucket());
    bucket.frames++;
    const frame = essentia.arrayToVector(mono44k.subarray(start, start + CHORD_FRAME_SIZE));
    const windowed = essentia.Windowing(frame, true, CHORD_FRAME_SIZE, 'blackmanharris62').frame;
    const spectrum = essentia.Spectrum(windowed, CHORD_FRAME_SIZE).spectrum;
    const peakFloor = spectrumMax(essentia.vectorToArray(spectrum)) * CHORD_PEAK_FLOOR;
    if (peakFloor > CHORD_SILENCE) {
      const peaks = essentia.SpectralPeaks(spectrum, peakFloor, 5000, 60, 40, 'frequency', sr);
      const hpcp = essentia.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
      const chroma = essentia.vectorToArray(hpcp);
      for (let j = 0; j < 12; j++) bucket.acc[j] += chroma[j] || 0;
      bucket.voiced++;
      peaks.frequencies.delete();
      peaks.magnitudes.delete();
      hpcp.delete();
    }
    frame.delete();
    windowed.delete();
    spectrum.delete();
  }
  return buckets;
}

/**
 * Pitch-class chroma per bucket from basic-pitch note activations
 * (`basic-pitch.ts`): one row per `BASIC_PITCH_FRAME_SECONDS`, 88 keys from A0.
 *
 * Only activations above `NOTE_ACTIVATION_FLOOR` count. The model spreads a
 * little probability over every key, and summed raw over a second that haze
 * outweighs the three notes actually played (0% on GuitarSet, raw).
 * Keys below `BASS_KEY_MIDI` count `BASS_WEIGHT` times: the lowest voice is
 * usually the root, and weighting it settles rootless jazz voicings.
 */
export function noteBuckets(noteFrames: ArrayLike<ArrayLike<number>>, frameSeconds: number): ChromaBucket[] {
  const buckets: ChromaBucket[] = [];
  for (let i = 0; i < noteFrames.length; i++) {
    const row = noteFrames[i];
    // Centre of the frame, as for HPCP.
    const b = Math.floor(((i + 0.5) * frameSeconds) / CHORD_WINDOW_SECONDS);
    const bucket = (buckets[b] ??= newBucket());
    bucket.frames++;
    let active = false;
    for (let k = 0; k < row.length; k++) {
      const p = row[k];
      if (!(p > NOTE_ACTIVATION_FLOOR)) continue;
      // Key 0 is A0 (MIDI 21), and PITCH_CLASSES starts at A, so the class is k % 12.
      bucket.acc[k % 12] += 21 + k < BASS_KEY_MIDI ? p * BASS_WEIGHT : p;
      active = true;
    }
    if (active) bucket.voiced++;
  }
  return buckets;
}

function unitSum(acc: number[]): number[] {
  let sum = 0;
  for (const v of acc) sum += v;
  return sum > 0 ? acc.map((v) => v / sum) : acc;
}

/**
 * One label per bucket. With note buckets, each source is scaled to unit sum
 * and blended `NOTE_WEIGHT` : 1 − `NOTE_WEIGHT`; a bucket either source lacks
 * falls back to the other. HPCP is normalised per frame, so one faint frame
 * would name a chord on its own: a bucket mostly silent in HPCP is "N".
 */
export function chordsFromBuckets(hpcp: ChromaBucket[], notes?: ChromaBucket[] | null): ChordSegment[] {
  const count = Math.max(hpcp.length, notes?.length ?? 0);
  const segments: ChordSegment[] = [];
  for (let b = 0; b < count; b++) {
    const h = hpcp[b];
    const n = notes?.[b];
    const hVoiced = !!h && h.voiced * 2 >= h.frames;
    const nVoiced = !!n && n.voiced > 0;
    let chord = 'N';
    if (notes) {
      if (hVoiced && nVoiced) {
        const a = unitSum(h!.acc);
        const c = unitSum(n!.acc);
        chord = classifyChroma(a.map((v, j) => (1 - NOTE_WEIGHT) * v + NOTE_WEIGHT * c[j]));
      } else if (hVoiced) {
        chord = classifyChroma(h!.acc);
      } else if (nVoiced && n!.voiced * 2 >= n!.frames) {
        chord = classifyChroma(n!.acc);
      }
    } else if (hVoiced) {
      chord = classifyChroma(h!.acc);
    }
    segments.push({ time: b * CHORD_WINDOW_SECONDS, chord });
  }
  return compactChordTimeline(segments);
}

/**
 * Chord timeline of a mono signal that is ALREADY at 44.1 kHz. Pass basic-pitch
 * note activations for the same audio to blend them in; without them this is
 * HPCP alone (the fallback when the model cannot run).
 */
export function extractChords(
  essentia: ChordEssentiaCore,
  mono44k: Float32Array,
  noteFrames?: ArrayLike<ArrayLike<number>> | null,
  noteFrameSeconds?: number,
): ChordSegment[] {
  const notes = noteFrames && noteFrameSeconds ? noteBuckets(noteFrames, noteFrameSeconds) : null;
  return chordsFromBuckets(hpcpBuckets(essentia, mono44k), notes);
}
