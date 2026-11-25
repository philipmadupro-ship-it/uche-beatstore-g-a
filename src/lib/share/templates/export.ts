import { renderArtworkDocumentSvg } from '@/components/cover-art/cover-art-document';
import { embedFontsInSvg } from '@/lib/cover/font-embed';
import { svgToRasterBlob } from '@/design-system/presets/cover-art-raster';
import { buildShareDocument } from './index';
import type { ShareFill } from './fill';
import type { CardStyle } from '@/lib/share/styles';
import type { SharePreset } from '@/lib/share/presets';

/**
 * An image rasterised through `new Image()` is a sandbox: it cannot fetch
 * fonts, stylesheets or cross-origin images. So before export the cover is
 * inlined as a data URI and the fonts are embedded, and the finished SVG is
 * checked to contain NO reference to anything outside itself — which is also
 * what guarantees no private or signed URL can ride along in the file.
 */

/** Anything an SVG could load from outside itself. */
const EXTERNAL_REF = /(?:href|src)\s*=\s*["'](?!data:|#)|url\(\s*(?!["']?(?:data:|#))|r2:\/\/|@import/i;

export function isSelfContainedSvg(svg: string): boolean {
  return !EXTERNAL_REF.test(svg);
}

export type Fetcher = (url: string) => Promise<Blob>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read')));
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The fill with its cover inlined. A cover that cannot be fetched (CORS, 404)
 * is dropped rather than failing the export: the template draws its no-cover
 * panel, and `lostCover` tells the UI to say so.
 */
export async function inlineCover(
  fill: ShareFill, fetcher: Fetcher = defaultFetcher, toDataUrl: (b: Blob) => Promise<string> = blobToDataUrl,
): Promise<{ fill: ShareFill; lostCover: boolean }> {
  if (!fill.coverUrl) return { fill, lostCover: false };
  try {
    const blob = await fetcher(fill.coverUrl);
    if (!blob.type.startsWith('image/')) throw new Error('not an image');
    return { fill: { ...fill, coverUrl: await toDataUrl(blob) }, lostCover: false };
  } catch {
    return { fill: { ...fill, coverUrl: null }, lostCover: true };
  }
}

/** Fonts + self-containment: the SVG exactly as it may leave the app. */
export async function shareSvgForExport(style: CardStyle, fill: ShareFill, preset: SharePreset) {
  const doc = buildShareDocument(style, fill, preset);
  const svg = await embedFontsInSvg(renderArtworkDocumentSvg(doc), doc);
  if (!isSelfContainedSvg(svg)) throw new Error('Share image still references an external resource.');
  return svg;
}

export async function exportShareImage(style: CardStyle, fill: ShareFill, preset: SharePreset) {
  const inlined = await inlineCover(fill);
  const svg = await shareSvgForExport(style, inlined.fill, preset);
  const blob = await svgToRasterBlob(svg, {
    width: preset.width, height: preset.height, mimeType: 'image/png', quality: 1,
  });
  return { blob, lostCover: inlined.lostCover };
}
