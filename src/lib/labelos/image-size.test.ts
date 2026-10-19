import { describe, expect, it } from 'vitest';
import { artworkSizeProblems, readImageInfo, type ImageInfo } from './image-size';

function png(width: number, height: number, colorType = 2): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b[24] = 8;
  b[25] = colorType;
  return b;
}

/** SOI, an APP1 segment (EXIF-like filler), optionally a DHT, then SOF0. */
function jpeg(width: number, height: number, components = 3, marker = 0xc0): Uint8Array {
  const app = [0xff, 0xe1, 0x00, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8];
  const dht = [0xff, 0xc4, 0x00, 0x04, 0, 0];
  const sof = [0xff, marker, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app, ...dht, ...sof]);
}

describe('readImageInfo', () => {
  it('reads a PNG from its IHDR', () => {
    expect(readImageInfo(png(3000, 3000))).toEqual({ format: 'png', width: 3000, height: 3000, color: 'rgb' });
    expect(readImageInfo(png(4000, 3000, 6))?.color).toBe('rgb');
    expect(readImageInfo(png(10, 10, 0))?.color).toBe('grey');
    expect(readImageInfo(png(10, 10, 3))?.color).toBe('palette');
  });

  it('reads a JPEG past its other segments, baseline and progressive', () => {
    expect(readImageInfo(jpeg(3200, 3200))).toEqual({ format: 'jpeg', width: 3200, height: 3200, color: 'rgb' });
    expect(readImageInfo(jpeg(3200, 3000, 3, 0xc2))).toMatchObject({ width: 3200, height: 3000 });
    expect(readImageInfo(jpeg(100, 100, 1))?.color).toBe('grey');
    expect(readImageInfo(jpeg(100, 100, 4))?.color).toBe('cmyk');
  });

  it('says null rather than guessing: empty, truncated, wrong type, zero size, scan before frame', () => {
    expect(readImageInfo(new Uint8Array())).toBeNull();
    expect(readImageInfo(png(3000, 3000).slice(0, 20))).toBeNull();
    expect(readImageInfo(jpeg(3000, 3000).slice(0, 25))).toBeNull();
    expect(readImageInfo(new TextEncoder().encode('GIF89a....................'))).toBeNull();
    expect(readImageInfo(png(0, 5))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0, 0]))).toBeNull();
  });
});

describe('artworkSizeProblems (spec 09 §4: at least 3000×3000, square, RGB)', () => {
  const ok: ImageInfo = { format: 'png', width: 3000, height: 3000, color: 'rgb' };

  it('passes exactly at the minimum and above', () => {
    expect(artworkSizeProblems(ok)).toEqual([]);
    expect(artworkSizeProblems({ ...ok, width: 4000, height: 4000 })).toEqual([]);
  });

  it('refuses one pixel short, naming the size it found', () => {
    const r = artworkSizeProblems({ ...ok, width: 2999, height: 2999 });
    expect(r.map((p) => p.code)).toEqual(['artwork_too_small']);
    expect(r[0].message).toContain('2999×2999');
  });

  it('refuses a rectangle, even a big one', () => {
    expect(artworkSizeProblems({ ...ok, width: 4000, height: 3000 }).map((p) => p.code)).toEqual(['artwork_not_square']);
    expect(artworkSizeProblems({ ...ok, width: 3000, height: 2000 }).map((p) => p.code)).toEqual(['artwork_not_square', 'artwork_too_small']);
  });

  it('refuses a colour model that is not RGB', () => {
    for (const color of ['grey', 'palette', 'cmyk', 'other'] as const) expect(artworkSizeProblems({ ...ok, color }).map((p) => p.code)).toEqual(['artwork_color']);
  });

  it('a file it could not read does not pass', () => {
    expect(artworkSizeProblems(null).map((p) => p.code)).toEqual(['artwork_unreadable']);
  });

  it('the minimum is configurable', () => {
    expect(artworkSizeProblems({ ...ok, width: 1500, height: 1500 }, 1400)).toEqual([]);
    expect(artworkSizeProblems({ ...ok, width: 1500, height: 1500 }, 1600).map((p) => p.code)).toEqual(['artwork_too_small']);
  });
});
