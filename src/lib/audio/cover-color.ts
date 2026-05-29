/**
 * Dominant-color extraction from cover art — zero dependency.
 *
 * Draws the image to a tiny offscreen canvas and averages the most
 * saturated pixels to find an accent color that reads well as an
 * ambient background tint (Spotify's signature now-playing treatment).
 *
 * Results are cached per-URL so re-opening the same track is instant.
 */

const cache = new Map<string, string>();

/** Returns an `rgb(r,g,b)` string, or null if extraction fails. */
export async function extractCoverColor(url: string): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url)!;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24; // tiny — we only need the average, not detail
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Weight each pixel by its saturation so a vivid accent beats
        // a muddy average. Skip near-black / near-white / transparent.
        let r = 0, g = 0, b = 0, weightSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i], pg = data[i + 1], pb = data[i + 2], pa = data[i + 3];
          if (pa < 125) continue;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          const lum = (max + min) / 2;
          if (lum < 25 || lum > 235) continue; // skip extremes
          const sat = max === 0 ? 0 : (max - min) / max;
          const w = sat * sat + 0.15; // saturation-weighted, with a floor
          r += pr * w; g += pg * w; b += pb * w; weightSum += w;
        }
        if (weightSum === 0) return resolve(null);
        const color = `rgb(${Math.round(r / weightSum)}, ${Math.round(g / weightSum)}, ${Math.round(b / weightSum)})`;
        cache.set(url, color);
        resolve(color);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
