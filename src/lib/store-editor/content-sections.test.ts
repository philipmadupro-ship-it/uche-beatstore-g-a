import { describe, expect, it } from 'vitest';
import {
  hasLiveContent, isContentSection, renderBreakpointFor, safeImageSrc, safeLinkHref,
  MEDIA_SIZE, mediaAlignMargins, mediaSizePercent,
} from './content-sections';
import { createSection, setSectionSetting, storeSectionKinds, type StoreSection } from './layout';
import { buildCsp } from '@/lib/security/csp';

function withContent(kind: StoreSection['kind'], content: StoreSection['content']): StoreSection {
  return { ...createSection(kind), content };
}

describe('isContentSection', () => {
  it('is exactly the producer-authored kinds', () => {
    expect(storeSectionKinds.filter(isContentSection)).toEqual(['text', 'image', 'video', 'links', 'canvas']);
  });
});

describe('safeImageSrc', () => {
  it('keeps https and site-relative, upgrades http, refuses the rest', () => {
    expect(safeImageSrc('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(safeImageSrc('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(safeImageSrc('http://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(safeImageSrc('//cdn.example/a.jpg')).toBeNull();
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('ftp://x/a.jpg')).toBeNull();
    expect(safeImageSrc('  ')).toBeNull();
  });

  it('only returns sources the enforced img-src allows', () => {
    const imgSrc = buildCsp('n').split('; ').find((d) => d.startsWith('img-src'))!;
    expect(imgSrc).toContain('https:');
    expect(imgSrc).toContain("'self'");
  });
});

describe('safeLinkHref', () => {
  it('allows relative, http(s) and mailto only', () => {
    expect(safeLinkHref('/store/projects/1')).toBe('/store/projects/1');
    expect(safeLinkHref('https://x.example')).toBe('https://x.example');
    expect(safeLinkHref('mailto:me@x.example')).toBe('mailto:me@x.example');
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
    expect(safeLinkHref('//evil.example')).toBeNull();
    expect(safeLinkHref('')).toBeNull();
  });
});

describe('hasLiveContent', () => {
  it('an empty content section has nothing for a buyer', () => {
    for (const kind of ['text', 'image', 'video', 'links', 'canvas'] as const) {
      expect(hasLiveContent(createSection(kind), null)).toBe(false);
    }
  });

  it('reads each kind by what it actually draws', () => {
    expect(hasLiveContent(withContent('text', { heading: 'Hi' }), null)).toBe(true);
    expect(hasLiveContent(withContent('text', { body: '   ' }), null)).toBe(false);
    expect(hasLiveContent(withContent('image', { imageUrl: 'https://x/a.jpg' }), null)).toBe(true);
    expect(hasLiveContent(withContent('image', { imageUrl: 'data:,x' }), null)).toBe(false);
    expect(hasLiveContent(withContent('video', { videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }), null)).toBe(true);
    expect(hasLiveContent(withContent('video', { videoUrl: 'https://example.com/v.mp4' }), null)).toBe(false);
    expect(hasLiveContent(createSection('links'), { instagram_handle: '@me' } as never)).toBe(true);
    expect(hasLiveContent(withContent('canvas', {
      blocks: [{ id: 'b', kind: 'text', x: 0, y: 0, width: 10, height: 10, text: '' }],
    }), null)).toBe(false);
    expect(hasLiveContent(withContent('canvas', {
      blocks: [{ id: 'b', kind: 'shape', x: 0, y: 0, width: 10, height: 10 }],
    }), null)).toBe(true);
  });

  it('never gates the storefront’s own sections', () => {
    expect(hasLiveContent(createSection('hero'), null)).toBe(true);
    expect(hasLiveContent(createSection('catalog'), null)).toBe(true);
  });
});

describe('renderBreakpointFor', () => {
  it('uses the viewer breakpoint when the section shows there', () => {
    expect(renderBreakpointFor(createSection('text'), 'desktop')).toBe('desktop');
  });

  it('falls back to a breakpoint it IS visible on, so CSS can do the hiding', () => {
    // Hidden on desktop only: before hydration the viewer reads desktop, and
    // the section must still be in the HTML a phone receives.
    // Desktop writes the base, so the smaller breakpoints re-show it.
    let section = setSectionSetting(createSection('text'), 'desktop', 'visible', false);
    section = setSectionSetting(section, 'tablet', 'visible', true);
    section = setSectionSetting(section, 'mobile', 'visible', true);
    expect(renderBreakpointFor(section, 'desktop')).toBe('tablet');
    expect(renderBreakpointFor(section, 'mobile')).toBe('mobile');
  });

  it('is null when hidden everywhere', () => {
    let section = createSection('text');
    for (const bp of ['desktop', 'tablet', 'mobile'] as const) section = setSectionSetting(section, bp, 'visible', false);
    expect(renderBreakpointFor(section, 'desktop')).toBeNull();
  });
});

describe('mediaSizePercent', () => {
  it('defaults to full width when unset or unreadable', () => {
    for (const v of [undefined, null, '', 'abc', NaN, {}]) expect(mediaSizePercent(v)).toBe(MEDIA_SIZE.default);
  });

  it('clamps to the slider range and rounds', () => {
    expect(mediaSizePercent(10)).toBe(25);
    expect(mediaSizePercent(250)).toBe(100);
    expect(mediaSizePercent(62.4)).toBe(62);
    expect(mediaSizePercent('50')).toBe(50);
  });
});

describe('mediaAlignMargins', () => {
  it('follows the section alignment', () => {
    expect(mediaAlignMargins('left')).toEqual({ marginLeft: 0, marginRight: 'auto' });
    expect(mediaAlignMargins('center')).toEqual({ marginLeft: 'auto', marginRight: 'auto' });
    expect(mediaAlignMargins('right')).toEqual({ marginLeft: 'auto', marginRight: 0 });
  });
});
