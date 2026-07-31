import { describe, it, expect } from 'vitest';
import {
  buildSpectralBars,
  buildAmplitudeBars,
  resampleSeries,
  loudnessRange,
  levelAtProgress,
  bassAtProgress,
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

  it('is a single hue: every colour it produces converts to the same HSL hue', () => {
    // The whole point of this pass: the owner rejected a multi-hue mapping
    // (red bass / green vocals / blue hats — up to 88 distinct hues measured
    // live on one waveform) and asked for "shades of one colour". This is the
    // property that actually enforces that request, computed by converting
    // each rgb() back to HSL rather than trusting the implementation not to
    // drift.
    const hueOf = (color: string): number => {
      const [r, g, b] = rgb(color);
      const [rn, gn, bn] = [r / 255, g / 255, b / 255];
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      if (max === min) return -1; // achromatic (pure grey) — no hue to compare
      const d = max - min;
      let h: number;
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      return Math.round(h * 60);
    };

    const out = buildSpectralBars(bands([1, 0.4, 0.9, 0.1], [0.2, 1, 0.3, 0.9], [0.6, 0.1, 1, 0.5]));
    const hues = out.map((b) => b.color).map(hueOf).filter((h) => h >= 0);
    expect(hues.length).toBeGreaterThan(0);
    for (const h of hues) {
      expect(h).toBeGreaterThanOrEqual(30);
      expect(h).toBeLessThanOrEqual(36);
    }
  });

  it('encodes bass-vs-air as lightness, not as a different colour', () => {
    // Bass-dominant reads deep/dark; air-dominant reads pale/light — but both
    // are the SAME hue. This replaces the old "bass=red, hats=blue" assertion,
    // which was testing exactly the multi-hue behaviour the owner rejected.
    // Per-band normalisation means a band always reads 1.0 at ITS OWN peak
    // index regardless of absolute level, so a naive [1,0]/[0.1,0]/[0.1,0]
    // input would normalise every band to 1 at index 0 and collapse the two
    // cases to the same colour. Each band's peak is placed at a different
    // index instead, so index 0 is genuinely low-dominant / high-dominant.
    const bassHeavy = buildSpectralBars(bands([1, 0.3], [0.3, 1], [0.2, 1]));
    const airHeavy = buildSpectralBars(bands([0.2, 1], [0.3, 1], [1, 0.3]));
    const bassLum = rgb(bassHeavy[0].color).reduce((s, v) => s + v, 0);
    const airLum = rgb(airHeavy[0].color).reduce((s, v) => s + v, 0);
    expect(airLum).toBeGreaterThan(bassLum);
    expect(bassHeavy[0].dominant).toBe('low');
    expect(airHeavy[0].dominant).toBe('high');
  });

  it('normalises each band independently so quiet highs still lighten the shade', () => {
    // Highs are 100x quieter than lows in absolute terms. A global normalise
    // would treat the hats-only slice as silent; per-band normalisation is
    // what makes it register at all.
    const loud = buildSpectralBars(bands([100, 0], [0, 0], [0, 0]));
    const quietHighs = buildSpectralBars(bands([100, 0], [0, 0], [0, 1]));
    expect(quietHighs[1].dominant).toBe('high');
    const loudLum = rgb(loud[0].color).reduce((s, v) => s + v, 0);
    const quietHighsLum = rgb(quietHighs[1].color).reduce((s, v) => s + v, 0);
    expect(quietHighsLum).toBeGreaterThan(loudLum);
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

describe('playhead level sampling', () => {
  /** A mastered-sounding track: everything inside a narrow, realistic dB band. */
  const realistic = [-24.9, -24.6, -23.3, -24.2, -22.6, -21.6, -24.7, -23.9];

  it('uses most of the 0..1 range on realistic material', () => {
    // The regression this whole extraction exists for. The old inline mapping,
    // `(db + 45) / 45`, put this exact series into 0.45..0.52 — 7% of the
    // range — so the art it drove changed by ~3% and read as static.
    const range = loudnessRange(realistic);
    const levels = realistic.map((_, i) =>
      levelAtProgress(realistic, i / (realistic.length - 1), range));
    const spread = Math.max(...levels) - Math.min(...levels);
    expect(spread).toBeGreaterThan(0.75);

    const old = realistic.map((v) => Math.max(0, Math.min(1, (v + 45) / 45)));
    expect(spread).toBeGreaterThan((Math.max(...old) - Math.min(...old)) * 5);
  });

  it('maps the quietest slice low and the loudest slice high', () => {
    const range = loudnessRange(realistic);
    expect(levelAtProgress([-24.9], 0, range)).toBeLessThan(0.2);
    expect(levelAtProgress([-21.6], 0, range)).toBeGreaterThan(0.8);
  });

  it('ignores outliers when setting the range', () => {
    // One digital-silence lead-in frame must not stretch the scale and squash
    // the real material back into a sliver — that is why this uses
    // percentiles rather than min/max.
    const withSilence = [-120, ...realistic];
    const a = loudnessRange(realistic);
    const b = loudnessRange(withSilence);
    expect(Math.abs(b.lo - a.lo)).toBeLessThan(6);
  });

  it('widens a near-constant track rather than dividing by ~zero', () => {
    const flat = new Array(20).fill(-20);
    const range = loudnessRange(flat);
    expect(range.hi - range.lo).toBeGreaterThanOrEqual(3);
    const lvl = levelAtProgress(flat, 0.5, range);
    expect(Number.isFinite(lvl)).toBe(true);
    expect(lvl).toBeGreaterThanOrEqual(0);
    expect(lvl).toBeLessThanOrEqual(1);
  });

  it('survives empty and non-finite input', () => {
    expect(levelAtProgress([], 0.5, loudnessRange([]))).toBe(0);
    expect(loudnessRange([])).toEqual({ lo: -45, hi: 0 });
    expect(levelAtProgress([NaN], 0, { lo: -45, hi: 0 })).toBe(0);
    expect(bassAtProgress([], 0.5)).toBe(0);
  });

  it('clamps progress outside 0..1 to the ends instead of reading undefined', () => {
    const range = loudnessRange(realistic);
    expect(Number.isFinite(levelAtProgress(realistic, -5, range))).toBe(true);
    expect(Number.isFinite(levelAtProgress(realistic, 99, range))).toBe(true);
    expect(bassAtProgress([1, 2, 3], 99)).toBeCloseTo(1, 5);
  });

  it('normalises bass against its own peak', () => {
    expect(bassAtProgress([0.5, 1], 1)).toBeCloseTo(1, 5);
    expect(bassAtProgress([0.5, 1], 0)).toBeCloseTo(0.5, 5);
    expect(bassAtProgress([0, 0], 0.5)).toBe(0);
  });

  it('finds the bass peak without spreading a long array onto the stack', () => {
    // `Math.max(...arr)` — the form this replaced — throws RangeError here.
    const long = new Array(200_000).fill(0.25);
    long[123] = 1;
    expect(() => bassAtProgress(long, 0.5)).not.toThrow();
    expect(bassAtProgress(long, 0.5)).toBeCloseTo(0.25, 5);
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
