import { describe, expect, it } from 'vitest';
import { nextVersionLabel, stemName, titleFromFilename } from './naming';

describe('naming helpers', () => {
  it('derives readable track titles from filenames', () => {
    expect(titleFromFilename('Dark_Drill-Loop 01.wav')).toBe('Dark Drill Loop 01');
    expect(titleFromFilename('.wav')).toBe('Untagged Track');
  });

  it('formats semantic stem names', () => {
    expect(stemName('Midnight Bounce', 'VOCALS')).toBe('Midnight Bounce — Vocals');
    expect(stemName('', 'drums')).toBe('Track — Drums');
  });

  it('increments version labels deterministically', () => {
    expect(nextVersionLabel([])).toEqual({ number: 1, label: 'v1' });
    expect(nextVersionLabel([{ version_number: 2 }, { version_number: 5 }])).toEqual({ number: 6, label: 'v6' });
  });
});
