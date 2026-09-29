import { describe, expect, it } from 'vitest';
import { storeSocialLinks } from './social-links';

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
