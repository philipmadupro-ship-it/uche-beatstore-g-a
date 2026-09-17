import { describe, expect, it } from 'vitest';
import {
  addLayer, createArtworkDocument, createTextLayer, type ArtworkDocument,
} from '@/components/cover-art/cover-art-document';
import { buildFontFaceCss, collectUsedFontAssets, injectFontCss } from './font-embed';

const blank = (): ArtworkDocument => {
  // Start from a document with no text at all, so each test controls exactly
  // which families are in play.
  const doc = createArtworkDocument('de-roche-mineral', { kind: 'empty', label: 'Empty design' });
  return { ...doc, layers: doc.layers.filter((layer) => layer.type !== 'text') };
};

const familiesOf = (doc: ArtworkDocument) => collectUsedFontAssets(doc).map((asset) => asset.family);
const urlsOf = (doc: ArtworkDocument) => collectUsedFontAssets(doc).map((asset) => asset.url);

describe('collectUsedFontAssets — which families', () => {
  it('returns nothing when a document has no text', () => {
    expect(collectUsedFontAssets(blank())).toEqual([]);
  });

  it('maps the legacy artwork role to Synkopy and embeds its fallback too', () => {
    // The fallback matters: embedding fails soft per family, so a failed
    // Synkopy fetch lands the export in Akira rather than a system sans.
    const doc = addLayer(blank(), createTextLayer(blank(), 'TITLE', { fontFamily: 'artwork' }));
    expect(familiesOf(doc)).toEqual(['Synkopy', 'Akira Expanded']);
  });

  it('maps the legacy mono role to Panchang only', () => {
    const doc = addLayer(blank(), createTextLayer(blank(), '140 BPM', { fontFamily: 'mono' }));
    expect(familiesOf(doc)).toEqual(['Panchang']);
  });

  it('embeds nothing for the ui role, which is a system stack', () => {
    const doc = addLayer(blank(), createTextLayer(blank(), 'Label', { fontFamily: 'ui' }));
    expect(collectUsedFontAssets(doc)).toEqual([]);
  });

  it('ignores hidden text layers', () => {
    const doc = addLayer(blank(), createTextLayer(blank(), 'TITLE', { fontFamily: 'artwork', visible: false }));
    expect(collectUsedFontAssets(doc)).toEqual([]);
  });

  it('ignores empty and whitespace-only text layers', () => {
    let doc = blank();
    doc = addLayer(doc, createTextLayer(doc, '', { fontFamily: 'artwork' }));
    doc = addLayer(doc, createTextLayer(doc, '   ', { fontFamily: 'mono' }));
    expect(collectUsedFontAssets(doc)).toEqual([]);
  });

  it('deduplicates families used by several layers', () => {
    let doc = blank();
    doc = addLayer(doc, createTextLayer(doc, 'ONE', { fontFamily: 'artwork' }));
    doc = addLayer(doc, createTextLayer(doc, 'TWO', { fontFamily: 'display' }));
    expect(familiesOf(doc)).toEqual(['Synkopy', 'Akira Expanded']);
  });

  it('collects every family a mixed document needs', () => {
    let doc = blank();
    doc = addLayer(doc, createTextLayer(doc, 'TITLE', { fontFamily: 'artwork' }));
    doc = addLayer(doc, createTextLayer(doc, '140 BPM', { fontFamily: 'mono' }));
    expect(familiesOf(doc).sort()).toEqual(['Akira Expanded', 'Panchang', 'Synkopy']);
  });

  it('points every asset at a real file under /fonts', () => {
    let doc = blank();
    doc = addLayer(doc, createTextLayer(doc, 'TITLE', { fontFamily: 'artwork' }));
    doc = addLayer(doc, createTextLayer(doc, 'BPM', { fontFamily: 'mono' }));
    collectUsedFontAssets(doc).forEach((asset) => {
      expect(asset.url.startsWith('/fonts/')).toBe(true);
      expect(asset.url.endsWith('.otf')).toBe(true);
      expect(asset.format).toBe('opentype');
    });
  });
});

