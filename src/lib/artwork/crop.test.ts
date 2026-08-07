import { describe, it, expect } from 'vitest';
import {
  coverScale, renderedSize, clampOffset, clampScale, cropRect, initialCrop,
  MIN_SCALE, MAX_SCALE,
} from './crop';

const FRAME = 300;
const landscape = { width: 1600, height: 900 };
const portrait = { width: 900, height: 1600 };
const square = { width: 1000, height: 1000 };

describe('coverScale', () => {
  it('scales by the short edge so the frame is always covered', () => {
    // Landscape: height is the constraint.
    expect(coverScale(landscape, FRAME)).toBeCloseTo(FRAME / 900);
    // Portrait: width is.
    expect(coverScale(portrait, FRAME)).toBeCloseTo(FRAME / 900);
  });

  it('survives a degenerate image rather than dividing by zero', () => {
    expect(coverScale({ width: 0, height: 0 }, FRAME)).toBe(1);
  });
});

describe('renderedSize', () => {
  it('exactly covers the frame at scale 1', () => {
    for (const img of [landscape, portrait, square]) {
      const s = renderedSize(img, FRAME, 1);
      expect(Math.min(s.width, s.height)).toBeCloseTo(FRAME);
      expect(s.width).toBeGreaterThanOrEqual(FRAME - 0.001);
      expect(s.height).toBeGreaterThanOrEqual(FRAME - 0.001);
    }
  });
});

describe('clampOffset', () => {
  it('does not let the frame slide off the image', () => {
    // A wild drag must be pulled back to the edge, not accepted.
    const o = clampOffset(landscape, FRAME, 1, { x: 99999, y: 99999 });
    const size = renderedSize(landscape, FRAME, 1);
    expect(o.x).toBeCloseTo((size.width - FRAME) / 2);
    // Height exactly covers, so there is no vertical slack at all.
    expect(o.y).toBeCloseTo(0);
  });

  it('pins a square image at scale 1 — nothing to pan', () => {
    expect(clampOffset(square, FRAME, 1, { x: 50, y: -50 })).toEqual({ x: 0, y: 0 });
  });

  it('opens up slack once zoomed in', () => {
    const o = clampOffset(square, FRAME, 2, { x: 9999, y: 9999 });
    expect(o.x).toBeCloseTo(FRAME / 2);
    expect(o.y).toBeCloseTo(FRAME / 2);
  });
});

describe('clampScale', () => {
  it('never underfills and never zooms to mush', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });

  it('recovers from NaN rather than propagating it into the rect', () => {
    expect(clampScale(NaN)).toBe(MIN_SCALE);
  });
});

describe('cropRect', () => {
  it('takes a centred square at rest', () => {
    const r = cropRect(landscape, FRAME, initialCrop());
    expect(r.width).toBeCloseTo(900);
    expect(r.height).toBeCloseTo(900);
    // Horizontally centred in a 1600-wide source.
    expect(r.x).toBeCloseTo((1600 - 900) / 2);
    expect(r.y).toBeCloseTo(0);
  });

  it('is always square, whatever the source aspect', () => {
    for (const img of [landscape, portrait, square]) {
      for (const scale of [1, 1.7, 3]) {
        const r = cropRect(img, FRAME, { scale, offset: { x: 20, y: -35 } });
        expect(r.width).toBeCloseTo(r.height);
      }
    }
  });

  it('never reads outside the source — that is where transparent pixels come from', () => {
    for (const img of [landscape, portrait, square]) {
      for (const offset of [{ x: 1e6, y: 1e6 }, { x: -1e6, y: -1e6 }]) {
        const r = cropRect(img, FRAME, { scale: 1, offset });
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(img.width + 0.001);
        expect(r.y + r.height).toBeLessThanOrEqual(img.height + 0.001);
      }
    }
  });

  it('zooming in selects less of the source', () => {
    const wide = cropRect(square, FRAME, { scale: 1, offset: { x: 0, y: 0 } });
    const tight = cropRect(square, FRAME, { scale: 2, offset: { x: 0, y: 0 } });
    expect(tight.width).toBeLessThan(wide.width);
  });

  it('panning right moves the selection right', () => {
    const centre = cropRect(landscape, FRAME, { scale: 1, offset: { x: 0, y: 0 } });
    // Negative offset moves the image left, so the crop window moves right.
    const shifted = cropRect(landscape, FRAME, { scale: 1, offset: { x: -50, y: 0 } });
    expect(shifted.x).toBeGreaterThan(centre.x);
  });

  it('clamps an out-of-range scale instead of producing a bad rect', () => {
    const r = cropRect(square, FRAME, { scale: 0.1, offset: { x: 0, y: 0 } });
    expect(r.width).toBeCloseTo(1000);
    expect(Number.isNaN(r.x)).toBe(false);
  });
});
