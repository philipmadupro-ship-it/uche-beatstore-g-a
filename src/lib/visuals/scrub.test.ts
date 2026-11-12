import { describe, expect, it } from 'vitest';
import {
  advancePosition, bandEnergies, envFollow, scrubFraction, tapFraction,
} from './scrub';

describe('bandEnergies', () => {
  it('routes low / mid / high bands to red / green / blue order (low, mid, high)', () => {
    const bands = new Float32Array(64);
    bands[3] = 1;
    const e = bandEnergies(bands, new Float32Array(3));
    expect(e[0]).toBeGreaterThan(0.5);
    expect(e[1]).toBe(0); expect(e[2]).toBe(0);
    bands.fill(0); bands[60] = 1;
    bandEnergies(bands, e);
    expect(e[2]).toBeGreaterThan(0.5);
    expect(e[0]).toBe(0);
  });
});

describe('envFollow', () => {
  it('attacks fast and releases in roughly 120–200 ms', () => {
    expect(envFollow(0, 1, 1 / 60)).toBeGreaterThan(0.5);
    let v = 1;
    for (let i = 0; i < 10; i += 1) v = envFollow(v, 0, 1 / 60); // ~167 ms
    expect(v).toBeGreaterThan(0.25);
    expect(v).toBeLessThan(0.45);
  });
  it('is frame-rate independent', () => {
    let a = 1; for (let i = 0; i < 6; i += 1) a = envFollow(a, 0, 1 / 30);
    let b = 1; for (let i = 0; i < 12; i += 1) b = envFollow(b, 0, 1 / 60);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('advancePosition', () => {
  it('follows a seek immediately', () => { expect(advancePosition(0.1, 0.6, 0.001, true)).toBe(0.6); });
  it('extrapolates while playing and is pulled toward the report', () => {
    const next = advancePosition(0.5, 0.5, 0.002, true);
    expect(next).toBeGreaterThan(0.5);
    expect(next).toBeLessThan(0.503);
  });
  it('eases when paused', () => { expect(advancePosition(0.5, 0.51, 0.01, false)).toBeCloseTo(0.5025); });
});

describe('scrub / tap', () => {
  it('dragging content right goes earlier; left goes later', () => {
    expect(scrubFraction(0.5, 100, 400, 14, 100)).toBeLessThan(0.5);
    expect(scrubFraction(0.5, -100, 400, 14, 100)).toBeGreaterThan(0.5);
    expect(scrubFraction(0.01, 4000, 400, 14, 100)).toBe(0);
  });
  it('a tap at the centre stays put; at the right edge jumps half a window ahead', () => {
    expect(tapFraction(0.3, 200, 400, 14, 100)).toBeCloseTo(0.3);
    expect(tapFraction(0.3, 400, 400, 14, 100)).toBeCloseTo(0.3 + 0.07);
  });
  it('is safe with no duration', () => { expect(scrubFraction(0.4, 50, 400, 14, 0)).toBe(0.4); });
});
