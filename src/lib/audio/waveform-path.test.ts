import { describe, expect, it } from 'vitest';

import {
  WAVEFORM_VIEW_HEIGHT,
  WAVEFORM_VIEW_WIDTH,
  fractionFromPointer,
  seekSeconds,
  svgSafeId,
  waveformPath,
} from './waveform-path';

describe('waveformPath', () => {
  it('draws a closed, mirrored outline', () => {
    const d = waveformPath([0, 1, 0], 100, 100);
    expect(d.startsWith('M 0 50.0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Peak of 1 reaches the top edge on the way out and the bottom on the way back.
    expect(d).toContain('L 50.0 0.0');
    expect(d).toContain('L 50.0 100.0');
  });

  it('spans the full width of the viewBox', () => {
    const d = waveformPath([0.5, 0.5], WAVEFORM_VIEW_WIDTH, WAVEFORM_VIEW_HEIGHT);
    expect(d).toContain(`L ${WAVEFORM_VIEW_WIDTH}.0`);
  });

  it('draws nothing at all for no peaks, rather than a fake line', () => {
    expect(waveformPath([])).toBe('');
  });

  it('stretches a single peak across the box instead of drawing a point', () => {
    const d = waveformPath([0.5], 100, 100);
    expect(d).toContain('L 0.0 25.0');
    expect(d).toContain('L 100.0 25.0');
  });

  it('clamps out-of-range and non-finite peaks rather than drawing off the box', () => {
    const d = waveformPath([2, -1, Number.NaN], 100, 100);
    // Every y stays inside 0..100.
    const ys = [...d.matchAll(/L [\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('keeps coordinates to one decimal so the markup stays small', () => {
    const d = waveformPath([0.123456, 0.987654], 1000, 200);
    expect(d).not.toMatch(/\.\d{2,}/);
  });
});

describe('fractionFromPointer', () => {
  it('reads a click as a fraction of the width', () => {
    expect(fractionFromPointer(150, 100, 200)).toBeCloseTo(0.25);
  });

  it('clamps a pointer past either edge', () => {
    expect(fractionFromPointer(50, 100, 200)).toBe(0);
    expect(fractionFromPointer(999, 100, 200)).toBe(1);
  });

  it('is zero for a box with no width, instead of dividing by it', () => {
    expect(fractionFromPointer(150, 100, 0)).toBe(0);
  });
});

describe('seekSeconds', () => {
  it('uses the media element\'s duration when it has one', () => {
    expect(seekSeconds(0.5, 200, 180)).toBe(100);
  });

  it('falls back to the stored duration before metadata has loaded', () => {
    // The bug this exists for: clicking the waveform of a track that is not
    // playing loads it and seeks in one moment, while the element still
    // reports NaN. That used to drop the seek and start from zero.
    expect(seekSeconds(0.5, Number.NaN, 180)).toBe(90);
    expect(seekSeconds(0.5, 0, 180)).toBe(90);
  });

  it('refuses to seek to a guess when neither duration is known', () => {
    expect(seekSeconds(0.5, Number.NaN, null)).toBe(null);
    expect(seekSeconds(0.5, Number.NaN, 0)).toBe(null);
  });

  it('clamps the fraction', () => {
    expect(seekSeconds(1.5, 100, null)).toBe(100);
    expect(seekSeconds(-1, 100, null)).toBe(0);
  });
});

describe('svgSafeId', () => {
  it('strips the characters useId emits that break url(#…)', () => {
    // A colon or guillemet in the fragment makes the gradient fail to resolve,
    // and the waveform renders with no fill at all.
    expect(svgSafeId(':r0:')).toBe('wf-r0');
    expect(svgSafeId('«r12»')).toBe('wf-r12');
  });
});
