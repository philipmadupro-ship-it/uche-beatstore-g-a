import { describe, it, expect } from 'vitest';
import {
  generateGradient, gradientCss, hashSeed, seededRandom, FALLBACK_PALETTE,
} from './gradient';
import { quantizePalette, normalisePalette } from './palette';
import {
  hexToRgb, rgbToHex, rgbToHsl, hslToRgb, luminance, adjustLightness, mix, isValidHex,
} from './color';

const BRAND = ['#7F5AF0', '#2CB67D'];

describe('colour conversions', () => {
  it('parses both hex forms and rejects junk', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('7F5AF0')).toEqual({ r: 127, g: 90, b: 240 });
    expect(hexToRgb('not-a-colour')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });

  it('round-trips rgb -> hsl -> rgb', () => {
    for (const hex of ['#7F5AF0', '#2CB67D', '#0B0B0A', '#C4B49C']) {
      const rgb = hexToRgb(hex)!;
      const back = hslToRgb(rgbToHsl(rgb));
      expect(rgbToHex(back)).toBe(hex.toLowerCase());
    }
  });

  it('uses luma, not lightness — yellow reads far brighter than blue', () => {
    const yellow = luminance(hexToRgb('#ffff00')!);
    const blue = luminance(hexToRgb('#0000ff')!);
    expect(yellow).toBeGreaterThan(blue);
    // Both are lightness 0.5 in HSL, which is exactly why luma is used.
    expect(rgbToHsl(hexToRgb('#ffff00')!).l).toBeCloseTo(0.5, 2);
    expect(rgbToHsl(hexToRgb('#0000ff')!).l).toBeCloseTo(0.5, 2);
  });

  it('clamps lightness rather than wrapping', () => {
    expect(adjustLightness('#ffffff', 0.5)).toBe('#ffffff');
    expect(adjustLightness('#000000', -0.5)).toBe('#000000');
  });

  it('mixes linearly at the endpoints and midpoint', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('leaves an invalid input alone instead of returning black', () => {
    expect(adjustLightness('garbage', 0.2)).toBe('garbage');
    expect(isValidHex('garbage')).toBe(false);
  });
});

