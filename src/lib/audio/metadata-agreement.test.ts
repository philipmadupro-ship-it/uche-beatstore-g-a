import { describe, it, expect } from 'vitest';
import { compareBpm, compareKey, compareFilenameWithDetected } from './metadata-agreement';
import { parseTitleMetadata } from '@/lib/upload/title-metadata';

describe('compareBpm', () => {
  it.each([
    [140, 140, 'agree'],
    [140, 139.2, 'agree'],
    [174, 176.5, 'agree'],    // 1.5 % of 176
    [140, 70, 'tempo_multiple'],
    [70, 140.4, 'tempo_multiple'],
    [140, 97, 'conflict'],
    [140, 128.6, 'conflict'], // what a 48 kHz decode used to report
  ] as const)('%d vs %d → %s', (a, b, expected) => {
    expect(compareBpm(a, b)).toBe(expected);
  });
});

describe('compareKey', () => {
  it('agrees across spellings and an unstated mode', () => {
    expect(compareKey({ key: 'Bb', scale: 'minor' }, { key: 'A#', scale: 'minor' })).toBe('agree');
    expect(compareKey({ key: 'F', scale: null }, { key: 'F', scale: 'minor' })).toBe('agree');
  });

  it('recognises the relative major/minor', () => {
    expect(compareKey({ key: 'A', scale: 'minor' }, { key: 'C', scale: 'major' })).toBe('relative_key');
    expect(compareKey({ key: 'Eb', scale: 'major' }, { key: 'C', scale: 'minor' })).toBe('relative_key');
  });

  it('calls anything else a conflict', () => {
    expect(compareKey({ key: 'F', scale: 'minor' }, { key: 'D', scale: 'major' })).toBe('conflict');
    expect(compareKey({ key: 'F', scale: 'minor' }, { key: 'F', scale: 'major' })).toBe('conflict');
  });
});

describe('compareFilenameWithDetected', () => {
  const meta = (f: string) => parseTitleMetadata(f);

  it('clear name, detector agrees: nothing to show', () => {
    const r = compareFilenameWithDetected(meta('Night Shift 140 Fm.wav'), { bpm: 139.8, key: 'F', scale: 'minor' });
    expect(r.bpm?.agreement).toBe('agree');
    expect(r.key?.agreement).toBe('agree');
    expect(r.conflicts).toEqual([]);
  });

  it('half-time detector and relative key are not raised as conflicts', () => {
    const r = compareFilenameWithDetected(meta('Night Shift 140 Am.wav'), { bpm: 70, key: 'C', scale: 'major' });
    expect(r.bpm?.agreement).toBe('tempo_multiple');
    expect(r.key?.agreement).toBe('relative_key');
    expect(r.conflicts).toEqual([]);
  });

  it('a real disagreement is surfaced with both readings and detector confidence', () => {
    const r = compareFilenameWithDetected(meta('Night Shift 140 Fm.wav'), {
      bpm: 97, key: 'D', scale: 'major', bpmConfidence: 3.9, keyStrength: 0.4,
    });
    expect(r.conflicts).toEqual([
      { field: 'bpm', filename: 140, detected: 97, agreement: 'conflict', detectorConfident: true },
      {
        field: 'key', filename: { key: 'F', scale: 'minor' }, detected: { key: 'D', scale: 'major' },
        agreement: 'conflict', detectorConfident: false,
      },
    ]);
  });

  it('says nothing about confidence the detector did not report', () => {
    const r = compareFilenameWithDetected(meta('beat 140bpm.wav'), { bpm: 100 });
    expect(r.bpm?.detectorConfident).toBeNull();
  });

  it('points at the candidate the detector backs when the name was ambiguous', () => {
    const r = compareFilenameWithDetected(meta('beat 90 140 Am Fm.wav'), { bpm: 140.3, key: 'F', scale: 'minor' });
    expect(r.supported).toEqual({ bpm: 140, key: { key: 'F', scale: 'minor' } });
    // Ambiguous fields are not "conflicts" — nothing from the name was applied.
    expect(r.conflicts).toEqual([]);
  });

  it('backs no candidate when the detector matches none, or both', () => {
    expect(compareFilenameWithDetected(meta('beat 90 140.wav'), { bpm: 120 }).supported.bpm).toBeNull();
    expect(compareFilenameWithDetected(meta('beat 140 141.wav'), { bpm: 140.5 }).supported.bpm).toBeNull();
  });

  it('empty: no name metadata or no detector means no comparison', () => {
    expect(compareFilenameWithDetected(meta('Deep Cuts.wav'), { bpm: 120, key: 'C', scale: 'major' }).conflicts).toEqual([]);
    expect(compareFilenameWithDetected(meta('Night Shift 140 Fm.wav'), null).bpm).toBeNull();
    expect(compareFilenameWithDetected(meta('Night Shift 140 Fm.wav'), { bpm: null, key: null }).bpm).toBeNull();
  });
});
