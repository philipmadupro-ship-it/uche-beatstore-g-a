import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { classifyChroma, compactChordTimeline, extractChords, type ChordEssentiaCore } from './chord-extract';
import { ESSENTIA_SAMPLE_RATE } from './essentia-extract';
import { progression } from './mocks/chord-signal';

const require = createRequire(import.meta.url);
const { Essentia, EssentiaWASM } = require('essentia.js') as {
  Essentia: new (wasm: unknown) => ChordEssentiaCore;
  EssentiaWASM: unknown;
};
const essentia = new Essentia(EssentiaWASM);

describe('extractChords (real essentia.js)', () => {
  it('names a I–vi–IV–V progression in C, with times', () => {
    const signal = progression([['C', 'E', 'G'], ['A', 'C', 'E'], ['F', 'A', 'C'], ['G', 'B', 'D']]);
    expect(extractChords(essentia, signal)).toEqual([
      { time: 0, chord: 'C' },
      { time: 2, chord: 'Am' },
      { time: 4, chord: 'F' },
      { time: 6, chord: 'G' },
    ]);
  }, 30_000);

  it('handles sharps and minor chords off the reference pitch', () => {
    const signal = progression([['F#', 'A', 'C#'], ['D', 'F#', 'A'], ['A#', 'D', 'F']]);
    expect(extractChords(essentia, signal).map((s) => s.chord)).toEqual(['F#m', 'D', 'A#']);
  }, 30_000);

  it('keeps timestamps after a silent intro (FrameGenerator drops silent frames)', () => {
    const chords = progression([['C', 'E', 'G'], ['G', 'B', 'D']]);
    const signal = new Float32Array(ESSENTIA_SAMPLE_RATE * 3 + chords.length);
    signal.set(chords, ESSENTIA_SAMPLE_RATE * 3);
    expect(extractChords(essentia, signal)).toEqual([
      { time: 3, chord: 'C' },
      { time: 5, chord: 'G' },
    ]);
  }, 30_000);

  it('returns nothing for silence or a clip shorter than one frame', () => {
    expect(extractChords(essentia, new Float32Array(ESSENTIA_SAMPLE_RATE * 3))).toEqual([]);
    expect(extractChords(essentia, new Float32Array(100))).toEqual([]);
  });
});

describe('classifyChroma', () => {
  it('picks the triad carrying the most energy', () => {
    const c = new Array(12).fill(0);
    c[3] = 1; c[7] = 0.8; c[10] = 0.8; // C E G
    expect(classifyChroma(c)).toBe('C');
    c[7] = 0; c[6] = 0.8; // C D# G
    expect(classifyChroma(c)).toBe('Cm');
  });

  it('says N when no triad dominates, or there is no energy', () => {
    expect(classifyChroma(new Array(12).fill(1))).toBe('N');
    expect(classifyChroma(new Array(12).fill(0))).toBe('N');
  });
});

describe('compactChordTimeline', () => {
  it('merges repeats and trims N at both ends only', () => {
    expect(compactChordTimeline([
      { time: 0, chord: 'N' }, { time: 1, chord: 'C' }, { time: 2, chord: 'C' },
      { time: 3, chord: 'N' }, { time: 4, chord: 'G' }, { time: 5, chord: 'N' },
    ])).toEqual([{ time: 1, chord: 'C' }, { time: 3, chord: 'N' }, { time: 4, chord: 'G' }]);
  });
});
