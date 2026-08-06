import { describe, it, expect } from 'vitest';
import {
  colorForTag, paletteForTags, normaliseTagColors, normaliseTagKey,
} from './tag-colors';
import { generateGradient } from './gradient';
import { hexToRgb, rgbToHsl, isValidHex } from './color';

const hueOf = (hex: string) => rgbToHsl(hexToRgb(hex)!).h;
const BRAND = ['#ee976c', '#966da4'];

describe('colorForTag', () => {
  it('is stable for the same tag', () => {
    expect(colorForTag('Trap')).toBe(colorForTag('Trap'));
  });

  it('ignores case and surrounding space', () => {
    expect(colorForTag('  TRAP ')).toBe(colorForTag('trap'));
    expect(normaliseTagKey('  Trap ')).toBe('trap');
  });

  it('gives different tags different colours', () => {
    const tags = ['Trap', 'Drill', 'Afrobeats', 'R&B', 'Lo-fi', 'Pop'];
    expect(new Set(tags.map((t) => colorForTag(t))).size).toBe(tags.length);
  });

  it('uses curated hues where meaning matters — Dark is not yellow', () => {
    const dark = hueOf(colorForTag('Dark'));
    // Blue-violet, not the 40-70° yellow band a hash could easily land on.
    expect(dark).toBeGreaterThan(200);
    expect(dark).toBeLessThan(300);
    const aggressive = hueOf(colorForTag('Aggressive'));
    expect(aggressive < 25 || aggressive > 340).toBe(true);
  });

  it('still produces a usable colour for a tag it has never seen', () => {
    const c = colorForTag('some-producer-invented-this');
    expect(isValidHex(c)).toBe(true);
    expect(c).toBe(colorForTag('some-producer-invented-this'));
  });

  it('prefers a producer override over the curated hue', () => {
    expect(colorForTag('Trap', { trap: '#00ff00' })).toBe('#00ff00');
  });

  it('ignores an override that is not a colour', () => {
    expect(colorForTag('Trap', { trap: 'not-a-colour' })).toBe(colorForTag('Trap'));
  });
});

describe('paletteForTags', () => {
  it('leads with the first tag colour', () => {
    expect(paletteForTags(['Trap'], BRAND)[0]).toBe(colorForTag('Trap'));
  });

  it('uses a second tag as the supporting colour', () => {
    expect(paletteForTags(['Trap', 'Dark'], BRAND)[1]).toBe(colorForTag('Dark'));
  });

  it('leads on a tag the producer has coloured, wherever it sits in the list', () => {
    // The real catalogue case: Trap is usually the second or third tag, behind
    // Pluggnb. Leading on the first tag scattered Trap across every hue.
    const overrides = { trap: '#3ecf4a' };
    const palette = paletteForTags(['Pluggnb', 'Trap'], BRAND, overrides);
    expect(palette[0]).toBe('#3ecf4a');
  });

  it('is unchanged when no tag on the track has been coloured', () => {
    expect(paletteForTags(['Pluggnb', 'Trap'], BRAND)[0]).toBe(colorForTag('Pluggnb'));
  });

  it('keeps a stable lead when several tags are coloured', () => {
    const overrides = { trap: '#3ecf4a', pluggnb: '#ff0000' };
    const a = paletteForTags(['Pluggnb', 'Trap'], BRAND, overrides);
    const b = paletteForTags(['Pluggnb', 'Trap'], BRAND, overrides);
    expect(a).toEqual(b);
    expect(a[0]).toBe('#ff0000');
  });

  it('falls back to the brand palette when untagged, so nothing regresses', () => {
    expect(paletteForTags([], BRAND)).toEqual(BRAND);
  });

  it('never returns a single-colour palette, which would render flat', () => {
    expect(paletteForTags(['Trap'], []).length).toBeGreaterThan(1);
  });
});

describe('tag-anchored gradients', () => {
  it('keeps every Trap beat recognisably Trap', () => {
    const palette = paletteForTags(['Trap'], BRAND);
    const hues = Array.from({ length: 20 }, (_, i) =>
      hueOf(generateGradient(palette, `trap-${i}`, { tagAnchored: true }).stops[1].color));
    const spread = Math.max(...hues) - Math.min(...hues);
    // Tight enough to still read as one genre...
    expect(spread).toBeLessThan(45);
    // ...but not so tight the covers are identical.
    expect(new Set(hues.map((h) => Math.round(h))).size).toBeGreaterThan(6);
  });

  it('separates Trap from Drill', () => {
    const trap = hueOf(generateGradient(paletteForTags(['Trap'], BRAND), 'a', { tagAnchored: true }).stops[1].color);
    const drill = hueOf(generateGradient(paletteForTags(['Drill'], BRAND), 'a', { tagAnchored: true }).stops[1].color);
    const d = Math.min(Math.abs(trap - drill), 360 - Math.abs(trap - drill));
    expect(d).toBeGreaterThan(20);
  });

  it('drifts wider when anchored to the brand rather than a tag', () => {
    const spread = (anchored: boolean) => {
      const hues = Array.from({ length: 20 }, (_, i) =>
        hueOf(generateGradient(BRAND, `x-${i}`, { tagAnchored: anchored }).stops[1].color));
      return Math.max(...hues) - Math.min(...hues);
    };
    expect(spread(false)).toBeGreaterThan(spread(true));
  });
});

describe('kind separation by shape', () => {
  it('draws projects and playlists from different shape sets', () => {
    const shapes = (kind: 'project' | 'playlist' | 'track') =>
      new Set(Array.from({ length: 60 }, (_, i) =>
        generateGradient(BRAND, `s-${i}`, { kind }).composition));

    const project = shapes('project');
    const playlist = shapes('playlist');
    // Each kind must have a shape the other never draws.
    expect([...project].some((c) => !playlist.has(c))).toBe(true);
    expect([...playlist].some((c) => !project.has(c))).toBe(true);
    // And they overlap, so the set still reads as one system.
    expect([...project].some((c) => playlist.has(c))).toBe(true);
  });

  it('leaves tracks the full range', () => {
    const shapes = new Set(Array.from({ length: 200 }, (_, i) =>
      generateGradient(BRAND, `t-${i}`, { kind: 'track' }).composition));
    expect(shapes.size).toBe(6);
  });
});

describe('normaliseTagColors', () => {
  it('lowercases keys and values and adds a missing hash', () => {
    expect(normaliseTagColors({ Trap: 'FF0000' })).toEqual({ trap: '#ff0000' });
  });

  it('drops junk without throwing — this comes from the database', () => {
    expect(normaliseTagColors({ a: 'nope', b: 42, c: null, d: '#fff' })).toEqual({ d: '#fff' });
    expect(normaliseTagColors(null)).toEqual({});
    expect(normaliseTagColors([1, 2])).toEqual({});
    expect(normaliseTagColors('string')).toEqual({});
  });
});
