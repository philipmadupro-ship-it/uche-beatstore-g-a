import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-s3', async (orig) => orig());

afterEach(() => vi.unstubAllEnvs());

async function key(url: string) {
  vi.stubEnv('NEXT_PUBLIC_R2_PUBLIC_URL', 'https://pub.r2.dev/');
  const { uploadedImageKey } = await import('./upload');
  return uploadedImageKey(url);
}

describe('uploadedImageKey', () => {
  it('accepts exactly what uploadImage mints', async () => {
    expect(await key('https://pub.r2.dev/covers/abcDEF_123.webp')).toBe('covers/abcDEF_123.webp');
    expect(await key('/uploads/covers/abcDEF_123.png')).toBe('covers/abcDEF_123.png');
  });

  it('refuses anything that could reach another object', async () => {
    for (const url of [
      'https://evil.example/covers/abcDEF_123.webp',
      'https://pub.r2.dev/previews/abcDEF_123.webp',
      'https://pub.r2.dev/covers/../tracks/abcDEF_123.webp',
      'https://pub.r2.dev/covers/abcDEF_123.mp3',
      '/uploads/covers/../../x.png',
      'https://pub.r2.dev.evil.example/covers/abcDEF_123.webp',
      'r2://private/covers/abcDEF_123.webp',
    ]) expect(await key(url)).toBeNull();
  });
});
