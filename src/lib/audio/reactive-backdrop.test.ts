import { describe, expect, it } from 'vitest';
import { backdropFrame, RESTING_FRAME, smooth } from './reactive-backdrop';

describe('backdropFrame', () => {
  it('rests when nothing is playing, whatever the numbers say', () => {
    expect(backdropFrame(1, 1, false)).toEqual(RESTING_FRAME);
  });
  it('grows with bass and brightens with level, within bounds', () => {
    const quiet = backdropFrame(0, 0, true);
    const loud = backdropFrame(1, 1, true);
    expect(quiet).toEqual(RESTING_FRAME);
    expect(loud.bassScale).toBeCloseTo(1.18);
    expect(loud.bassOpacity).toBeLessThanOrEqual(0.55);
    expect(loud.levelOpacity).toBeLessThanOrEqual(0.4);
  });
  it('treats garbage input as silence', () => {
    expect(backdropFrame(Number.NaN, -3, true)).toEqual(RESTING_FRAME);
  });
});

describe('smooth', () => {
  it('moves a fraction of the way', () => {
    expect(smooth(0, 1, 0.25)).toBe(0.25);
  });
});
