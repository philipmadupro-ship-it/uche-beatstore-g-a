import { describe, expect, it } from 'vitest';
import { renderArtworkDocumentSvg } from '@/components/cover-art/cover-art-document';
import { collectUsedFontAssets } from '@/lib/cover/font-embed';
import { CARD_STYLES } from '@/lib/share/styles';
import { SHARE_PRESETS, SHARE_PRESET_IDS, safeBox } from '@/lib/share/presets';
import { buildShareFill, fitTitle, normalizePeaks, wrapLines } from './fill';
import { buildShareDocument, layoutFor } from './index';
import { inlineCover, isSelfContainedSvg } from './export';
import { shareSvgForPreview } from './preview';

const fill = buildShareFill({
  title: 'Night Shift <Remix> & "More"', artist: 'Uche', coverUrl: 'https://cdn.example.com/c.jpg',
  peaks: Array.from({ length: 500 }, (_, i) => Math.sin(i / 7)), bpm: 140.4, key: 'F', scale: 'minor',
  accent: '#c8a47a',
});

describe('buildShareFill', () => {
  it('drops private or signed covers and share urls', () => {
    const f = buildShareFill({ title: 'x', coverUrl: 'r2://private/cover.jpg', shareUrl: 'https://x.com/a?X-Amz-Signature=1' });
    expect(f.coverUrl).toBeNull();
    expect(f.shareUrl).toBeNull();
  });
  it('defaults and validates', () => {
    const f = buildShareFill({ title: '  ', artist: '', accent: 'javascript:1', bpm: -3 });
    expect(f).toMatchObject({ title: 'Untitled Track', artist: 'U2C Beatstore', accent: '#FFFFFF', bpm: null, key: null });
  });
  it('formats meta', () => {
    expect(fill.bpm).toBe(140);
    expect(fill.key).toBe('F minor');
  });
});

