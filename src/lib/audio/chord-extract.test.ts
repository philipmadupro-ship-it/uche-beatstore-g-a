import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  BASS_WEIGHT, chordsFromBuckets, classifyChroma, compactChordTimeline, extractChords, frameOffsets, hpcpBuckets, noteBuckets,
  NOTE_ACTIVATION_FLOOR, type ChordEssentiaCore, type ChromaBucket,
} from './chord-extract';
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

  it('keeps chord times true across a silent break in the middle, and marks it N', () => {
    const sr = ESSENTIA_SAMPLE_RATE;
    const signal = new Float32Array(sr * 7);
    signal.set(progression([['C', 'E', 'G']]), 0);
    signal.set(progression([['A', 'C', 'E']]), sr * 5);
    expect(extractChords(essentia, signal)).toEqual([
      { time: 0, chord: 'C' },
      { time: 2, chord: 'N' },
      { time: 5, chord: 'Am' },
    ]);
  }, 30_000);

  it('returns nothing for silence or a clip shorter than one frame', () => {
    expect(extractChords(essentia, new Float32Array(ESSENTIA_SAMPLE_RATE * 3))).toEqual([]);
    expect(extractChords(essentia, new Float32Array(100))).toEqual([]);
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

/** One 88-key activation row with the given keys set (key 0 = A0 = MIDI 21). */
function row(keys: Record<number, number>): number[] {
  const r = new Array(88).fill(0.05);
  for (const [k, v] of Object.entries(keys)) r[Number(k)] = v;
  return r;
}
const key = (midi: number) => midi - 21;

describe('noteBuckets', () => {
  it('folds keys onto pitch classes from A, one bucket per second by frame centre', () => {
    // C4 = MIDI 60, E4 = 64, G4 = 67; frames of 0.25 s.
    const frames = [0, 1, 2, 3, 4].map(() => row({ [key(60)]: 0.9, [key(64)]: 0.8, [key(67)]: 0.7 }));
    const buckets = noteBuckets(frames, 0.25);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].frames).toBe(4);
    expect(buckets[1].frames).toBe(1);
    expect(buckets[0].acc[3]).toBeCloseTo(3.6); // C
    expect(buckets[0].acc[7]).toBeCloseTo(3.2); // E
    expect(buckets[0].acc[10]).toBeCloseTo(2.8); // G
    expect(classifyChroma(buckets[0].acc)).toBe('C');
  });

  it(`ignores activations at or below ${NOTE_ACTIVATION_FLOOR}; a frame with none is not voiced`, () => {
    const [b] = noteBuckets([row({ [key(60)]: NOTE_ACTIVATION_FLOOR }), row({})], 0.5);
    expect(b.acc.every((v) => v === 0)).toBe(true);
    expect(b.voiced).toBe(0);
  });

  it(`weights keys below E3 ${BASS_WEIGHT}x, so the bass settles a rootless voicing`, () => {
    // E-G-B over a C2 bass: Em by the upper notes alone, C major (C-E-G) with the bass.
    const upper = { [key(64)]: 0.8, [key(67)]: 0.8, [key(71)]: 0.8 };
    expect(classifyChroma(noteBuckets([row(upper)], 1)[0].acc)).toBe('Em');
    const [b] = noteBuckets([row({ ...upper, [key(36)]: 0.8 })], 1);
    expect(b.acc[3]).toBeCloseTo(0.8 * BASS_WEIGHT);
    expect(classifyChroma(b.acc)).toBe('C');
  });
});

describe('chordsFromBuckets', () => {
  const bucket = (acc: number[], voiced = 4, frames = 4): ChromaBucket => ({ acc, frames, voiced });
  const chroma = (bins: Record<number, number>) => Array.from({ length: 12 }, (_, i) => bins[i] ?? 0);
  const cMajor = chroma({ 3: 1, 7: 1, 10: 1 });
  const aMinor = chroma({ 0: 1, 3: 1, 7: 1 });

  it('is HPCP alone without note buckets', () => {
    expect(chordsFromBuckets([bucket(cMajor)], null)).toEqual([{ time: 0, chord: 'C' }]);
  });

  it('lets basic-pitch outvote HPCP where they disagree (75/25 blend)', () => {
    expect(chordsFromBuckets([bucket(cMajor)], [bucket(aMinor)])).toEqual([{ time: 0, chord: 'Am' }]);
  });

  it('falls back to whichever source heard the bucket', () => {
    const silentH = bucket(chroma({}), 0);
    const silentN = bucket(chroma({}), 0);
    expect(chordsFromBuckets([bucket(cMajor), silentH], [silentN, bucket(aMinor)]).map((s) => s.chord)).toEqual(['C', 'Am']);
  });

  it('is N where neither heard enough', () => {
    const quiet = bucket(cMajor, 1, 4);
    expect(chordsFromBuckets([bucket(cMajor), quiet, bucket(aMinor)], [bucket(cMajor), bucket(aMinor, 1, 4), bucket(aMinor)]))
      .toEqual([{ time: 0, chord: 'C' }, { time: 1, chord: 'N' }, { time: 2, chord: 'Am' }]);
  });
});

describe('extractChords with note frames', () => {
  it('equals chordsFromBuckets over hpcpBuckets and noteBuckets', () => {
    const signal = progression([['C', 'E', 'G'], ['A', 'C', 'E']]);
    const frames = Array.from({ length: 344 }, (_, i) => (i < 172 ? row({ [key(60)]: 0.9, [key(64)]: 0.9, [key(67)]: 0.9 }) : row({ [key(57)]: 0.9, [key(60)]: 0.9, [key(64)]: 0.9 })));
    expect(extractChords(essentia, signal, frames, 256 / 22050)).toEqual(
      chordsFromBuckets(hpcpBuckets(essentia, signal), noteBuckets(frames, 256 / 22050)),
    );
    expect(extractChords(essentia, signal, frames, 256 / 22050).map((s) => s.chord)).toEqual(['C', 'Am']);
  }, 30_000);
});
