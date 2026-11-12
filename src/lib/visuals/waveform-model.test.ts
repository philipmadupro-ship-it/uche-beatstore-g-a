import { describe, expect, it } from 'vitest';
import { CROSSOVER_HIGH_HZ, CROSSOVER_LOW_HZ, buildWaveformModel, waveformCacheKey } from './waveform-model';

const SR = 22050;
const sine = (hz: number, seconds = 1, amp = 0.8): Float32Array => {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};
const maxOf = (a: Uint8Array) => a.reduce((m, v) => (v > m ? v : m), 0);
// skip the first ~50 ms (filter start-up) when judging a steady tone
const steady = (a: Uint8Array) => a.slice(Math.ceil(a.length * 0.2));

describe('buildWaveformModel', () => {
  it('exports the crossovers', () => {
    expect(CROSSOVER_LOW_HZ).toBe(250);
    expect(CROSSOVER_HIGH_HZ).toBe(4000);
  });
  it('a 60 Hz sine is low, not mid or high', () => {
    const m = buildWaveformModel(sine(60), SR);
    expect(maxOf(steady(m.low))).toBeGreaterThan(200);
    expect(maxOf(steady(m.low))).toBeGreaterThan(maxOf(steady(m.mid)) * 4);
    expect(maxOf(steady(m.low))).toBeGreaterThan(maxOf(steady(m.high)) * 20);
  });
  it('a 1 kHz sine is mid-dominant', () => {
    const m = buildWaveformModel(sine(1000), SR);
    expect(maxOf(steady(m.mid))).toBeGreaterThan(maxOf(steady(m.low)) * 8);
    expect(maxOf(steady(m.mid))).toBeGreaterThan(maxOf(steady(m.high)) * 8);
  });
  it('an 8 kHz sine is high-dominant', () => {
    const m = buildWaveformModel(sine(8000), SR);
    expect(maxOf(steady(m.high))).toBeGreaterThan(maxOf(steady(m.mid)) * 4);
    expect(maxOf(steady(m.high))).toBeGreaterThan(maxOf(steady(m.low)) * 20);
  });
  it('silence is all zeros', () => {
    const m = buildWaveformModel(new Float32Array(SR), SR);
    for (const k of ['all', 'low', 'mid', 'high'] as const) expect(maxOf(m[k])).toBe(0);
    expect(m.peak).toBe(0);
  });
  it('normalises globally: the loudest column of the mix is 255, a quieter passage keeps its ratio', () => {
    const loud = sine(200, 1, 0.8);
    const quiet = sine(200, 1, 0.2);
    const both = new Float32Array(loud.length + quiet.length);
    both.set(loud); both.set(quiet, loud.length);
    const m = buildWaveformModel(both, SR);
    expect(maxOf(m.all)).toBe(255);
    const half = Math.floor(m.all.length / 2);
    const quietMax = maxOf(m.all.slice(half + 5));
    expect(quietMax / 255).toBeGreaterThan(0.2);
    expect(quietMax / 255).toBeLessThan(0.3); // 0.2 / 0.8 = 0.25, not rescaled per column
  });
  it('is PEAK, not RMS: one click in a column reaches the full scale', () => {
    const x = new Float32Array(SR); // 1 s of silence...
    x[SR / 2] = 0.9;                // ...and a single-sample click
    const m = buildWaveformModel(x, SR);
    expect(maxOf(m.all)).toBe(255);
  });
  it('column count follows columnsPerSecond', () => {
    expect(buildWaveformModel(sine(100, 2), SR).all.length).toBe(882);
    expect(buildWaveformModel(sine(100, 2), SR, 100).all.length).toBe(200);
    expect(buildWaveformModel(new Float32Array(0), SR).all.length).toBe(0);
  });
  it('a constant start (no ramp-in) does not ring the low band at column 0', () => {
    const dc = new Float32Array(SR).fill(0.5);
    const m = buildWaveformModel(dc, SR);
    expect(m.low[0]).toBeGreaterThan(200); // low-pass is settled on the level, not ramping from 0
    expect(m.high[0]).toBeLessThan(10);    // high-pass does not step-ring
  });
});

describe('waveformCacheKey', () => {
  it('separates source and resolution so a sidecar is never mistaken for an analysis', () => {
    const a = waveformCacheKey('t', 'u', 'analysis', 441);
    expect(a).not.toBe(waveformCacheKey('t', 'u', 'sidecar', 441));
    expect(a).not.toBe(waveformCacheKey('t', 'u', 'analysis', 512));
    expect(a).not.toBe(waveformCacheKey('t', 'u2', 'analysis', 441));
    expect(a).toBe(waveformCacheKey('t', 'u', 'analysis', 441));
  });
});
