import { describe, it, expect } from 'vitest';
import {
  buildSpectralBars,
  buildAmplitudeBars,
  resampleSeries,
  SPECTRAL_MIN_HEIGHT,
  type SpectralBands,
} from './spectral-peaks';

const bands = (low: number[], mid: number[], high: number[]): SpectralBands => ({ low, mid, high });

/** Pull the numeric channels back out of an `rgb(r, g, b)` string. */
function rgb(color: string): [number, number, number] {
  const m = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) throw new Error(`unparseable colour: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe('buildSpectralBars', () => {
  it('returns empty for empty input', () => {
    expect(buildSpectralBars(bands([], [], []))).toEqual([]);
  });

  it('produces one bar per slice', () => {
    const out = buildSpectralBars(bands([1, 2, 3], [1, 1, 1], [0, 0, 1]));
    expect(out).toHaveLength(3);
  });

  it('truncates to the shortest band so mismatched lengths cannot crash', () => {
    const out = buildSpectralBars(bands([1, 1, 1, 1], [1, 1], [1, 1, 1]));
    expect(out).toHaveLength(2);
  });

  it('marks the dominant band correctly', () => {
    const out = buildSpectralBars(bands([1, 0, 0], [0, 1, 0], [0, 0, 1]));
    expect(out.map((b) => b.dominant)).toEqual(['low', 'mid', 'high']);
  });

  it('maps bands to RGB channels the way Serato does', () => {
    // R = lows (kick/808), G = mids (vocals/snare), B = highs (hats/air).
    const out = buildSpectralBars(bands([1, 0, 0], [0, 1, 0], [0, 0, 1]));
    const [lr, lg, lb] = rgb(out[0].color);
    const [mr, mg, mb] = rgb(out[1].color);
    const [hr, hg, hb] = rgb(out[2].color);
    expect(lr).toBeGreaterThan(lg); expect(lr).toBeGreaterThan(lb);   // bass -> red
    expect(mg).toBeGreaterThan(mr); expect(mg).toBeGreaterThan(mb);   // vocals -> green
    expect(hb).toBeGreaterThan(hr); expect(hb).toBeGreaterThan(hg);   // hats -> blue
  });

  it('renders full-spectrum content as the brightest, least-saturated column', () => {
    // All three bands at once sums to a bright warm bone in this additive
    // model — the clearest signal that colour reflects content rather than
    // merely which band dominates. Deliberately NOT pure white: the primaries
    // are tinted so the waveform sits in the app's warm palette.
    const out = buildSpectralBars(bands([1, 1, 0], [1, 0, 0], [1, 0, 0]));
    const [r, g, b] = rgb(out[0].color);
    const [br] = rgb(out[1].color);
    expect(Math.min(r, g, b)).toBeGreaterThan(180);        // bright
    expect(r).toBeGreaterThan(b);                           // and warm
    expect(r).toBeGreaterThan(br);                          // brighter than bass-only
  });

  it('normalises each band independently so quiet highs stay visible', () => {
    // Highs are 100x quieter than lows in absolute terms. A global normalise
    // would render the hats-only slice as near-black; per-band keeps its colour.
    const out = buildSpectralBars(bands([100, 0], [0, 0], [0, 1]));
    expect(out[1].dominant).toBe('high');
    const [r, g, b] = rgb(out[1].color);
    // Blue-leading and comfortably visible, rather than crushed to black.
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(90);
  });

  it('never renders a visible column at pure black', () => {
    // A floor keeps quiet-but-present audio legible instead of vanishing.
    const out = buildSpectralBars(bands([1, 0.001], [1, 0.001], [1, 0.001]));
    const [r, g, b] = rgb(out[1].color);
    expect(Math.max(r, g, b)).toBeGreaterThan(20);
  });

  it('scales height by raw loudness, not normalised colour', () => {
    // Second slice is far louder overall, so it must be the taller bar.
    const out = buildSpectralBars(bands([0.1, 1], [0.1, 1], [0.1, 1]));
    expect(out[1].height).toBeGreaterThan(out[0].height);
    expect(out[1].height).toBeCloseTo(1, 5);
  });

  it('floors silent slices at the minimum height instead of zero', () => {
    const out = buildSpectralBars(bands([0, 1], [0, 1], [0, 1]));
    expect(out[0].height).toBe(SPECTRAL_MIN_HEIGHT);
  });

  it('clamps heights to 0..1', () => {
    const out = buildSpectralBars(bands([5, 2], [5, 2], [5, 2]));
    for (const bar of out) {
      expect(bar.height).toBeGreaterThanOrEqual(0);
      expect(bar.height).toBeLessThanOrEqual(1);
    }
  });

  it('survives NaN and Infinity without emitting NaN output', () => {
    const out = buildSpectralBars(bands([NaN, 1], [Infinity, 1], [0, 1]));
    for (const bar of out) {
      expect(Number.isFinite(bar.height)).toBe(true);
      expect(bar.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    }
  });

  it('treats negative sample values by magnitude', () => {
    const positive = buildSpectralBars(bands([1, 0.5], [0, 0], [0, 0]));
    const negative = buildSpectralBars(bands([-1, -0.5], [0, 0], [0, 0]));
    expect(negative.map((b) => b.height)).toEqual(positive.map((b) => b.height));
  });

  it('keeps a low-dominant slice red rather than averaging to mud', () => {
    // Slice 0 sits at the low band's peak while mid and high sit well below
    // their own peaks, so lows genuinely dominate there and it must read warm.
    //
    // Note the shape of this input: because each band is normalised against
    // its OWN peak, a constant band always normalises to 1. Feeding three
    // constant bands would make all three equal and the colour grey no matter
    // what the weighting does — which is not a test of anything. The series
    // therefore has to vary.
    const out = buildSpectralBars(bands([1, 0.5], [0.3, 1], [0.2, 1]));
    const [r, g, b] = rgb(out[0].color);
    expect(out[0].dominant).toBe('low');
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('reads blue when highs dominate a slice', () => {
    const out = buildSpectralBars(bands([0.2, 1], [0.3, 1], [1, 0.5]));
    const [r, , b] = rgb(out[0].color);
    expect(out[0].dominant).toBe('high');
    expect(b).toBeGreaterThan(r);
  });

  it('handles all-silent input without dividing by zero', () => {
    const out = buildSpectralBars(bands([0, 0], [0, 0], [0, 0]));
    expect(out).toHaveLength(2);
    for (const bar of out) {
      expect(bar.height).toBe(SPECTRAL_MIN_HEIGHT);
      expect(bar.color).toMatch(/^rgb\(/);
    }
  });
});

describe('buildAmplitudeBars', () => {
  it('returns a neutral colour, not an invented band', () => {
    const out = buildAmplitudeBars([0.5, 1]);
    expect(new Set(out.map((b) => b.color)).size).toBe(1);
  });

  it('normalises against the loudest peak', () => {
    const out = buildAmplitudeBars([0.25, 0.5]);
    expect(out[1].height).toBeCloseTo(1, 5);
    expect(out[0].height).toBeCloseTo(0.5, 5);
  });

  it('floors silence and survives an all-zero series', () => {
    const out = buildAmplitudeBars([0, 0]);
    expect(out.every((b) => b.height === SPECTRAL_MIN_HEIGHT)).toBe(true);
  });
});

describe('resampleSeries', () => {
  it('returns the same values when the length already matches', () => {
    expect(resampleSeries([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it('pads an empty series to the target length', () => {
    expect(resampleSeries([], 4)).toEqual([0, 0, 0, 0]);
  });

  it('returns empty for a non-positive target', () => {
    expect(resampleSeries([1, 2, 3], 0)).toEqual([]);
  });

  it('downsamples by averaging each bucket', () => {
    expect(resampleSeries([0, 1, 2, 3], 2)).toEqual([0.5, 2.5]);
  });

  it('always emits exactly the requested number of buckets', () => {
    for (const target of [1, 7, 64, 200]) {
      expect(resampleSeries([1, 2, 3, 4, 5], target)).toHaveLength(target);
    }
  });

  it('upsamples without producing holes', () => {
    const out = resampleSeries([1, 2], 6);
    expect(out).toHaveLength(6);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});
