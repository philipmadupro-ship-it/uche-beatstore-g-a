import { describe, expect, it } from 'vitest';
import {
  GUIDE_TOLERANCE, MIN_MAJOR_PIXELS, addGuide, clearGuides, emptyGuides, formatRulerLabel,
  guideCount, guideNear, guidesDefaults, moveGuide, niceStep, removeGuide, rulerStep, rulerTicks,
} from './rulers';

describe('niceStep', () => {
  it('returns the 1-2-5 value at or above the minimum', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.1)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(6)).toBe(10);
    expect(niceStep(120)).toBe(200);
    expect(niceStep(300)).toBe(500);
    expect(niceStep(600)).toBe(1000);
  });

  it('returns an exact power of ten unchanged rather than the next one up', () => {
    // The floating-point trap: log10(1000) can come back as 2.9999999999999996,
    // which rounds the magnitude down a decade and returns 2000 for 1000.
    expect(niceStep(10)).toBe(10);
    expect(niceStep(100)).toBe(100);
    expect(niceStep(1000)).toBe(1000);
    expect(niceStep(10000)).toBe(10000);
  });

  it('returns an exact 2 or 5 multiple unchanged', () => {
    expect(niceStep(200)).toBe(200);
    expect(niceStep(500)).toBe(500);
    expect(niceStep(2000)).toBe(2000);
  });

  it('never returns zero or a negative for junk input', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-50)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });

  it('always returns a value that is 1, 2 or 5 times a power of ten', () => {
    for (const minimum of [0.4, 3, 17, 73, 412, 1234, 45000]) {
      const step = niceStep(minimum);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
      expect(step).toBeGreaterThanOrEqual(minimum);
    }
  });
});

