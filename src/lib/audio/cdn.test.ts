import { describe, it, expect, afterEach } from 'vitest';
import { cdnAudioSrc } from './cdn';

const R2 = 'https://pub-abc.r2.dev';
const CDN = 'https://cdn.example.com';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_R2_CDN_URL;
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
});

describe('cdnAudioSrc', () => {
  it('returns empty for nullish', () => {
    expect(cdnAudioSrc(null)).toBe('');
    expect(cdnAudioSrc(undefined)).toBe('');
    expect(cdnAudioSrc('')).toBe('');
  });

  it('passes local/relative paths through untouched', () => {
    expect(cdnAudioSrc('/uploads/a.mp3')).toBe('/uploads/a.mp3');
  });

  it('streams direct from R2 when no CDN configured', () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = R2;
    expect(cdnAudioSrc(`${R2}/audio/song.mp3`)).toBe(`${R2}/audio/song.mp3`);
  });

  it('rewrites R2 host to the CDN host when configured', () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = R2;
    process.env.NEXT_PUBLIC_R2_CDN_URL = CDN;
    expect(cdnAudioSrc(`${R2}/audio/song.mp3`)).toBe(`${CDN}/audio/song.mp3`);
  });

  it('tolerates trailing slashes on the env values', () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = `${R2}/`;
    process.env.NEXT_PUBLIC_R2_CDN_URL = `${CDN}/`;
    expect(cdnAudioSrc(`${R2}/audio/song.mp3`)).toBe(`${CDN}/audio/song.mp3`);
  });

  it('unwraps an /api/audio proxy URL back to the direct source', () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = R2;
    process.env.NEXT_PUBLIC_R2_CDN_URL = CDN;
    const wrapped = `/api/audio?src=${encodeURIComponent(`${R2}/audio/song.mp3`)}`;
    expect(cdnAudioSrc(wrapped)).toBe(`${CDN}/audio/song.mp3`);
  });

  it('leaves a non-R2 absolute URL alone', () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = R2;
    process.env.NEXT_PUBLIC_R2_CDN_URL = CDN;
    expect(cdnAudioSrc('https://other.com/x.mp3')).toBe('https://other.com/x.mp3');
  });
});
