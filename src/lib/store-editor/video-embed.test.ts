import { describe, expect, it } from 'vitest';
import { VIDEO_EMBED_ORIGINS, videoEmbedUrl } from './video-embed';
import { buildCsp } from '@/lib/security/csp';

describe('videoEmbedUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://vimeo.com/76979871/abc123def', 'https://player.vimeo.com/video/76979871?h=abc123def'],
    ['https://player.vimeo.com/video/76979871?h=abc123', 'https://player.vimeo.com/video/76979871?h=abc123'],
  ])('%s → %s', (input, expected) => {
    expect(videoEmbedUrl(input)).toBe(expected);
  });

  it.each([
    '', '   ', null, undefined,
    'https://evil.example/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UCabc',
    'javascript:alert(1)',
    'https://vimeo.com/about',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
  ])('refuses %s', (input) => {
    expect(videoEmbedUrl(input)).toBeNull();
  });

  it('every origin it can emit is allowed by the /store frame-src', () => {
    const frameSrc = buildCsp('n').split('; ').find((d) => d.startsWith('frame-src'))!;
    for (const origin of VIDEO_EMBED_ORIGINS) expect(frameSrc.split(' ')).toContain(origin);
    for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/76979871']) {
      expect(VIDEO_EMBED_ORIGINS).toContain(new URL(videoEmbedUrl(url)!).origin);
    }
  });
});
