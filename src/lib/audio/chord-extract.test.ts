import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  classifyChroma,
  extractChords,
  frameOffsets,
  segmentChords,
  type EssentiaChordCore,
} from './chord-extract';
import { ESSENTIA_SAMPLE_RATE } from './essentia-extract';

/**
 * Runs the REAL essentia.js. The old chord worker called an API the package
 * does not have and nothing ever executed it.
 */
const require = createRequire(import.meta.url);
const { Essentia, EssentiaWASM } = require('essentia.js') as {
  Essentia: new (wasm: unknown) => EssentiaChordCore;
  EssentiaWASM: unknown;
};
const essentia = new Essentia(EssentiaWASM);

const NOTE_HZ: Record<string, number> = {
  C: 261.63, 'C#': 277.18, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88,
};
/** Triads for a progression, `seconds` each, with a few harmonics so HPCP sees real partials. */
function progression(chords: string[][], seconds: number, sampleRate = ESSENTIA_SAMPLE_RATE): Float32Array {
  const per = Math.round(seconds * sampleRate);
  const out = new Float32Array(per * chords.length);
  chords.forEach((notes, c) => {
    for (let i = 0; i < per; i++) {
      const t = i / sampleRate;
      let v = 0;
      for (const n of notes) {
        const f = NOTE_HZ[n];
        v += 0.15 * Math.sin(2 * Math.PI * f * t) + 0.05 * Math.sin(4 * Math.PI * f * t);
      }
      out[c * per + i] = v;
    }
  });
  return out;
}

describe('extractChords (real Essentia)', () => {
  it('reads a I–vi–IV–V progression in C', () => {
    const signal = progression([['C', 'E', 'G'], ['A', 'C', 'E'], ['F', 'A', 'C'], ['G', 'B', 'D']], 3);
    const chords = extractChords(essentia, signal).map((s) => s.chord);
    expect(chords).toEqual(['C', 'Am', 'F', 'G']);
  }, 60_000);

  it('places each change at its time, to the bucket', () => {
    const signal = progression([['C', 'E', 'G'], ['A', 'C', 'E']], 3);
    const out = extractChords(essentia, signal);
    expect(out[0]).toEqual({ time: 0, chord: 'C' });
    expect(out[1].chord).toBe('Am');
    expect(out[1].time).toBeGreaterThanOrEqual(2.9);
    expect(out[1].time).toBeLessThanOrEqual(4.1);
  }, 60_000);

  it('keeps chord times true across a silent break', () => {
    // Essentia's FrameGenerator drops silent frames, which shifted every
    // chord after a break earlier by the length of the break.
    const sr = ESSENTIA_SAMPLE_RATE;
    const c = progression([['C', 'E', 'G']], 2);
    const am = progression([['A', 'C', 'E']], 2);
    const signal = new Float32Array(sr * 7);
    signal.set(c, 0);
    signal.set(am, sr * 5);
    const out = extractChords(essentia, signal);
    expect(out.map((s) => s.chord)).toEqual(['C', 'N', 'Am']);
    // Within one 1 s bucket of the real onset at 5 s. With silent frames
    // dropped it came back near 2 s — the break's length early.
    const amTime = out[2].time;
    expect(amTime).toBeGreaterThanOrEqual(4);
    expect(amTime).toBeLessThanOrEqual(5.1);
  }, 60_000);

  it('returns no chords for silence, and nothing for a clip shorter than a frame', () => {
    expect(extractChords(essentia, new Float32Array(ESSENTIA_SAMPLE_RATE * 3))).toEqual([]);
    expect(extractChords(essentia, new Float32Array(100))).toEqual([]);
  }, 60_000);
});

describe('classifyChroma', () => {
  // Bin order starts at A (HPCP reference 440 Hz).
  const chroma = (pcs: number[]) => { const c = new Array(12).fill(0); for (const p of pcs) c[p] = 1; return c; };
  it('matches major and minor triads from the A-rooted bins', () => {
    expect(classifyChroma(chroma([3, 7, 10]))).toBe('C');   // C E G
    expect(classifyChroma(chroma([0, 3, 7]))).toBe('Am');   // A C E
  });
  it('says N rather than guessing when nothing dominates', () => {
    expect(classifyChroma(new Array(12).fill(1))).toBe('N');
    expect(classifyChroma(new Array(12).fill(0))).toBe('N');
  });
});

describe('frameOffsets', () => {
  it('steps every hop while a whole frame fits, silence or not', () => {
    expect(frameOffsets(4096)).toEqual([0]);
    expect(frameOffsets(4096 + 2048)).toEqual([0, 2048]);
    expect(frameOffsets(4095)).toEqual([]);
    expect(frameOffsets(44100 * 7)).toHaveLength(Math.floor((44100 * 7 - 4096) / 2048) + 1);
  });
});

describe('segmentChords', () => {
  const c = (pcs: number[]) => { const a = new Array(12).fill(0); for (const p of pcs) a[p] = 1; return a; };
  it('merges repeats and trims leading and trailing N', () => {
    const frames = [
      { time: 0, chroma: new Array(12).fill(0.1) },  // N
      { time: 1, chroma: c([3, 7, 10]) },            // C
      { time: 2, chroma: c([3, 7, 10]) },            // C
      { time: 3, chroma: c([0, 3, 7]) },             // Am
      { time: 4, chroma: new Array(12).fill(0.1) },  // N
    ];
    expect(segmentChords(frames)).toEqual([{ time: 1, chord: 'C' }, { time: 3, chord: 'Am' }]);
  });
});
