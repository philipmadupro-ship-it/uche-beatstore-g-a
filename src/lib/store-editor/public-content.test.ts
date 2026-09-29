import { describe, expect, it } from 'vitest';
import { defaultStoreLayout, type StoreSection } from './layout';
import {
  creatorLinks,
  hasPublicContent,
  isAuthoredSection,
  publicHref,
  publicImageUrl,
  publicVideoEmbed,
  VIDEO_EMBED_ORIGINS,
} from './public-content';

function section(kind: StoreSection['kind'], content?: StoreSection['content']): StoreSection {
  return { id: `s-${kind}`, kind, name: kind, locked: false, base: {}, overrides: {}, content } as StoreSection;
}

describe('publicVideoEmbed', () => {
  it('rewrites every YouTube form to the no-cookie embed', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      '  https://youtu.be/dQw4w9WgXcQ  ',
    ]) {
      expect(publicVideoEmbed(url)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    }
  });

  it('rewrites Vimeo page and player URLs to the player', () => {
    expect(publicVideoEmbed('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(publicVideoEmbed('https://player.vimeo.com/video/76979871?h=abc')).toBe('https://player.vimeo.com/video/76979871');
  });

  it('refuses anything the CSP would block or that is not a video', () => {
    for (const url of [
      null, undefined, '', 'not a url',
      'https://example.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/channel/UC123',
      'https://vimeo.com/channels/staffpicks',
      'javascript:alert(1)',
      'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(publicVideoEmbed(url)).toBeNull();
    }
  });

  it('only ever returns an origin the CSP allows', () => {
    const out = [publicVideoEmbed('https://youtu.be/dQw4w9WgXcQ'), publicVideoEmbed('https://vimeo.com/76979871')];
    for (const url of out) expect(VIDEO_EMBED_ORIGINS).toContain(new URL(url!).origin);
  });
});

describe('publicImageUrl / publicHref', () => {
  it('keeps https and site paths for images, drops the rest', () => {
    expect(publicImageUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(publicImageUrl('/images/a.jpg')).toBe('/images/a.jpg');
    for (const bad of ['http://x.com/a.jpg', '//evil.com/a.jpg', 'javascript:1', 'data:image/png;base64,AA', '', null]) {
      expect(publicImageUrl(bad)).toBeNull();
    }
  });

  it('keeps http(s) and site paths for links, drops scripts and protocol-relative hosts', () => {
    expect(publicHref('https://example.com/x')).toBe('https://example.com/x');
    expect(publicHref('http://example.com')).toBe('http://example.com/');
    expect(publicHref('/store/producer/uche')).toBe('/store/producer/uche');
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.com', 'mailto:a@b.c', '', null]) {
      expect(publicHref(bad)).toBeNull();
    }
  });
});

describe('creatorLinks', () => {
  it('builds hrefs from handles and keeps a fixed order', () => {
    expect(creatorLinks({
      website_url: 'https://uche.example',
      instagram_handle: '@uche.beats',
      twitter_handle: 'uche_x',
      spotify_url: 'https://open.spotify.com/artist/1',
      soundcloud_url: 'javascript:alert(1)',
    })).toEqual([
      { label: 'Instagram', href: 'https://instagram.com/uche.beats' },
      { label: 'X', href: 'https://x.com/uche_x' },
      { label: 'Spotify', href: 'https://open.spotify.com/artist/1' },
      { label: 'Website', href: 'https://uche.example/' },
    ]);
  });

  it('drops handles that could not be a username', () => {
    expect(creatorLinks({ instagram_handle: 'a/b?c', twitter_handle: '   ' })).toEqual([]);
    expect(creatorLinks(null)).toEqual([]);
  });
});

describe('hasPublicContent', () => {
  it('hides empty authored sections instead of showing builder hints', () => {
    expect(hasPublicContent(section('text'), null)).toBe(false);
    expect(hasPublicContent(section('text', { heading: '  ' }), null)).toBe(false);
    expect(hasPublicContent(section('image', { imageUrl: 'http://insecure/a.jpg' }), null)).toBe(false);
    expect(hasPublicContent(section('video', { videoUrl: 'https://example.com/v.mp4' }), null)).toBe(false);
    expect(hasPublicContent(section('links'), { instagram_handle: '' })).toBe(false);
    expect(hasPublicContent(section('canvas', { blocks: [
      { id: 'b', kind: 'text', x: 0, y: 0, width: 10, height: 10, text: ' ' },
      { id: 'c', kind: 'image', x: 0, y: 0, width: 10, height: 10 },
    ] }), null)).toBe(false);
  });

  it('shows authored sections that have something to show', () => {
    expect(hasPublicContent(section('text', { body: 'Hello' }), null)).toBe(true);
    expect(hasPublicContent(section('text', { ctaLabel: 'Book a session', ctaHref: '/store/producer/uche' }), null)).toBe(true);
    expect(hasPublicContent(section('text', { ctaLabel: 'Book a session', ctaHref: 'javascript:alert(1)' }), null)).toBe(false);
    expect(hasPublicContent(section('image', { imageUrl: 'https://cdn.example.com/a.jpg' }), null)).toBe(true);
    expect(hasPublicContent(section('video', { videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }), null)).toBe(true);
    expect(hasPublicContent(section('links'), { website_url: 'https://uche.example' })).toBe(true);
    expect(hasPublicContent(section('canvas', { blocks: [{ id: 'b', kind: 'shape', x: 0, y: 0, width: 10, height: 10 }] }), null)).toBe(true);
  });

  it('leaves the built-in kinds to their own components', () => {
    for (const s of defaultStoreLayout().sections) {
      expect(isAuthoredSection(s.kind)).toBe(false);
      expect(hasPublicContent(s, null)).toBe(true);
    }
  });
});
