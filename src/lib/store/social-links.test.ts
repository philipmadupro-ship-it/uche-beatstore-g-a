import { describe, expect, it } from 'vitest';
import { resolveCreatorLink, storeSocialLinks } from './social-links';

describe('storeSocialLinks', () => {
  it('builds the same hrefs the hero does, in a stable order', () => {
    expect(storeSocialLinks({
      instagram_handle: '@me', twitter_handle: 'me', spotify_url: 'https://open.spotify.com/artist/x',
      soundcloud_url: 'soundcloud.com/me', website_url: 'https://me.example',
    })).toEqual([
      { label: 'Instagram', href: 'https://instagram.com/me' },
      { label: 'X', href: 'https://x.com/me' },
      { label: 'Spotify', href: 'https://open.spotify.com/artist/x' },
      { label: 'SoundCloud', href: 'https://soundcloud.com/me' },
      { label: 'Website', href: 'https://me.example' },
    ]);
  });

  it('drops empty values and non-web URLs', () => {
    expect(storeSocialLinks(null)).toEqual([]);
    expect(storeSocialLinks({ instagram_handle: '  ', website_url: 'javascript:alert(1)' })).toEqual([]);
  });
});

describe('resolveCreatorLink', () => {
  const href = (kind: Parameters<typeof resolveCreatorLink>[0], raw: string | null) => resolveCreatorLink(kind, raw)?.href ?? null;

  it('turns handles, @handles and pasted profile URLs into one canonical destination', () => {
    for (const raw of ['uche', '@uche', ' @uche ', 'instagram.com/uche', 'https://www.instagram.com/uche/', 'https://instagram.com/uche?igsh=abc']) {
      expect(href('instagram', raw)).toBe('https://instagram.com/uche');
    }
    for (const raw of ['uche_', '@uche_', 'twitter.com/uche_', 'https://x.com/uche_/status/1']) {
      expect(href('x', raw)).toBe('https://x.com/uche_');
    }
    expect(resolveCreatorLink('instagram', '@uche')?.label).toBe('@uche');
  });

  it('never yields a doubled or foreign-host handle link', () => {
    expect(href('instagram', 'https://evil.example/instagram.com/uche')).toBeNull();
    expect(href('instagram', 'javascript:alert(1)')).toBeNull();
    expect(href('instagram', 'two words')).toBeNull();
    expect(href('x', 'toolongtoolongtoolong')).toBeNull(); // 15-char cap
    expect(href('x', 'https://instagram.com/uche')).toBeNull();
  });

  it('accepts http(s) and bare domains, and refuses everything else', () => {
    expect(href('website', 'https://me.example')).toBe('https://me.example');
    expect(href('spotify', 'open.spotify.com/artist/x')).toBe('https://open.spotify.com/artist/x');
    expect(href('soundcloud', 'http://soundcloud.com/me')).toBe('http://soundcloud.com/me');
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd',
      '//evil.example', '/store/producer/x', 'https://', 'https://localhost', 'not a url',
      'https://spotify.com@evil.example/x', 'https://user:pw@evil.example',
    ]) {
      expect(href('website', bad), bad).toBeNull();
    }
  });

  it('only builds mailto for a plain address', () => {
    expect(href('email', 'hi@uche.example')).toBe('mailto:hi@uche.example');
    for (const bad of ['hi@uche.example?cc=a@b.co', 'a@b.co,c@d.co', 'a%0d@b.co', 'no-at.example', 'a b@c.co', 'javascript:alert(1)']) {
      expect(href('email', bad), bad).toBeNull();
    }
  });

  it('treats empty and missing values as no link', () => {
    for (const kind of ['instagram', 'x', 'spotify', 'soundcloud', 'website', 'email'] as const) {
      expect(resolveCreatorLink(kind, null)).toBeNull();
      expect(resolveCreatorLink(kind, '   ')).toBeNull();
    }
  });
});
