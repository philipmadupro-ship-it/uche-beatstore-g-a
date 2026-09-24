import { describe, expect, it } from 'vitest';
import { toVideoEmbed } from './video-embed';

describe('toVideoEmbed', () => {
  it('converts YouTube watch, share, shorts and embed links', () => {
    const embed = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    expect(toVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbed('https://youtu.be/dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbed('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbed('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(embed);
  });
  it('converts Vimeo links', () => {
    expect(toVideoEmbed('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(toVideoEmbed('https://player.vimeo.com/video/76979871')).toBe('https://player.vimeo.com/video/76979871');
  });
  it('refuses everything else', () => {
    expect(toVideoEmbed('https://evil.example/embed/x')).toBeNull();
    expect(toVideoEmbed('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(toVideoEmbed('javascript:alert(1)')).toBeNull();
    expect(toVideoEmbed('')).toBeNull();
  });
});
