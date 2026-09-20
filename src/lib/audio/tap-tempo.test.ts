import { describe, expect, it } from 'vitest';

import { TAP_RESET_MS, TAP_WINDOW, pushTap, tempoFromTaps } from './tap-tempo';

/** Taps at a steady tempo, starting at t=1000. */
const steady = (bpm: number, count: number, start = 1000) =>
  Array.from({ length: count }, (_, i) => start + (i * 60000) / bpm);

describe('pushTap', () => {
  it('starts a window on the first tap', () => {
    expect(pushTap([], 1000)).toEqual([1000]);
  });

  it('extends a window while taps keep coming', () => {
    expect(pushTap([1000], 1500)).toEqual([1000, 1500]);
  });

  it('starts over after a long pause rather than averaging across it', () => {
    const after = pushTap([1000, 1500], 1500 + TAP_RESET_MS + 1);
    expect(after).toHaveLength(1);
  });

  it('keeps a gap of exactly the reset window', () => {
    expect(pushTap([1000], 1000 + TAP_RESET_MS)).toHaveLength(2);
  });

  it('never grows past the window', () => {
    let taps: number[] = [];
    for (let i = 0; i < 20; i++) taps = pushTap(taps, 1000 + i * 400);
    expect(taps).toHaveLength(TAP_WINDOW);
  });

  it('does not mutate the array it was given', () => {
    const taps = [1000];
    pushTap(taps, 1500);
    expect(taps).toEqual([1000]);
  });
});

describe('tempoFromTaps', () => {
  it('needs two taps before it will say anything', () => {
    expect(tempoFromTaps([])).toBe(null);
    expect(tempoFromTaps([1000])).toBe(null);
  });

  it('reads a steady tempo', () => {
    expect(tempoFromTaps(steady(120, 5))).toBe(120);
    expect(tempoFromTaps(steady(140, 4))).toBe(140);
    expect(tempoFromTaps(steady(90, 2))).toBe(90);
  });

  it('shrugs off one late tap, which averaging the gaps would not', () => {
    const taps = steady(120, 5);
    taps[2] += 60; // one tap 60ms late, the rest on the grid
    // Span-over-intervals ignores it entirely: the endpoints did not move.
    expect(tempoFromTaps(taps)).toBe(120);
  });

  it('clamps a frantic or glacial tempo into range', () => {
    expect(tempoFromTaps([0, 10])).toBe(300);
    expect(tempoFromTaps([0, 60000])).toBe(20);
  });

  it('is null for taps that carry no time between them', () => {
    expect(tempoFromTaps([1000, 1000])).toBe(null);
  });

  it('rounds to a whole tempo', () => {
    const bpm = tempoFromTaps(steady(128.4, 4));
    expect(Number.isInteger(bpm)).toBe(true);
  });
});
