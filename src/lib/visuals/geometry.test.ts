import { describe, expect, it } from 'vitest';
import {
  BAND_COUNT, bandsFromPeaks, bucketPeaks, createHistory, fillHistoryFromPeaks, historyRow, isFlat, logBands,
  polar, project, pushHistory, smoothDecay, type Camera,
} from './geometry';

describe('bucketPeaks', () => {
  it('keeps the peak of each bucket, not a point sample', () => {
    const src = [0, 0, 0.9, 0, 0, 0, 0, 0.5];
    const out = bucketPeaks(src, new Float32Array(2));
    expect(out[0]).toBeCloseTo(0.9);
    expect(out[1]).toBeCloseTo(0.5);
  });
  it('upsamples without dropping to zero and handles empty input', () => {
    const up = bucketPeaks([0.4, 0.8], new Float32Array(6));
    expect(Array.from(up).every((v) => v > 0)).toBe(true);
    expect(Array.from(bucketPeaks([], new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

describe('logBands', () => {
  it('maps a low-frequency bin into a low band and normalises to 0..1', () => {
    const fft = new Uint8Array(1024);
    fft[4] = 255; // ~86 Hz at 44.1k/2048
    const out = logBands(fft, new Float32Array(BAND_COUNT), 44100);
    const idx = out.findIndex((v) => v > 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(BAND_COUNT / 3);
    expect(Math.max(...out)).toBe(1);
  });
});

describe('smoothDecay', () => {
  it('rises fast and falls slowly', () => {
    const s = new Float32Array([0]);
    smoothDecay(s, [1]);
    const up = s[0];
    expect(up).toBeGreaterThan(0.5);
    smoothDecay(s, [0]);
    expect(s[0]).toBeGreaterThan(up * 0.8); // slow release
    expect(s[0]).toBeLessThan(up);
  });
});

describe('history ring', () => {
  it('keeps newest at age 0 and wraps', () => {
    const h = createHistory(3, 2);
    for (const v of [1, 2, 3, 4]) pushHistory(h, new Float32Array([v, v]));
    expect(historyRow(h, 0)[0]).toBe(4);
    expect(historyRow(h, 1)[0]).toBe(3);
    expect(historyRow(h, 2)[0]).toBe(2);
  });
});

describe('project', () => {
  const cam: Camera = { width: 400, height: 200, distance: 2.6, heightScale: 0.4, horizon: 0.9 };
  const a = { x: 0, y: 0, s: 1 };
  const b = { x: 0, y: 0, s: 1 };
  it('near rows are bigger and lower on screen than far rows', () => {
    project(cam, 0.5, 0, -1, a);
    project(cam, 0.5, 0, 1, b);
    expect(b.s).toBeGreaterThan(a.s);
    expect(b.y).toBeGreaterThan(a.y);
    expect(Math.abs(b.x - 200)).toBeGreaterThan(Math.abs(a.x - 200));
  });
  it('height raises the point and centre x maps to the middle', () => {
    project(cam, 0, 0, 0, a);
    project(cam, 0, 1, 0, b);
    expect(a.x).toBeCloseTo(200);
    expect(b.y).toBeLessThan(a.y);
  });
});

describe('polar', () => {
  it('starts at the top and goes clockwise', () => {
    const o = { x: 0, y: 0 };
    polar(0, 4, 10, 0, 0, o);
    expect(o.x).toBeCloseTo(0); expect(o.y).toBeCloseTo(-10);
    polar(1, 4, 10, 0, 0, o);
    expect(o.x).toBeCloseTo(10); expect(o.y).toBeCloseTo(0, 5);
  });
});

describe('bandsFromPeaks / fillHistoryFromPeaks', () => {
  const peaks = Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.1 : 0.9));
  it('follows the playhead along the peaks', () => {
    const early = bandsFromPeaks(peaks, 0.1, new Float32Array(16)).slice();
    const late = bandsFromPeaks(peaks, 0.9, new Float32Array(16)).slice();
    expect(Math.max(...late)).toBeGreaterThan(Math.max(...early) * 3);
  });
  it('is stable at the ends and with no peaks', () => {
    expect(Array.from(bandsFromPeaks([], 0.5, new Float32Array(4)))).toEqual([0, 0, 0, 0]);
    const end = bandsFromPeaks(peaks, 1, new Float32Array(8));
    expect(Array.from(end).every(Number.isFinite)).toBe(true);
  });
  it('fills every history row', () => {
    const h = createHistory(5, 8);
    fillHistoryFromPeaks(peaks, 0.9, h, new Float32Array(8));
    for (let a = 0; a < 5; a += 1) expect(Math.max(...historyRow(h, a))).toBeGreaterThan(0);
  });
});

describe('isFlat', () => {
  it('detects a silent analyser', () => {
    expect(isFlat(new Uint8Array(8))).toBe(true);
    expect(isFlat(new Uint8Array([0, 0, 9]))).toBe(false);
  });
});
