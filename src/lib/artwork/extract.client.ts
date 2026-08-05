'use client';

/**
 * Browser shell around the pure quantiser: read pixels off an image, hand them
 * to `quantizePalette`.
 *
 * All the judgement lives in `palette.ts` so it can be tested without a DOM.
 * This file only does the parts that need a browser, and is kept deliberately
 * thin for that reason.
 */

import { quantizePalette, type PaletteEntry } from './palette';

/**
 * Longest edge the image is scaled to before sampling.
 *
 * A brand logo can be 4000px square; reading 16M pixels on the main thread to
 * pick three colours would freeze the tab at exactly the moment the producer
 * is watching. 160px is far more than enough resolution to know what colour
 * something is, and the downscale is done by the GPU.
 */
const SAMPLE_EDGE = 160;

export async function extractPaletteFromFile(file: File, maxColors = 5): Promise<PaletteEntry[]> {
  const url = URL.createObjectURL(file);
  try {
    return await extractPaletteFromUrl(url, maxColors);
  } finally {
    // Always, even on failure — an object URL leaks its whole Blob otherwise.
    URL.revokeObjectURL(url);
  }
}

export async function extractPaletteFromUrl(url: string, maxColors = 5): Promise<PaletteEntry[]> {
  const img = await loadImage(url);

  const scale = Math.min(1, SAMPLE_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, w, h);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas — a cross-origin image without CORS headers. Returning
    // an empty palette makes the caller fall back to the theme accent, which
    // is a far better outcome than an exception during a file pick.
    return [];
  }

  return quantizePalette(data.data, maxColors);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Needed for remote covers; harmless for object URLs.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for colour extraction'));
    img.src = url;
  });
}
