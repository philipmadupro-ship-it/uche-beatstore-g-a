import { describe, expect, it } from 'vitest';
import {
  coverFonts,
  embeddableFaces,
  facesFor,
  fontStackFor,
  fontsByCategory,
  legacyFontRoles,
  nearestFace,
  resolveFont,
  resolveWeight,
} from './fonts';

describe('the library itself', () => {
  it('has unique ids', () => {
    const ids = coverFonts.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every font at least one face', () => {
    for (const font of coverFonts) {
      expect(font.faces.length, `${font.id} has no faces`).toBeGreaterThan(0);
    }
  });

  it('lists faces in ascending weight so the picker reads in order', () => {
    for (const font of coverFonts) {
      const weights = font.faces.map((face) => face.weight);
      expect(weights, `${font.id} faces are out of order`).toEqual([...weights].sort((a, b) => a - b));
    }
  });

  it('gives every embeddable face a file and every non-embeddable one none', () => {
    for (const font of coverFonts) {
      for (const face of font.faces) {
        if (font.embeddable) {
          expect(face.url, `${font.id} ${face.label} is embeddable but has no file`).toBeTruthy();
          expect(face.url).toMatch(/^\/fonts\/.+\.otf$/);
        } else {
          expect(face.url, `${font.id} ${face.label} is a system face but names a file`).toBeUndefined();
        }
      }
    }
  });

  it('names its own family first in its CSS stack', () => {
    // A stack that lists a fallback ahead of the real face never renders the
    // real face — the exact reason Akira only ever appeared as dead weight
    // behind Synkopy in the old role stacks.
    for (const font of coverFonts) {
      const first = font.stack.split(',')[0].replaceAll("'", '').trim();
      expect(first, `${font.id} does not lead with its own family`).toBe(font.cssFamily);
    }
  });

  it('never repeats a family+weight pair across the library', () => {
    const keys = coverFonts.flatMap((font) => font.faces.map((face) => `${font.cssFamily}:${face.weight}`));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('resolveFont', () => {
  it('resolves a current id', () => {
    expect(resolveFont('panchang').id).toBe('panchang');
  });

  it.each(Object.entries(legacyFontRoles))('resolves the legacy role %s', (role, expected) => {
    expect(resolveFont(role).id).toBe(expected);
  });

  it('falls back to the default rather than throwing on junk', () => {
    // A document with one unrecognised font string must still open.
    expect(resolveFont('not-a-font').id).toBe('synkopy');
    expect(resolveFont(undefined).id).toBe('synkopy');
    expect(resolveFont(null).id).toBe('synkopy');
    expect(resolveFont('').id).toBe('synkopy');
  });
});

describe('fontStackFor', () => {
  it('returns the resolved font’s stack', () => {
    expect(fontStackFor('panchang')).toBe(coverFonts.find((f) => f.id === 'panchang')!.stack);
  });

  it('maps the legacy brand role onto Akira, which leads its own stack', () => {
    expect(fontStackFor('brand')).toContain('Akira Expanded');
    expect(fontStackFor('brand').indexOf('Akira Expanded')).toBeLessThan(4);
  });
});

describe('nearestFace', () => {
  const panchang = coverFonts.find((font) => font.id === 'panchang')!;
  const akira = coverFonts.find((font) => font.id === 'akira')!;
  const synkopy = coverFonts.find((font) => font.id === 'synkopy')!;

  it('returns an exact match when the family has it', () => {
    expect(nearestFace(panchang, 600).weight).toBe(600);
    expect(nearestFace(panchang, 200).weight).toBe(200);
  });

  it('snaps to the only face of a single-weight family', () => {
    expect(nearestFace(akira, 900).weight).toBe(400);
    expect(nearestFace(akira, 100).weight).toBe(400);
  });

  it('snaps a weight the family lacks to the closest one it has', () => {
    // Synkopy ships 400 and 700 only.
    expect(nearestFace(synkopy, 500).weight).toBe(400);
    expect(nearestFace(synkopy, 650).weight).toBe(700);
  });

  it('breaks a tie toward the lighter cut', () => {
    // 550 is equidistant from 400 and 700 — 400 wins.
    expect(nearestFace(synkopy, 550).weight).toBe(400);
  });

  it('clamps beyond both ends of the range', () => {
    expect(nearestFace(panchang, 50).weight).toBe(200);
    expect(nearestFace(panchang, 1200).weight).toBe(800);
  });

  it('labels Synkopy’s 700 as Flipside rather than pretending it is a bold', () => {
    expect(nearestFace(synkopy, 700).label).toBe('Flipside');
  });
});

describe('resolveWeight', () => {
  it('resolves through both the font reference and the weight snap', () => {
    expect(resolveWeight('synkopy', 500)).toBe(400);
    expect(resolveWeight('panchang', 500)).toBe(500);
  });

  it('defaults an unset weight to 400 before snapping', () => {
    expect(resolveWeight('panchang', undefined)).toBe(400);
    expect(resolveWeight('akira', undefined)).toBe(400);
  });

  it('works through a legacy role', () => {
    expect(resolveWeight('mono', 800)).toBe(800);
  });
});

describe('facesFor — what an export must inline', () => {
  it('returns nothing for a document with no text', () => {
    expect(facesFor([])).toEqual([]);
  });

  it('skips system stacks, which cannot be embedded', () => {
    expect(facesFor([{ font: 'system-sans', weight: 400 }])).toEqual([]);
    expect(facesFor([{ font: 'ui', weight: 400 }])).toEqual([]);
  });

  it('returns the specific file for the requested weight', () => {
    expect(facesFor([{ font: 'panchang', weight: 200 }])).toEqual([
      { family: 'Panchang', url: '/fonts/Panchang-Extralight.otf', weight: 200 },
    ]);
  });

  it('embeds the snapped weight, not the requested one', () => {
    // This is the guarantee that the export asks for a weight it actually
    // shipped. Requesting an unshipped 500 and inlining only a 400 is how you
    // get a synthesised fake bold in the file and the real cut on screen.
    const faces = facesFor([{ font: 'synkopy', weight: 500 }]);
    expect(faces).toContainEqual(
      { family: 'Synkopy', url: '/fonts/Synkopy-Regular.otf', weight: 400 },
    );
    expect(faces.some((face) => face.weight === 500)).toBe(false);
  });

  it('embeds a font’s fallback alongside it, so a failed fetch still lands well', () => {
    // Embedding fails soft per family. If the 1.3 MB Synkopy is the fetch that
    // fails, an inlined Akira is the difference between the export landing in
    // the app's own brand face and landing in an arbitrary system sans.
    const faces = facesFor([{ font: 'synkopy', weight: 400 }]);
    expect(faces.map((face) => face.family)).toEqual(['Synkopy', 'Akira Expanded']);
  });

  it('does not pull in a fallback for a family that has none', () => {
    expect(facesFor([{ font: 'panchang', weight: 400 }]).map((face) => face.family))
      .toEqual(['Panchang']);
  });

  it('deduplicates a family+weight used by several layers', () => {
    const faces = facesFor([
      { font: 'synkopy', weight: 400 },
      { font: 'synkopy', weight: 400 },
      { font: 'display', weight: 420 },
    ]);
    // Synkopy once plus its Akira fallback once — not six entries.
    expect(faces).toHaveLength(2);
    expect(faces.filter((face) => face.family === 'Synkopy')).toHaveLength(1);
  });

  it('keeps two different weights of the same family apart', () => {
    const faces = facesFor([
      { font: 'panchang', weight: 200 },
      { font: 'panchang', weight: 800 },
    ]);
    expect(faces).toHaveLength(2);
    expect(faces.map((face) => face.weight).sort()).toEqual([200, 800]);
  });

  it('collects across several families', () => {
    const faces = facesFor([
      { font: 'synkopy', weight: 400 },
      { font: 'akira', weight: 400 },
      { font: 'panchang', weight: 700 },
      { font: 'system-mono', weight: 400 },
    ]);
    expect(faces.map((face) => face.family).sort()).toEqual(['Akira Expanded', 'Panchang', 'Synkopy']);
  });
});

describe('embeddableFaces', () => {
  it('lists every real file in the library', () => {
    const faces = embeddableFaces();
    // Synkopy 2 + Akira 1 + Panchang 7 + La Bruja 1 = 11, which is exactly the
    // count of .otf files shipped in /public/fonts.
    expect(faces).toHaveLength(11);
    expect(faces.every((face) => face.url.startsWith('/fonts/'))).toBe(true);
  });

  it('excludes system stacks', () => {
    expect(embeddableFaces().some((face) => face.family === 'Inter')).toBe(false);
  });
});

describe('fontsByCategory', () => {
  it('groups every font exactly once', () => {
    const grouped = fontsByCategory().flatMap((group) => group.fonts);
    expect(grouped).toHaveLength(coverFonts.length);
    expect(new Set(grouped.map((font) => font.id)).size).toBe(coverFonts.length);
  });

  it('omits empty groups', () => {
    for (const group of fontsByCategory()) {
      expect(group.fonts.length).toBeGreaterThan(0);
    }
  });

  it('puts display faces first, since cover art leads with them', () => {
    expect(fontsByCategory()[0].category).toBe('display');
  });
});
