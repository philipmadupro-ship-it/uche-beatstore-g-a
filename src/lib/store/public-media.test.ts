import { describe, expect, it } from 'vitest';
import { publicPeaksUrl, publicPreviewUrl, redactPublicTrackMedia } from './public-media';

describe('public store media redaction', () => {
  it('builds same-origin public preview and peaks URLs by track id', () => {
    expect(publicPreviewUrl('track 1')).toBe('/api/store/preview/track%201');
    expect(publicPeaksUrl('track 1', 'https://pub.r2.dev/peaks/a.json')).toBe('/api/store/peaks/track%201');
    expect(publicPeaksUrl('track 1', null)).toBeNull();
  });

  it('redacts private media while preserving public playback proxies', () => {
    const safe = redactPublicTrackMedia({
      id: 'track-1',
      title: 'Dark Beat',
      audio_url: 'r2://private/tracks/a.wav',
      preview_url: null,
      peaks_url: 'https://pub.r2.dev/peaks/a.json',
      wav_url: 'r2://private/tracks/a.wav',
    });

    expect(safe.audio_url).toBe('/api/store/preview/track-1');
    expect(safe.peaks_url).toBe('/api/store/peaks/track-1');
    expect(safe.preview_url).toBeNull();
    expect(safe.wav_url).toBeNull();
  });
});
