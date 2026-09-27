import { imageUploadLimits, type AcceptedImageMimeType } from './image-validation';

/**
 * Shrink cover artwork in the browser so it fits the upload limit.
 *
 * A 3000x3000 PNG export is routinely 10–20 MB, well past what the upload
 * route can receive (see `imageUploadLimits`). Rather than refuse it, the
 * browser redraws it at no more than `COVER_MAX_EDGE` and re-encodes it,
 * stepping quality and then size down until it fits. Files that already fit
 * and are not oversized in pixels go up untouched, byte for byte.
 *
 * The loop is pure over an injected `encode`, so the stepping rules are tested
 * without a canvas.
 */

/** Largest edge stored. 3000px is the storefront's cover spec and the studio's artboard. */
export const COVER_MAX_EDGE = 3000;
/** Never shrink below this edge; a cover this small is not worth storing. */
const MIN_EDGE = 600;
const QUALITY_STEPS = [0.92, 0.85, 0.75, 0.65] as const;
const EDGE_STEP = 0.8;

export interface EncodeAttempt {
  width: number;
  height: number;
  type: AcceptedImageMimeType;
  quality: number;
}

export type Encoder = (attempt: EncodeAttempt) => Promise<Blob | null>;

/** Scale (w, h) so the longer edge is at most `maxEdge`, preserving aspect. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Output formats to try, in order. WebP keeps PNG transparency at a fraction
 * of the size; JPEG is the fallback for browsers whose canvas cannot encode
 * WebP (they return a PNG instead, which the loop rejects by type).
 */
export function outputTypes(source: AcceptedImageMimeType): AcceptedImageMimeType[] {
  return source === 'image/jpeg' ? ['image/jpeg'] : ['image/webp', 'image/jpeg'];
}

export async function shrinkToFit(
  source: { width: number; height: number; type: AcceptedImageMimeType },
  encode: Encoder,
  maxBytes: number = imageUploadLimits.maxSizeBytes,
): Promise<Blob | null> {
  let { width, height } = fitWithin(source.width, source.height, COVER_MAX_EDGE);
  const types = outputTypes(source.type);
  for (;;) {
    for (const type of types) {
      for (const quality of QUALITY_STEPS) {
        const blob = await encode({ width, height, type, quality });
        // A canvas that cannot encode `type` silently hands back PNG.
        if (!blob || blob.type !== type) break;
        if (blob.size <= maxBytes) return blob;
      }
    }
    if (Math.max(width, height) * EDGE_STEP < MIN_EDGE) return null;
    width = Math.max(1, Math.round(width * EDGE_STEP));
    height = Math.max(1, Math.round(height * EDGE_STEP));
  }
}

const EXTENSION: Record<AcceptedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Browser-only. Returns `file` unchanged when it already fits, otherwise a
 * re-encoded copy. Throws a user-facing message when it cannot be made to fit
 * or cannot be decoded.
 */
export async function prepareImageForUpload(
  file: File,
  maxBytes: number = imageUploadLimits.maxSizeBytes,
): Promise<File> {
  const type = file.type as AcceptedImageMimeType;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= maxBytes) return file;
    throw new Error('That image could not be read. Try exporting it again as JPG or PNG.');
  }
  try {
    if (file.size <= maxBytes && Math.max(bitmap.width, bitmap.height) <= COVER_MAX_EDGE) {
      return file;
    }
    const canvas = document.createElement('canvas');
    const encode: Encoder = ({ width, height, type: outType, quality }) => {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return Promise.resolve(null);
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, width, height);
      if (outType === 'image/jpeg') {
        // JPEG has no alpha; transparent pixels would otherwise encode black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      return new Promise((resolve) => canvas.toBlob(resolve, outType, quality));
    };
    const blob = await shrinkToFit({ width: bitmap.width, height: bitmap.height, type }, encode, maxBytes);
    if (!blob) throw new Error('That image is too detailed to shrink under the upload limit.');
    const base = file.name.replace(/\.[^.]+$/, '') || 'cover';
    return new File([blob], `${base}.${EXTENSION[blob.type as AcceptedImageMimeType]}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
