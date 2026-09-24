import { describe, expect, it } from 'vitest';
import { pickProvidedProfileFields } from './patch';

const full = {
  logo_url: null,
  bio: null,
  accent_color: '#FFFFFF',
  default_artwork_url: null,
  default_artwork_palette: null,
  default_artwork_project_url: 'https://x/p.png',
  default_artwork_project_palette: [{ hex: '#000' }],
};

describe('pickProvidedProfileFields', () => {
  it('writes only what the request named — a one-slot upload leaves the logo alone', () => {
    const out = pickProvidedProfileFields(full, {
      default_artwork_project_url: 'https://x/p.png',
      default_artwork_project_palette: [{ hex: '#000' }],
    });
    expect(Object.keys(out).sort()).toEqual(['default_artwork_project_palette', 'default_artwork_project_url']);
  });
  it('clearing an image also clears its palette', () => {
    const out = pickProvidedProfileFields(full, { default_artwork_url: null });
    expect(out).toEqual({ default_artwork_url: null, default_artwork_palette: null });
  });
  it('explicit nulls and empty strings still clear', () => {
    expect(pickProvidedProfileFields(full, { bio: '' })).toEqual({ bio: null });
  });
});
