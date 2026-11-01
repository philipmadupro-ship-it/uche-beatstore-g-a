import { describe, expect, it } from 'vitest';
import { DERIVATIVE_MAX_RANGE_BYTES as CAP, planCappedRange } from './range-cap';

const SIZE = 10 * CAP;

describe('planCappedRange', () => {
  it('no Range header is the first bounded chunk, never the whole file', () => {
    expect(planCappedRange(null, SIZE)).toEqual({ ok: true, start: 0, end: CAP - 1 });
    expect(planCappedRange('', SIZE)).toEqual({ ok: true, start: 0, end: CAP - 1 });
  });
  it('an open-ended range is bounded', () => {
    expect(planCappedRange('bytes=0-', SIZE)).toEqual({ ok: true, start: 0, end: CAP - 1 });
    expect(planCappedRange('bytes=500-', SIZE)).toEqual({ ok: true, start: 500, end: 500 + CAP - 1 });
  });
  it('a range wider than the cap is clamped; a smaller one is honoured', () => {
    expect(planCappedRange(`bytes=0-${SIZE - 1}`, SIZE)).toEqual({ ok: true, start: 0, end: CAP - 1 });
    expect(planCappedRange('bytes=100-199', SIZE)).toEqual({ ok: true, start: 100, end: 199 });
  });
  it('a suffix range is the tail, bounded', () => {
    expect(planCappedRange('bytes=-100', SIZE)).toEqual({ ok: true, start: SIZE - 100, end: SIZE - 1 });
    expect(planCappedRange(`bytes=-${SIZE}`, SIZE)).toEqual({ ok: true, start: SIZE - CAP, end: SIZE - 1 });
  });
  it('the end is clamped to the file', () => {
    expect(planCappedRange(`bytes=${SIZE - 10}-${SIZE + 5000}`, SIZE)).toEqual({ ok: true, start: SIZE - 10, end: SIZE - 1 });
    expect(planCappedRange('bytes=0-', 100)).toEqual({ ok: true, start: 0, end: 99 });
  });
  it('a start past the end, an inverted range, a zero suffix or an empty file is unsatisfiable', () => {
    expect(planCappedRange(`bytes=${SIZE}-`, SIZE)).toEqual({ ok: false });
    expect(planCappedRange('bytes=200-100', SIZE)).toEqual({ ok: false });
    expect(planCappedRange('bytes=-0', SIZE)).toEqual({ ok: false });
    expect(planCappedRange('bytes=0-', 0)).toEqual({ ok: false });
  });
  it('a malformed or multi-range header is ignored, which still yields a bounded chunk', () => {
    for (const h of ['bytes=abc', 'items=0-9', 'bytes=0-9,20-29', 'bytes=-', 'bytes=1e3-']) {
      expect(planCappedRange(h, SIZE)).toEqual({ ok: true, start: 0, end: CAP - 1 });
    }
  });
  it('no input can produce a span longer than the cap', () => {
    for (const h of [null, 'bytes=0-', `bytes=0-${SIZE}`, 'bytes=-99999999', 'bytes=7-99999999999']) {
      const p = planCappedRange(h, SIZE);
      if (p.ok) expect(p.end - p.start + 1).toBeLessThanOrEqual(CAP);
    }
  });
});
