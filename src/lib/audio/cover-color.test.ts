import { afterEach, describe, expect, it } from 'vitest';
import { extractCoverColor } from './cover-color';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_R2_CDN_URL;
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
});

describe('extractCoverColor', () => {
  it('skips raw public R2 images that cannot be canvas-read', async () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = 'https://pub-abc.r2.dev';

    await expect(extractCoverColor('https://pub-abc.r2.dev/covers/a.jpg')).resolves.toBeNull();
  });
});
