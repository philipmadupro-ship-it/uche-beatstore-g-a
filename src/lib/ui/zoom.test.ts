import { describe, expect, it } from 'vitest';

import { clampZoom, formatZoom, sliderToZoom, stepZoom, zoomToSlider } from './zoom';

const cover = { min: 0.02, max: 2 };
const store = { min: 0.25, max: 2 };

describe('stepZoom', () => {
  it('walks up and down the ladder', () => {
    expect(stepZoom(0.5, 1, cover)).toBe(0.67);
    expect(stepZoom(0.5, -1, cover)).toBe(0.33);
    expect(stepZoom(1, 1, cover)).toBe(1.25);
  });

  it('moves to the next stop from an in-between zoom, never staying put', () => {
    // Fit-to-window lands between stops.
    expect(stepZoom(0.2213, 1, cover)).toBe(0.25);
    expect(stepZoom(0.2213, -1, cover)).toBe(0.167);
    // Nearly on a stop still moves past it.
    expect(stepZoom(0.4999, 1, cover)).toBe(0.67);
  });

  it('clamps to the range at both ends', () => {
    expect(stepZoom(2, 1, cover)).toBe(2);
    expect(stepZoom(0.02, -1, cover)).toBe(0.02);
    expect(stepZoom(0.25, -1, store)).toBe(0.25);
  });
});

describe('slider mapping', () => {
  it('is logarithmic: 20% sits in the middle of 2%–200%', () => {
    expect(zoomToSlider(0.2, cover)).toBe(500);
    expect(zoomToSlider(0.02, cover)).toBe(0);
    expect(zoomToSlider(2, cover)).toBe(1000);
  });

  it('round-trips', () => {
    for (const zoom of [0.03, 0.2213, 0.5, 1, 1.7]) {
      expect(sliderToZoom(zoomToSlider(zoom, cover), cover)).toBeCloseTo(zoom, 2);
    }
  });

  it('clamps out-of-range input', () => {
    expect(sliderToZoom(-50, store)).toBe(0.25);
    expect(sliderToZoom(5000, store)).toBe(2);
    expect(zoomToSlider(10, store)).toBe(1000);
  });
});

describe('clampZoom + formatZoom', () => {
  it('rejects non-finite values', () => {
    expect(clampZoom(Number.NaN, cover)).toBe(0.02);
  });

  it('formats small zooms with a decimal', () => {
    expect(formatZoom(0.045)).toBe('4.5%');
    expect(formatZoom(0.2213)).toBe('22%');
    expect(formatZoom(1)).toBe('100%');
  });
});
