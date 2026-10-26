/**
 * What a cover file is, read from its first bytes (LABEL-52, 09 §4): format,
 * pixel size and colour model of a PNG or JPEG, without decoding it. The
 * artwork gate needs "at least 3000 x 3000, square, RGB"; no dimension is
 * stored anywhere, so the readiness store reads the head of the file and
 * this module answers. Pure: bytes in, facts out; anything it cannot read
 * is `null`, never a guess.
 *
 * PNG: 8-byte signature, then the IHDR chunk (width, height, bit depth,
 * colour type). JPEG: marker segments until a start-of-frame marker
 * (SOF0-SOF15 except DHT / JPG / DAC), which holds precision, height, width
 * and the component count (3 = YCbCr, i.e. RGB; 1 = grey; 4 = CMYK).
 */
export type ImageColor = 'rgb' | 'grey' | 'palette' | 'cmyk' | 'other';
export type ImageInfo = { format: 'png' | 'jpeg'; width: number; height: number; color: ImageColor };

/** How much of the file the store reads: JPEG puts its frame header after EXIF / ICC segments, which are rarely beyond this. */
export const IMAGE_HEAD_BYTES = 262144;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function readPng(b: Uint8Array): ImageInfo | null {
  // signature (8) + chunk length (4) + 'IHDR' (4) + width, height (8) + depth, colour type (2)
  if (b.length < 26) return null;
  if (!PNG_SIGNATURE.every((v, i) => b[i] === v)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const width = u32(b, 16);
  const height = u32(b, 20);
  if (width === 0 || height === 0) return null;
  const type = b[25];
  const color: ImageColor = type === 2 || type === 6 ? 'rgb' : type === 0 || type === 4 ? 'grey' : type === 3 ? 'palette' : 'other';
  return { format: 'png', width, height, color };
}

function readJpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    // Fill bytes: any run of 0xFF before the marker code.
    while (i < b.length && b[i] === 0xff) i += 1;
    const marker = b[i];
    i += 1;
    // Standalone markers carry no length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (i + 2 > b.length) return null;
    const length = u16(b, i);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      // length(2) precision(1) height(2) width(2) components(1)
      if (i + 8 > b.length) return null;
      const height = u16(b, i + 3);
      const width = u16(b, i + 5);
      const components = b[i + 7];
      if (width === 0 || height === 0) return null;
      const color: ImageColor = components === 3 ? 'rgb' : components === 1 ? 'grey' : components === 4 ? 'cmyk' : 'other';
      return { format: 'jpeg', width, height, color };
    }
    // Start of scan: the image data follows, and no frame header came first.
    if (marker === 0xda) return null;
    i += length;
  }
  return null;
}

/** The facts of a PNG or JPEG from its first bytes; `null` when it is neither, truncated before its header, or malformed. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes);
}

// ── The artwork rule (09 §4) ────────────────────────────────────────────

export const ARTWORK_MIN_PX_DEFAULT = 3000;

export type ArtworkSizeProblem = { code: 'artwork_unreadable' | 'artwork_not_square' | 'artwork_too_small' | 'artwork_color'; message: string };

/**
 * What stops this file being cover art: at least `minPx` on both sides,
 * square, RGB. One problem at a time in the order a person would fix them
 * (a file we cannot read says nothing else; a non-square one is judged by
 * its short side only once it is square). `info === null` is "we could not
 * read it", which is a blocker in its own right: a gate that cannot check
 * does not pass.
 */
export function artworkSizeProblems(info: ImageInfo | null, minPx: number = ARTWORK_MIN_PX_DEFAULT): ArtworkSizeProblem[] {
  if (!info) return [{ code: 'artwork_unreadable', message: 'The artwork’s size could not be read. Use a JPEG or PNG that opens normally.' }];
  const out: ArtworkSizeProblem[] = [];
  const size = `${info.width}×${info.height}`;
  if (info.width !== info.height) out.push({ code: 'artwork_not_square', message: `The artwork must be square; this one is ${size} px.` });
  if (Math.min(info.width, info.height) < minPx) out.push({ code: 'artwork_too_small', message: `The artwork must be at least ${minPx}×${minPx} px; this one is ${size} px.` });
  if (info.color !== 'rgb') out.push({ code: 'artwork_color', message: 'The artwork must be RGB (not greyscale, indexed or CMYK).' });
  return out;
}