describe('rulerStep', () => {
  it('keeps major ticks at least the minimum distance apart on screen', () => {
    for (const zoom of [0.05, 0.12, 0.22, 0.5, 1, 2]) {
      expect(rulerStep(zoom) * zoom).toBeGreaterThanOrEqual(MIN_MAJOR_PIXELS - 1e-9);
    }
  });

  it('uses a coarser step as you zoom out', () => {
    // The whole point: a fixed step is mush at 8% and empty at 200%.
    expect(rulerStep(0.1)).toBeGreaterThan(rulerStep(1));
    expect(rulerStep(1)).toBeGreaterThan(rulerStep(4));
  });

  it('survives a zero or nonsense zoom', () => {
    expect(rulerStep(0)).toBeGreaterThan(0);
    expect(rulerStep(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('rulerTicks', () => {
  it('returns nothing for an empty document', () => {
    expect(rulerTicks(0, 1)).toEqual([]);
    expect(rulerTicks(-100, 1)).toEqual([]);
  });

  it('starts at zero and ends exactly on the document edge', () => {
    // A 3000px board must show 3000, whatever the step rhythm would have done.
    const ticks = rulerTicks(3000, 0.22);
    expect(ticks[0].position).toBe(0);
    expect(ticks.at(-1)!.position).toBe(3000);
  });

  it('ends on the edge even when the step does not divide the length', () => {
    const ticks = rulerTicks(1337, 0.22);
    expect(ticks.at(-1)!.position).toBe(1337);
    expect(ticks.at(-1)!.major).toBe(true);
  });

  it('labels majors and leaves minors unlabelled', () => {
    const ticks = rulerTicks(3000, 1);
    const majors = ticks.filter((tick) => tick.major);
    const minors = ticks.filter((tick) => !tick.major);
    expect(majors.length).toBeGreaterThan(0);
    expect(minors.length).toBeGreaterThan(0);
    majors.forEach((tick) => expect(tick.label).not.toBeNull());
    minors.forEach((tick) => expect(tick.label).toBeNull());
  });

  it('puts every major on a multiple of the step', () => {
    const zoom = 0.5;
    const step = rulerStep(zoom);
    const ticks = rulerTicks(3000, zoom);
    // The forced final tick is allowed to break the rhythm; everything else
    // must sit on the grid or the ruler reads as noise.
    ticks.slice(0, -1).filter((tick) => tick.major).forEach((tick) => {
      expect(Math.abs(tick.position % step)).toBeLessThan(1e-6);
    });
  });

  it('never crowds minor ticks, at any zoom', () => {
    // This is a property of the step rather than a separate check: because
    // majors are at least MIN_MAJOR_PIXELS apart, a fifth of that is always
    // legible. A guard for it was written first and was provably dead code.
    for (const zoom of [0.02, 0.03, 0.08, 0.22, 0.5, 1, 2]) {
      const ticks = rulerTicks(3000, zoom).filter((tick) => tick.position < 3000);
      for (let index = 1; index < ticks.length; index += 1) {
        const gap = (ticks[index].position - ticks[index - 1].position) * zoom;
        expect(gap).toBeGreaterThanOrEqual(MIN_MAJOR_PIXELS / 5 - 1e-9);
      }
    }
  });

  it('never emits a tick past the document', () => {
    for (const zoom of [0.05, 0.22, 1, 2]) {
      for (const tick of rulerTicks(3000, zoom)) {
        expect(tick.position).toBeLessThanOrEqual(3000);
        expect(tick.position).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('stays a sane length at every usable zoom', () => {
    for (const zoom of [0.02, 0.05, 0.22, 0.5, 1, 2]) {
      const ticks = rulerTicks(3000, zoom);
      expect(ticks.length).toBeLessThan(400);
    }
  });
});

describe('formatRulerLabel', () => {
  it('shows whole document units', () => {
    expect(formatRulerLabel(0)).toBe('0');
    expect(formatRulerLabel(1500)).toBe('1500');
    expect(formatRulerLabel(1499.6)).toBe('1500');
  });
});

describe('guidesDefaults', () => {
  it('treats undefined as no guides, so older documents keep opening', () => {
    expect(guidesDefaults(undefined)).toEqual(emptyGuides);
    expect(guidesDefaults(null)).toEqual(emptyGuides);
    expect(guidesDefaults({})).toEqual(emptyGuides);
  });

  it('drops non-finite entries from a hand-edited document', () => {
    expect(guidesDefaults({ x: [10, Number.NaN, 20], y: [] }).x).toEqual([10, 20]);
  });

  it('survives a wrong-typed field', () => {
    expect(guidesDefaults({ x: 'nope' } as never)).toEqual(emptyGuides);
  });
});

describe('addGuide', () => {
  it('adds a guide on the named axis only', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(guides.x).toEqual([500]);
    expect(guides.y).toEqual([]);
  });

  it('keeps guides sorted', () => {
    let guides = addGuide(emptyGuides, 'x', 900, 3000);
    guides = addGuide(guides, 'x', 100, 3000);
    guides = addGuide(guides, 'x', 500, 3000);
    expect(guides.x).toEqual([100, 500, 900]);
  });

  it('clamps to the artboard', () => {
    expect(addGuide(emptyGuides, 'x', -50, 3000).x).toEqual([0]);
    expect(addGuide(emptyGuides, 'x', 99999, 3000).x).toEqual([3000]);
  });

  it('rounds to whole document units', () => {
    expect(addGuide(emptyGuides, 'y', 412.7, 3000).y).toEqual([413]);
  });

  it('refuses a duplicate, so two guides cannot stack invisibly', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(addGuide(guides, 'x', 500, 3000)).toBe(guides);
    expect(addGuide(guides, 'x', 501, 3000)).toBe(guides);
  });

  it('allows a guide just outside the merge tolerance', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(addGuide(guides, 'x', 500 + GUIDE_TOLERANCE + 1, 3000).x).toHaveLength(2);
  });

  it('ignores a non-finite position rather than storing NaN', () => {
    expect(addGuide(emptyGuides, 'x', Number.NaN, 3000)).toBe(emptyGuides);
  });

  it('does not mutate its input', () => {
    const guides = { x: [100], y: [] };
    addGuide(guides, 'x', 500, 3000);
    expect(guides.x).toEqual([100]);
  });
});

describe('removeGuide', () => {
  it('removes the guide at a position', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(removeGuide(guides, 'x', 500).x).toEqual([]);
  });

  it('removes within the tolerance, so an imprecise drag still lands', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(removeGuide(guides, 'x', 501).x).toEqual([]);
  });

  it('is a no-op when nothing is there', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(removeGuide(guides, 'x', 900)).toBe(guides);
    expect(removeGuide(guides, 'y', 500)).toBe(guides);
  });
});

describe('moveGuide', () => {
  it('moves a guide to a new position', () => {
    const guides = addGuide(emptyGuides, 'x', 500, 3000);
    expect(moveGuide(guides, 'x', 500, 900, 3000).x).toEqual([900]);
  });

  it('clamps the destination to the artboard', () => {
    const guides = addGuide(emptyGuides, 'y', 500, 3000);
    expect(moveGuide(guides, 'y', 500, 99999, 3000).y).toEqual([3000]);
  });

  it('merges rather than stacking when dropped onto another guide', () => {
    let guides = addGuide(emptyGuides, 'x', 300, 3000);
    guides = addGuide(guides, 'x', 900, 3000);
    const merged = moveGuide(guides, 'x', 300, 900, 3000);
    expect(merged.x).toEqual([900]);
  });

  it('leaves the other axis alone', () => {
    let guides = addGuide(emptyGuides, 'x', 300, 3000);
    guides = addGuide(guides, 'y', 400, 3000);
    expect(moveGuide(guides, 'x', 300, 800, 3000).y).toEqual([400]);
  });
});

describe('guideNear', () => {
  const guides = { x: [200, 900], y: [1500] };

  it('finds a guide within tolerance', () => {
    expect(guideNear(guides, 'x', 205, 10)).toBe(200);
  });

  it('returns null when nothing is close', () => {
    expect(guideNear(guides, 'x', 600, 10)).toBeNull();
  });

  it('picks the closest when two are in range', () => {
    expect(guideNear({ x: [500, 520], y: [] }, 'x', 515, 30)).toBe(520);
  });

  it('searches the requested axis only', () => {
    expect(guideNear(guides, 'y', 200, 10)).toBeNull();
  });
});

describe('bookkeeping helpers', () => {
  it('counts both axes', () => {
    expect(guideCount({ x: [1, 2], y: [3] })).toBe(3);
    expect(guideCount(emptyGuides)).toBe(0);
  });

  it('clears to a fresh object rather than the shared empty one', () => {
    const cleared = clearGuides();
    expect(cleared).toEqual(emptyGuides);
    expect(cleared).not.toBe(emptyGuides);
  });
});

describe('dragging a guide from a fixed snapshot', () => {
  /**
   * The canvas rebuilds the guide list from a snapshot taken at drag start
   * rather than from the live document, because two pointermove events can
   * fire before React flushes the previous update. These assert the property
   * that makes that safe: replaying from the same snapshot is idempotent, and
   * never leaves a trail of duplicates behind the pointer.
   */
  const start = addGuide(emptyGuides, 'x', 300, 3000);

  it('lands on the same result no matter how many moves replayed', () => {
    const once = moveGuide(start, 'x', 300, 900, 3000);
    const twice = moveGuide(start, 'x', 300, 900, 3000);
    expect(once).toEqual(twice);
    expect(once.x).toEqual([900]);
  });

  it('leaves exactly one guide after a long drag replayed step by step', () => {
    // Replaying every intermediate position from the snapshot — which is what
    // a fast drag does — must not accumulate a guide per step.
    let result = start;
    for (const position of [320, 400, 512, 640, 780, 900]) {
      result = moveGuide(start, 'x', 300, position, 3000);
    }
    expect(result.x).toEqual([900]);
  });

  it('removes the original when the drag is discarded off the artboard', () => {
    expect(removeGuide(start, 'x', 300).x).toEqual([]);
  });

  it('keys off the drag-start position, not wherever the guide is now', () => {
    // Using the CURRENT origin against a stale list is the bug: the list still
    // holds the guide at 300, so removing "500" finds nothing and the add
    // leaves two.
    const stale = moveGuide(start, 'x', 500, 700, 3000);
    expect(stale.x).toEqual([300, 700]);
    const correct = moveGuide(start, 'x', 300, 700, 3000);
    expect(correct.x).toEqual([700]);
  });
});