describe('seeded randomness', () => {
  it('hashes the same string to the same number, always', () => {
    expect(hashSeed('track-1')).toBe(hashSeed('track-1'));
    expect(hashSeed('track-1')).not.toBe(hashSeed('track-2'));
  });

  it('produces a repeatable sequence in [0,1)', () => {
    const a = seededRandom(42), b = seededRandom(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateGradient', () => {
  it('is stable for a given seed — a cover must not change between renders', () => {
    const a = generateGradient(BRAND, 'track-abc');
    const b = generateGradient(BRAND, 'track-abc');
    expect(a).toEqual(b);
  });

  it('differs between seeds, so a catalogue is not one repeated background', () => {
    const seeds = Array.from({ length: 25 }, (_, i) => `track-${i}`);
    const csses = new Set(seeds.map((s) => gradientCss(BRAND, s)));
    // Allow a couple of collisions; demand real variety.
    expect(csses.size).toBeGreaterThan(20);
  });

  it('always yields usable CSS, even with no palette at all', () => {
    for (const palette of [[], ['nonsense'], ['', '   ']]) {
      const g = generateGradient(palette, 'seed');
      expect(g.css).toContain('linear-gradient');
      expect(g.stops).toHaveLength(3);
      // Falls back to the theme accent rather than producing nothing.
      expect(g.css).not.toContain('undefined');
      expect(g.css).not.toContain('NaN');
    }
  });

  it('emits only valid hex stops for a valid palette', () => {
    for (let i = 0; i < 40; i++) {
      const g = generateGradient(BRAND, `t-${i}`);
      for (const stop of g.stops) expect(isValidHex(stop.color)).toBe(true);
      expect(isValidHex(g.foreground)).toBe(true);
    }
  });

  it('keeps stop positions ordered and in range', () => {
    for (let i = 0; i < 40; i++) {
      const { stops } = generateGradient(BRAND, `t-${i}`);
      expect(stops[0].position).toBe(0);
      expect(stops[2].position).toBe(100);
      expect(stops[1].position).toBeGreaterThan(stops[0].position);
      expect(stops[1].position).toBeLessThan(stops[2].position);
    }
  });

  it('stays dark — these sit in a near-black app, never glowing', () => {
    for (let i = 0; i < 40; i++) {
      const { stops } = generateGradient(BRAND, `t-${i}`);
      for (const stop of stops) {
        expect(luminance(hexToRgb(stop.color)!)).toBeLessThan(0.55);
      }
    }
  });

  it('gives a foreground bright enough to read over that base', () => {
    for (let i = 0; i < 20; i++) {
      const { foreground } = generateGradient(BRAND, `t-${i}`);
      expect(luminance(hexToRgb(foreground)!)).toBeGreaterThan(0.6);
    }
  });

  it('keeps the angle within the art-directed range and on 5° steps', () => {
    for (let i = 0; i < 40; i++) {
      const { angle } = generateGradient(BRAND, `t-${i}`);
      expect(angle).toBeGreaterThanOrEqual(20);
      expect(angle).toBeLessThanOrEqual(160);
      expect(angle % 5).toBe(0);
    }
  });

  it('uses the fallback palette when given none', () => {
    expect(FALLBACK_PALETTE.every(isValidHex)).toBe(true);
  });
});

describe('quantizePalette', () => {
  /** Build an RGBA buffer from [colour, count] pairs. */
  const buf = (spec: Array<[number[], number]>) => {
    const out: number[] = [];
    for (const [[r, g, b, a = 255], n] of spec) {
      for (let i = 0; i < n; i++) out.push(r, g, b, a);
    }
    return out;
  };

  it('finds the dominant colour', () => {
    const px = buf([[[127, 90, 240], 100], [[44, 182, 125], 10]]);
    const palette = quantizePalette(px);
    expect(palette.length).toBeGreaterThan(0);
    const lead = hexToRgb(palette[0].hex)!;
    expect(lead.b).toBeGreaterThan(lead.g);
  });

  it('ignores transparent pixels — most logos are mostly transparent', () => {
    const px = buf([[[255, 0, 0, 0], 500], [[44, 182, 125], 20]]);
    const palette = quantizePalette(px);
    const lead = hexToRgb(palette[0].hex)!;
    // The green mark, not the invisible red field.
    expect(lead.g).toBeGreaterThan(lead.r);
  });

  it('drops near-white and near-black so the result is not grey', () => {
    const px = buf([[[255, 255, 255], 900], [[8, 8, 8], 400], [[127, 90, 240], 50]]);
    const palette = quantizePalette(px);
    expect(palette.length).toBe(1);
    const lead = hexToRgb(palette[0].hex)!;
    expect(lead.b).toBeGreaterThan(200);
  });

  it('prefers a small saturated mark over a large muted field', () => {
    const px = buf([[[130, 128, 126], 400], [[230, 20, 20], 60]]);
    const palette = quantizePalette(px);
    const lead = hexToRgb(palette[0].hex)!;
    expect(lead.r).toBeGreaterThan(lead.g + 80);
  });

  it('returns nothing when there is nothing to read, rather than inventing a colour', () => {
    expect(quantizePalette(buf([[[255, 255, 255, 0], 100]]))).toEqual([]);
    expect(quantizePalette([])).toEqual([]);
  });

  it('respects maxColors', () => {
    const px = buf([
      [[200, 30, 30], 50], [[30, 200, 30], 50], [[30, 30, 200], 50],
      [[200, 200, 30], 50], [[200, 30, 200], 50], [[30, 200, 200], 50],
    ]);
    expect(quantizePalette(px, 3)).toHaveLength(3);
  });
});

describe('normalisePalette', () => {
  it('accepts hex strings and palette entries alike', () => {
    expect(normalisePalette(['#FFF', { hex: '#7F5AF0' }])).toEqual(['#fff', '#7f5af0']);
  });

  it('adds a missing hash', () => {
    expect(normalisePalette(['7F5AF0'])).toEqual(['#7f5af0']);
  });

  it('drops duplicates and junk without throwing — stored JSON is untrusted', () => {
    expect(normalisePalette(['#fff', '#FFF', 'red', null, 42, {}, undefined]))
      .toEqual(['#fff']);
    expect(normalisePalette('not an array')).toEqual([]);
    expect(normalisePalette(null)).toEqual([]);
  });
});
