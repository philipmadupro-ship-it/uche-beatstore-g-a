/**
 * Cover-art fixtures for the cover layout specs, encoded here so the fixture
 * needs no image dependency.
 */
import { deflateSync } from 'node:zlib';

// ── A minimal PNG encoder, so the fixture needs no image dependency ──────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A w×h PNG: blue field, a red band along the image's first 20% (left edge of
 * a landscape, top of a portrait) and a white centre square. A correct centred
 * crop of a non-square image hides the red band; a top-left render shows it.
 */
export function fixturePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const landscape = w > h;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      let rgb = [40, 70, 160];
      const edge = landscape ? x < w * 0.2 : h > w && y < h * 0.2;
      if (edge) rgb = [200, 40, 40];
      const cx = Math.abs(x - w / 2) < Math.min(w, h) * 0.1;
      const cy = Math.abs(y - h / 2) < Math.min(w, h) * 0.1;
      if (cx && cy) rgb = [255, 255, 255];
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const SHAPES = {
  square: fixturePng(400, 400),
  portrait: fixturePng(300, 600),
  landscape: fixturePng(800, 300),
} as const;
export type Shape = keyof typeof SHAPES;
