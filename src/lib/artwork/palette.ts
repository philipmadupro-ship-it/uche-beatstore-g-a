/**
 * Dominant-colour extraction.
 *
 * The quantiser is pure and takes raw pixels, so it can be tested without a
 * canvas, a DOM or an image. The browser-side shell that reads pixels off a
 * logo lives in `extract.client.ts`.
 *
 * Deliberately a coarse bucket count rather than k-means: we are choosing two
 * or three colours to build a background from, not compressing a GIF. Bucketing
 * is O(n) in one pass over the pixels, which matters because this runs on the
 * main thread right after the producer picks a file.
 */

import { rgbToHex, rgbToHsl, luminance, type Rgb } from './color';

export interface PaletteEntry {
  hex: string;
  /** Share of sampled pixels this bucket accounts for, 0..1. */
  weight: number;
}

/** Colours per channel axis. 4 → 64 buckets, enough separation for a logo. */
const BUCKETS_PER_CHANNEL = 4;

/**
 * Pixels below this alpha are ignored. Logos are usually transparent PNGs, and
 * counting the transparent field would return "the background" as the brand
 * colour for almost every upload.
 */
const MIN_ALPHA = 125;

/**
 * Near-white and near-black are dropped before ranking.
 *
 * Almost every logo is mostly one or the other, so without this the dominant
 * colour is white with the actual brand colour a distant third — and a
 * gradient built from it is grey. The extremes are still available as a
 * fallback when a logo genuinely has no chroma.
 */
const MIN_LUMA = 0.06;
const MAX_LUMA = 0.94;

/**
 * Reduce raw RGBA pixels to a ranked palette.
 *
 * Ranking is by bucket population weighted toward saturation: a logo that is
 * 80% off-white with a small saturated mark should yield the mark, because
 * that is what a person would call its colour.
 */
export function quantizePalette(
  pixels: Uint8ClampedArray | number[],
  maxColors = 5,
): PaletteEntry[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let counted = 0;
  const size = BUCKETS_PER_CHANNEL;
  const step = 256 / size;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
    if (a < MIN_ALPHA) continue;

    const luma = luminance({ r, g, b });
    if (luma < MIN_LUMA || luma > MAX_LUMA) continue;

    const key =
      Math.min(size - 1, Math.floor(r / step)) * size * size +
      Math.min(size - 1, Math.floor(g / step)) * size +
      Math.min(size - 1, Math.floor(b / step));

    const cur = buckets.get(key);
    if (cur) { cur.r += r; cur.g += g; cur.b += b; cur.n += 1; }
    else buckets.set(key, { r, g, b, n: 1 });
    counted += 1;
  }

  // Nothing but transparency or extremes — the caller falls back to the
  // theme accent rather than rendering a gradient out of nothing.
  if (counted === 0) return [];

  const scored = Array.from(buckets.values()).map((bucket) => {
    const avg: Rgb = { r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n };
    const { s } = rgbToHsl(avg);
    const share = bucket.n / counted;
    // Chroma is weighted quadratically, not linearly. A linear term loses to
    // area every time: a logo that is 87% mid-grey with a 13% red mark still
    // scored grey, and the gradient built from it was grey — which is the one
    // outcome this whole feature exists to avoid. Squaring makes saturation
    // decisive while `share` stays linear, so a handful of stray pixels can
    // never outrank the actual body of the image.
    const chroma = s + 0.15;
    return { hex: rgbToHex(avg), weight: share, score: share * chroma * chroma };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxColors)
    .map(({ hex, weight }) => ({ hex, weight }));
}

/**
 * Validate a palette loaded from the database.
 *
 * Stored JSON is not trusted input: it was written by an older build, may have
 * been edited by hand, and feeds straight into a CSS value. Anything unusable
 * is dropped rather than thrown, because a missing gradient is a fallback and
 * a thrown one is a blank page.
 */
export function normalisePalette(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const hex = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object' && typeof (entry as PaletteEntry).hex === 'string')
        ? (entry as PaletteEntry).hex
        : null;
    if (!hex) continue;
    const normalised = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())
      ? (hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`)
      : null;
    if (normalised && !out.includes(normalised.toLowerCase())) out.push(normalised.toLowerCase());
  }
  return out;
}

/** Most colours a producer may curate. Past this the gradient stops being a
 *  brand and starts being a rainbow, and the picker becomes a spreadsheet. */
export const MAX_PALETTE = 8;

/** Replace one colour by index, returning a new array. */
export function setPaletteColor(palette: string[], index: number, hex: string): string[] {
  if (index < 0 || index >= palette.length) return palette;
  const next = [...palette];
  next[index] = hex.toLowerCase();
  return next;
}

/** Append a colour, refusing duplicates and respecting the cap. */
export function addPaletteColor(palette: string[], hex: string): string[] {
  const normalised = hex.trim().toLowerCase();
  if (palette.length >= MAX_PALETTE) return palette;
  if (palette.includes(normalised)) return palette;
  return [...palette, normalised];
}

/**
 * Remove a colour, but never the last one.
 *
 * An empty palette silently falls back to the theme accent, so allowing it
 * would make "I removed my colours and my artwork went beige" look like a bug
 * rather than the consequence it is.
 */
export function removePaletteColor(palette: string[], index: number): string[] {
  if (palette.length <= 1) return palette;
  if (index < 0 || index >= palette.length) return palette;
  return palette.filter((_, i) => i !== index);
}