describe('normalizePeaks', () => {
  it('resamples by bucket peak into 0..1', () => {
    const out = normalizePeaks([0, 0, 0, 1, 0, 0, 0, 0], 4);
    expect(out).toHaveLength(4);
    expect(Math.max(...out)).toBe(1);
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it('is empty for junk or silence', () => {
    expect(normalizePeaks(null)).toEqual([]);
    expect(normalizePeaks(['a'])).toEqual([]);
    expect(normalizePeaks([0, 0, 0])).toEqual([]);
  });
});

describe('type fitting', () => {
  it('wraps and ellipsises', () => {
    expect(wrapLines('one two three four', 8, 3)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('aaa bbb ccc ddd eee', 7, 2).at(-1)?.endsWith('…')).toBe(true);
  });
  it('shrinks long titles to fit the box', () => {
    const { size, lines } = fitTitle('A Very Long Beat Title That Keeps Going', 900, 96, 40, 3);
    expect(size).toBeLessThanOrEqual(96);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(l.length * size * 0.68).toBeLessThanOrEqual(900 + size);
  });
});

describe('templates', () => {
  for (const style of CARD_STYLES) {
    for (const id of SHARE_PRESET_IDS) {
      const preset = SHARE_PRESETS[id];
      it(`${style} × ${id}: right size, deterministic, escaped, in bounds`, () => {
        const doc = buildShareDocument(style, fill, preset);
        expect(doc.width).toBe(preset.width);
        expect(doc.height).toBe(preset.height);
        expect(JSON.stringify(buildShareDocument(style, fill, preset))).toBe(JSON.stringify(doc));
        const svg = renderArtworkDocumentSvg(doc);
        expect(svg.toLowerCase()).toContain('&lt;remix&gt;');
        expect(svg).toContain('&amp;');
        expect(svg.toLowerCase()).not.toContain('<remix>');
        const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(ids).size).toBe(ids.length);
        for (const l of doc.layers) {
          if (l.id === 'wash' || l.id === 'veil' || l.id === 'bar' || l.id === 'bar2') continue;
          expect(l.x).toBeGreaterThanOrEqual(0);
          expect(l.x + l.width).toBeLessThanOrEqual(preset.width + 1);
          expect(l.y).toBeGreaterThanOrEqual(0);
          expect(l.y + l.height).toBeLessThanOrEqual(preset.height + 1);
        }
      });
    }
  }

  it('keeps text inside the safe zone', () => {
    for (const id of SHARE_PRESET_IDS) {
      const preset = SHARE_PRESETS[id];
      const s = safeBox(preset);
      const doc = buildShareDocument('minimal', fill, preset);
      for (const l of doc.layers.filter((x) => x.type === 'text')) {
        expect(l.x).toBeGreaterThanOrEqual(s.x - 1);
        expect(l.x + l.width).toBeLessThanOrEqual(s.x + s.width + 1);
        expect(l.y).toBeGreaterThanOrEqual(s.y - 1);
      }
    }
  });

  it('never lets copy run into the waveform, for short and long titles', () => {
    for (const title of ['Go', 'Midnight Drive', 'A Very Long Beat Title That Keeps Going On And On']) {
      const f = buildShareFill({ ...{ artist: 'Uche', coverUrl: null, bpm: 140, key: 'F', accent: '#c8a47a' }, title, peaks: fill.peaks });
      for (const style of CARD_STYLES) {
        for (const id of SHARE_PRESET_IDS) {
          const doc = buildShareDocument(style, f, SHARE_PRESETS[id]);
          const wave = doc.layers.find((l) => l.type === 'waveform')!;
          for (const l of doc.layers.filter((x) => x.type === 'text')) {
            expect(l.y + l.height, `${style} ${id} ${title} ${l.id}`).toBeLessThanOrEqual(wave.y);
          }
        }
      }
    }
  });

  it('draws a no-cover panel and no waveform when data is missing', () => {
    const bare = buildShareFill({ title: 'Bare' });
    const doc = buildShareDocument('mono', bare, SHARE_PRESETS.square);
    expect(doc.layers.some((l) => l.type === 'image')).toBe(false);
    expect(doc.layers.some((l) => l.type === 'waveform')).toBe(false);
  });

  it('uses brand fonts that can be embedded', () => {
    const doc = buildShareDocument('minimal', fill, SHARE_PRESETS.story);
    expect(collectUsedFontAssets(doc).length).toBeGreaterThan(0);
  });

  it('layout boxes stay inside the artboard', () => {
    for (const id of SHARE_PRESET_IDS) {
      const p = SHARE_PRESETS[id];
      const L = layoutFor(p);
      for (const b of [L.cover, L.text, L.wave]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(p.width);
        expect(b.y + b.height).toBeLessThanOrEqual(p.height);
      }
    }
  });
});

describe('export safety', () => {
  it('flags any external reference and accepts data uris', () => {
    expect(isSelfContainedSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA"/></svg>')).toBe(true);
    expect(isSelfContainedSvg('<svg><image href="https://x.com/a.png"/></svg>')).toBe(false);
    expect(isSelfContainedSvg('<svg><rect style="fill:url(https://x.com/a)"/></svg>')).toBe(false);
    expect(isSelfContainedSvg('<svg><image href="r2://b/k"/></svg>')).toBe(false);
    expect(isSelfContainedSvg('<svg><style>@font-face{src:url("data:font/otf;base64,AA")}</style></svg>')).toBe(true);
    expect(isSelfContainedSvg("<svg><style>@font-face{src:url('data:font/otf;base64,AA')}</style></svg>")).toBe(true);
    expect(isSelfContainedSvg('<svg><style>@font-face{src:url("https://x.com/f.otf")}</style></svg>')).toBe(false);
    expect(isSelfContainedSvg('<svg><rect fill="url(#g)" filter="url(\'#f\')"/></svg>')).toBe(true);
  });

  it('inlines the cover as a data uri, so the final SVG has no external url', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const { fill: inlined, lostCover } = await inlineCover(fill, async () => blob, async () => 'data:image/png;base64,eA==');
    expect(lostCover).toBe(false);
    for (const style of CARD_STYLES) {
      for (const id of SHARE_PRESET_IDS) {
        const svg = renderArtworkDocumentSvg(buildShareDocument(style, inlined, SHARE_PRESETS[id]));
        expect(isSelfContainedSvg(svg)).toBe(true);
        expect(svg).not.toContain('cdn.example.com');
        expect(svg).not.toContain('r2://');
      }
    }
  });

  it('drops the cover instead of failing when it cannot be read', async () => {
    const out = await inlineCover(fill, async () => { throw new Error('cors'); });
    expect(out.lostCover).toBe(true);
    expect(out.fill.coverUrl).toBeNull();
    const text = await inlineCover(fill, async () => new Blob(['<html>'], { type: 'text/html' }));
    expect(text.lostCover).toBe(true);
  });

  it('preview sizes the svg to its container', () => {
    const svg = shareSvgForPreview('glow', fill, SHARE_PRESETS.og);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('width="100%" height="100%"');
    expect(svg).toContain('viewBox="0 0 1200 630"');
  });
});
