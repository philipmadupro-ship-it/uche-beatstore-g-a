import { describe, it, expect } from 'vitest';
import { bandsUrlFromPeaksUrl } from './sidecar-url';

/**
 * The read path derives this rather than selecting `tracks.bands_url`.
 * Selecting that column made the whole tracks query fail — and so showed an
 * empty library — anywhere migration 105 had not been applied yet.
 */
describe('bandsUrlFromPeaksUrl', () => {
  it('swaps the suffix on a public R2 URL', () => {
    expect(bandsUrlFromPeaksUrl('https://cdn.x/abc.mp3.peaks.json'))
      .toBe('https://cdn.x/abc.mp3.bands.json');
  });

  it('swaps the suffix on a private-ref sidecar key', () => {
    expect(bandsUrlFromPeaksUrl('https://cdn.x/peaks/tracks-a.mp3.peaks.json'))
      .toBe('https://cdn.x/peaks/tracks-a.mp3.bands.json');
  });

  it('handles the local dev path', () => {
    expect(bandsUrlFromPeaksUrl('/uploads/a.mp3.peaks.json')).toBe('/uploads/a.mp3.bands.json');
  });

  it('returns null for anything that is not a peaks sidecar', () => {
    for (const v of [null, undefined, '', 'https://cdn.x/a.mp3', 'https://cdn.x/a.bands.json']) {
      expect(bandsUrlFromPeaksUrl(v as string)).toBeNull();
    }
  });

  it('only replaces the trailing suffix, not an earlier occurrence', () => {
    expect(bandsUrlFromPeaksUrl('https://cdn.x/.peaks.json/real.mp3.peaks.json'))
      .toBe('https://cdn.x/.peaks.json/real.mp3.bands.json');
  });
});