describe('collectUsedFontAssets — which weight', () => {
  it('embeds the cut the layer actually asks for, not a hardcoded bold', () => {
    // The regression this replaces: one file per family was embedded
    // (Panchang-Bold), so an Extralight title exported as a Bold.
    const doc = addLayer(
      blank(),
      createTextLayer(blank(), 'QUIET', { fontFamily: 'panchang', fontWeight: 200 }),
    );
    expect(urlsOf(doc)).toEqual(['/fonts/Panchang-Extralight.otf']);
  });

  it('embeds two different cuts of one family separately', () => {
    let doc = blank();
    doc = addLayer(doc, createTextLayer(doc, 'LIGHT', { fontFamily: 'panchang', fontWeight: 200 }));
    doc = addLayer(doc, createTextLayer(doc, 'HEAVY', { fontFamily: 'panchang', fontWeight: 800 }));
    expect(urlsOf(doc).sort()).toEqual([
      '/fonts/Panchang-Extrabold.otf',
      '/fonts/Panchang-Extralight.otf',
    ]);
  });

  it('embeds one file when two layers share a cut', () => {
    let doc = blank();
    doc = addLayer(doc, createTextLayer(doc, 'ONE', { fontFamily: 'panchang', fontWeight: 500 }));
    doc = addLayer(doc, createTextLayer(doc, 'TWO', { fontFamily: 'panchang', fontWeight: 500 }));
    expect(urlsOf(doc)).toEqual(['/fonts/Panchang-Medium.otf']);
  });

  it('embeds the snapped weight for a family that lacks the requested one', () => {
    // Synkopy ships 400 and 700 only; 500 snaps down to 400 and THAT is what
    // gets inlined, so the file never asks for a weight it does not carry.
    const doc = addLayer(
      blank(),
      createTextLayer(blank(), 'TITLE', { fontFamily: 'synkopy', fontWeight: 500 }),
    );
    const synkopy = collectUsedFontAssets(doc).find((asset) => asset.family === 'Synkopy');
    expect(synkopy).toEqual({
      family: 'Synkopy',
      url: '/fonts/Synkopy-Regular.otf',
      weight: 400,
      format: 'opentype',
    });
  });

  it('embeds the Flipside cut when Synkopy 700 is asked for', () => {
    const doc = addLayer(
      blank(),
      createTextLayer(blank(), 'TITLE', { fontFamily: 'synkopy', fontWeight: 700 }),
    );
    expect(urlsOf(doc)).toContain('/fonts/Synkopy-Flipside.otf');
  });

  it('treats an unset weight as 400', () => {
    const doc = addLayer(blank(), createTextLayer(blank(), 'TITLE', { fontFamily: 'panchang' }));
    expect(urlsOf(doc)).toEqual(['/fonts/Panchang-Regular.otf']);
  });
});

describe('buildFontFaceCss', () => {
  it('writes a font-face rule carrying the data URI', () => {
    const css = buildFontFaceCss([
      { family: 'Panchang', dataUrl: 'data:font/otf;base64,AAA', weight: 700, format: 'opentype' },
    ]);
    expect(css).toContain("font-family:'Panchang'");
    expect(css).toContain("url('data:font/otf;base64,AAA') format('opentype')");
    expect(css).toContain('font-weight:700');
  });

  it('writes one rule per embedded cut so weights stay distinguishable', () => {
    const css = buildFontFaceCss([
      { family: 'Panchang', dataUrl: 'data:font/otf;base64,AAA', weight: 200, format: 'opentype' },
      { family: 'Panchang', dataUrl: 'data:font/otf;base64,BBB', weight: 800, format: 'opentype' },
    ]);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-weight:200');
    expect(css).toContain('font-weight:800');
  });

  it('returns an empty string when there is nothing to embed', () => {
    expect(buildFontFaceCss([])).toBe('');
  });
});

describe('injectFontCss', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">\n  <defs>\n    <pattern id="p" />\n  </defs>\n  <rect />\n</svg>';

  it('places the style block inside defs', () => {
    const out = injectFontCss(svg, '@font-face{}');
    expect(out).toContain('<defs><style type="text/css">@font-face{}</style>');
    expect(out.indexOf('<style')).toBeLessThan(out.indexOf('</defs>'));
  });

  it('leaves the svg untouched when there is no css', () => {
    expect(injectFontCss(svg, '')).toBe(svg);
  });

  it('leaves the svg untouched when it has no defs', () => {
    const bare = '<svg><rect /></svg>';
    expect(injectFontCss(bare, '@font-face{}')).toBe(bare);
  });

  it('keeps the original defs content', () => {
    expect(injectFontCss(svg, '@font-face{}')).toContain('<pattern id="p" />');
  });
});

describe('the brand role', () => {
  it('resolves to Akira Expanded, the face the app brand mark uses', () => {
    const doc = addLayer(blank(), createTextLayer(blank(), 'UCHE', { fontFamily: 'brand' }));
    expect(familiesOf(doc)).toEqual(['Akira Expanded']);
  });

  it('does not drag Synkopy into the export, which the other roles would', () => {
    const brand = addLayer(blank(), createTextLayer(blank(), 'UCHE', { fontFamily: 'brand' }));
    const artwork = addLayer(blank(), createTextLayer(blank(), 'UCHE', { fontFamily: 'artwork' }));
    expect(familiesOf(brand)).not.toContain('Synkopy');
    expect(familiesOf(artwork)).toContain('Synkopy');
  });

  it('embeds the Akira file for it', () => {
    const doc = addLayer(blank(), createTextLayer(blank(), 'UCHE', { fontFamily: 'brand' }));
    expect(urlsOf(doc)).toEqual(['/fonts/AkiraExpanded.otf']);
  });
});
