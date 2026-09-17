import { describe, expect, it } from 'vitest';
import {
  defaultTextPath, flattenForPath, hasTextPath, textPathD, textPathDefaults,
  textPathPlacement, textPathShapes,
} from './text-path';

/** Every number in a `d` string, for shape assertions. */
const numbersIn = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('textPathDefaults', () => {
  it('treats an unset path as flat', () => {
    expect(textPathDefaults(undefined).shape).toBe('none');
    expect(textPathDefaults(null).shape).toBe('none');
    expect(textPathDefaults({}).shape).toBe('none');
  });

  it('keeps a valid shape', () => {
    expect(textPathDefaults({ shape: 'arc' }).shape).toBe('arc');
    expect(textPathDefaults({ shape: 'circle' }).shape).toBe('circle');
  });

  it('falls back rather than trusting a shape from a hand-edited document', () => {
    expect(textPathDefaults({ shape: 'spiral' as never }).shape).toBe('none');
  });

  it('clamps curvature into range', () => {
    expect(textPathDefaults({ shape: 'arc', curvature: 9 }).curvature).toBe(1);
    expect(textPathDefaults({ shape: 'arc', curvature: -9 }).curvature).toBe(-1);
  });

  it('replaces a non-finite curvature with the default', () => {
    expect(textPathDefaults({ shape: 'arc', curvature: Number.NaN }).curvature)
      .toBe(defaultTextPath.curvature);
  });

  it('keeps an explicit zero rather than falling back', () => {
    // `??` not `||` — a zero curvature is a flat arc, which is a real choice.
    expect(textPathDefaults({ shape: 'arc', curvature: 0 }).curvature).toBe(0);
  });
});

describe('textPathD', () => {
  it('returns null for flat text, so it keeps the ordinary text element', () => {
    // A degenerate straight <textPath> would still lose wrapping and multi-line
    // support, so "none" has to mean "not a path at all".
    expect(textPathD({ shape: 'none', curvature: 0.5 }, 800, 300)).toBeNull();
  });

  it('returns null for a zero-sized layer rather than emitting NaN', () => {
    expect(textPathD({ shape: 'arc', curvature: 0.5 }, 0, 300)).toBeNull();
    expect(textPathD({ shape: 'arc', curvature: 0.5 }, 800, 0)).toBeNull();
  });

  it('spans the full layer width for an arc', () => {
    const d = textPathD({ shape: 'arc', curvature: 0.5 }, 800, 300)!;
    expect(d.startsWith('M 0 ')).toBe(true);
    expect(d).toContain('800');
  });

  it('bulges up for positive curvature and down for negative', () => {
    const baseline = numbersIn(textPathD({ shape: 'arc', curvature: 0 }, 800, 300)!)[1];
    const up = numbersIn(textPathD({ shape: 'arc', curvature: 0.8 }, 800, 300)!);
    const down = numbersIn(textPathD({ shape: 'arc', curvature: -0.8 }, 800, 300)!);
    // SVG y grows downward, so "up" means a smaller control-point y.
    expect(up[3]).toBeLessThan(baseline);
    expect(down[3]).toBeGreaterThan(baseline);
  });

  it('is symmetric about zero curvature', () => {
    const up = numbersIn(textPathD({ shape: 'arc', curvature: 0.6 }, 800, 300)!);
    const down = numbersIn(textPathD({ shape: 'arc', curvature: -0.6 }, 800, 300)!);
    const baseline = up[1];
    expect(baseline - up[3]).toBeCloseTo(down[3] - baseline, 4);
  });

  it('draws a circle as two half-arcs, not one impossible full arc', () => {
    // A single arc command cannot express 360°: start and end coincide, and the
    // renderer cannot tell a full turn from no turn, so it draws nothing.
    const d = textPathD({ shape: 'circle', curvature: 0 }, 600, 600)!;
    expect((d.match(/a /g) ?? []).length).toBe(2);
  });

  it('keeps the circle inside the layer bounds', () => {
    const size = 600;
    const d = textPathD({ shape: 'circle', curvature: 0 }, size, size)!;
    const values = numbersIn(d);
    const startX = values[0];
    const radius = values[2];
    expect(startX).toBeGreaterThanOrEqual(0);
    expect(startX + radius * 2).toBeLessThanOrEqual(size);
  });

  it('sizes the circle off the shorter side so it fits either way round', () => {
    const wide = numbersIn(textPathD({ shape: 'circle', curvature: 0 }, 900, 300)!)[2];
    const tall = numbersIn(textPathD({ shape: 'circle', curvature: 0 }, 300, 900)!)[2];
    expect(wide).toBeCloseTo(tall, 4);
  });

  it('ignores curvature for a circle, which has none to vary', () => {
    const a = textPathD({ shape: 'circle', curvature: 1 }, 600, 600);
    const b = textPathD({ shape: 'circle', curvature: -1 }, 600, 600);
    expect(a).toBe(b);
  });

  it('draws a wave as two cubic segments returning to the baseline', () => {
    const d = textPathD({ shape: 'wave', curvature: 0.6 }, 800, 300)!;
    expect((d.match(/C /g) ?? []).length).toBe(2);
    const values = numbersIn(d);
    // Starts and ends at the same y.
    expect(values[1]).toBeCloseTo(values[values.length - 1], 4);
    expect(values[values.length - 2]).toBe(800);
  });

  it('never emits NaN or Infinity into a path', () => {
    for (const shape of textPathShapes) {
      for (const curvature of [-1, -0.3, 0, 0.3, 1]) {
        const d = textPathD({ shape, curvature }, 812, 337);
        if (d === null) continue;
        expect(d).not.toContain('NaN');
        expect(d).not.toContain('Infinity');
      }
    }
  });

  it('scales with the layer, so resizing keeps the shape', () => {
    const small = numbersIn(textPathD({ shape: 'arc', curvature: 0.5 }, 400, 200)!);
    const large = numbersIn(textPathD({ shape: 'arc', curvature: 0.5 }, 800, 400)!);
    // Every coordinate doubles when the layer doubles.
    small.forEach((value, index) => expect(large[index]).toBeCloseTo(value * 2, 1));
  });
});

