import { describe, expect, it, vi } from 'vitest';
import { COVER_MAX_EDGE, fitWithin, outputTypes, shrinkToFit, type EncodeAttempt } from './image-resize';

const MB = 1024 * 1024;

/** Fake encoder: size scales with pixels x quality; `supports` models canvas WebP support. */
function encoder(bytesPerPixelAtFull: number, supports: string[] = ['image/webp', 'image/jpeg']) {
  return vi.fn(async ({ width, height, type, quality }: EncodeAttempt) => {
    const size = Math.round(width * height * bytesPerPixelAtFull * quality);
    const actual = supports.includes(type) ? type : 'image/png';
    return { size, type: actual } as Blob;
  });
}

describe('fitWithin', () => {
  it('leaves images inside the edge alone', () => {
    expect(fitWithin(1200, 800, 3000)).toEqual({ width: 1200, height: 800 });
  });
  it('scales the longer edge down and keeps aspect', () => {
    expect(fitWithin(6000, 3000, 3000)).toEqual({ width: 3000, height: 1500 });
    expect(fitWithin(2000, 8000, 3000)).toEqual({ width: 750, height: 3000 });
  });
});

describe('outputTypes', () => {
  it('keeps JPEG as JPEG and tries WebP first for PNG (keeps alpha)', () => {
    expect(outputTypes('image/jpeg')).toEqual(['image/jpeg']);
    expect(outputTypes('image/png')).toEqual(['image/webp', 'image/jpeg']);
  });
});

describe('shrinkToFit', () => {
  it('caps a huge source at the cover edge before encoding', async () => {
    const encode = encoder(0.1);
    const blob = await shrinkToFit({ width: 8000, height: 8000, type: 'image/png' }, encode, 4 * MB);
    expect(blob).not.toBeNull();
    expect(encode.mock.calls[0][0]).toMatchObject({ width: COVER_MAX_EDGE, height: COVER_MAX_EDGE, type: 'image/webp' });
  });

  it('steps quality down before shrinking pixels', async () => {
    // 3000² × 0.52 × 0.92 ≈ 4.31M bytes (over 4 MB); at 0.85 ≈ 3.98M (fits).
    const encode = encoder(0.52);
    const blob = await shrinkToFit({ width: 3000, height: 3000, type: 'image/jpeg' }, encode, 4 * MB);
    expect(blob!.size).toBeLessThanOrEqual(4 * MB);
    expect(encode.mock.calls.map((c) => c[0].quality)).toEqual([0.92, 0.85]);
    expect(encode.mock.calls[1][0].width).toBe(3000);
  });

  it('shrinks pixels when quality alone is not enough', async () => {
    const encode = encoder(1);
    const blob = await shrinkToFit({ width: 3000, height: 3000, type: 'image/jpeg' }, encode, 4 * MB);
    expect(blob!.size).toBeLessThanOrEqual(4 * MB);
    expect(encode.mock.calls.at(-1)![0].width).toBeLessThan(3000);
  });

  it('falls back to JPEG when the canvas cannot encode WebP', async () => {
    const encode = encoder(0.3, ['image/jpeg']);
    const blob = await shrinkToFit({ width: 3000, height: 3000, type: 'image/png' }, encode, 4 * MB);
    expect(blob!.type).toBe('image/jpeg');
  });

  it('gives up rather than storing a thumbnail', async () => {
    const encode = encoder(1000);
    expect(await shrinkToFit({ width: 3000, height: 3000, type: 'image/jpeg' }, encode, 4 * MB)).toBeNull();
    expect(Math.min(...encode.mock.calls.map((c) => c[0].width))).toBeGreaterThanOrEqual(600 * 0.8);
  });
});