describe('textPathPlacement', () => {
  it('pairs the offset with a matching anchor', () => {
    // These must agree, or the string runs off the end of the path: anchoring
    // at the middle while starting at 0% puts half of it before the path.
    expect(textPathPlacement('left')).toEqual({ startOffset: '0%', anchor: 'start' });
    expect(textPathPlacement('center')).toEqual({ startOffset: '50%', anchor: 'middle' });
    expect(textPathPlacement('right')).toEqual({ startOffset: '100%', anchor: 'end' });
  });
});

describe('flattenForPath', () => {
  it('joins lines into one run, since a path has no lines', () => {
    expect(flattenForPath('MIDNIGHT\nCARTEL')).toBe('MIDNIGHT CARTEL');
  });

  it('keeps every line rather than silently dropping all but the first', () => {
    expect(flattenForPath('A\nB\nC')).toBe('A B C');
  });

  it('drops blank lines and trims', () => {
    expect(flattenForPath('  A  \n\n  B ')).toBe('A B');
  });

  it('handles single-line and empty input', () => {
    expect(flattenForPath('SOLO')).toBe('SOLO');
    expect(flattenForPath('')).toBe('');
    expect(flattenForPath('\n\n')).toBe('');
  });
});

describe('hasTextPath', () => {
  it('is false only for the flat case', () => {
    expect(hasTextPath(undefined)).toBe(false);
    expect(hasTextPath({ shape: 'none', curvature: 1 })).toBe(false);
    expect(hasTextPath({ shape: 'arc', curvature: 0 })).toBe(true);
    expect(hasTextPath({ shape: 'circle', curvature: 0 })).toBe(true);
    expect(hasTextPath({ shape: 'wave', curvature: 0 })).toBe(true);
  });
});
