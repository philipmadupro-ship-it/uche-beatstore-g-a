/**
 * Font embedding for cover art export.
 *
 * WHY THIS EXISTS. `svgToRasterBlob` rasterises by loading the SVG through
 * `new Image()`. An SVG loaded as an image renders in an isolated context: it
 * cannot see the page's stylesheets and cannot fetch external resources. So an
 * SVG that merely *names* `Synkopy` or `Akira Expanded` — which is all the
 * renderer did — exported with the browser's fallback sans-serif, and every
 * downloaded cover and every "set as cover" upload shipped in the wrong
 * typeface while the canvas showed the right one.
 *
 * The fix is to inline the fonts as base64 `@font-face` rules inside the SVG
 * itself. Data URIs are the one resource kind that isolated SVG rendering will
 * honour, which is the same reason images are inlined before export.
 *
 * Only the families a document actually uses get embedded — Synkopy alone is
 * 1.3 MB, so embedding all three unconditionally would triple export payloads
 * for a cover whose type is entirely Panchang.
 */

import type { ArtworkDocument } from '@/components/cover-art/cover-art-document';
import { facesFor } from './fonts';

export type CoverFontAsset = {
  family: string;
  /** Public path, served from /public/fonts. */
  url: string;
  weight: number;
  format: string;
};

/**
 * The exact faces a document needs inlined.
 *
 * Weight matters as much as family. This used to embed one hardcoded cut per
 * family — Panchang-Bold and nothing else — while the renderer wrote
 * `font-weight:700` on every text node regardless of what the layer asked for.
 * A Panchang Extralight title therefore left the studio as a Bold, and a
 * Synkopy title asked for a 700 that was never embedded at all, so the isolated
 * SVG synthesised a fake bold of the 400 file.
 *
 * `facesFor` snaps each request to a cut the family actually ships and
 * deduplicates by family+weight, so a cover using two sizes of the same cut
 * still inlines it once. Only *visible* layers with real text count: a hidden
 * or empty title should not drag 1.3 MB of Synkopy into the export.
 */
export function collectUsedFontAssets(document: ArtworkDocument): CoverFontAsset[] {
  const requests = document.layers
    .filter((layer) => layer.type === 'text' && layer.visible && layer.text.trim().length > 0)
    .map((layer) => {
      const text = layer as Extract<ArtworkDocument['layers'][number], { type: 'text' }>;
      return { font: text.fontFamily, weight: text.fontWeight };
    });
  return facesFor(requests).map((face) => ({ ...face, format: 'opentype' }));
}

export type EmbeddedFont = { family: string; dataUrl: string; weight: number; format: string };

/** Build the `@font-face` block that goes inside the SVG. */
export function buildFontFaceCss(fonts: EmbeddedFont[]): string {
  return fonts
    .map((font) => [
      '@font-face{',
      `font-family:'${font.family}';`,
      `src:url('${font.dataUrl}') format('${font.format}');`,
      `font-weight:${font.weight};`,
      'font-style:normal;',
      '}',
    ].join(''))
    .join('');
}

/**
 * Insert a `<style>` block as the first child of the SVG's `<defs>`.
 *
 * Anchored on the literal `<defs>` the renderer always emits rather than a
 * regex over the whole document, so it cannot accidentally match text content
 * that happens to contain the word.
 */
export function injectFontCss(svg: string, css: string): string {
  if (!css) return svg;
  const marker = '<defs>';
  const at = svg.indexOf(marker);
  if (at === -1) return svg;
  const style = `<style type="text/css">${css}</style>`;
  return svg.slice(0, at + marker.length) + style + svg.slice(at + marker.length);
}

/* ── Browser side ──────────────────────────────────────────────────────── */

/**
 * Fetched fonts, cached for the session.
 *
 * Synkopy is 1.3 MB; re-fetching and re-encoding it on every export — and the
 * producer will export repeatedly while iterating — is wasted time and memory
 * churn. Keyed by URL, so adding a weight later cannot collide.
 */
const fontCache = new Map<string, Promise<string>>();

async function fetchFontDataUrl(url: string): Promise<string> {
  const cached = fontCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
    const buffer = await response.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    // Chunked rather than String.fromCharCode(...bytes): a 1.3 MB font spreads
    // into 1.3 million arguments and blows the call stack.
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:font/otf;base64,${btoa(binary)}`;
  })();

  fontCache.set(url, pending);
  // A failed fetch must not poison the cache for the rest of the session.
  pending.catch(() => fontCache.delete(url));
  return pending;
}

/**
 * Return the document's SVG with the fonts it uses inlined.
 *
 * Fails soft: if a font cannot be fetched the export still happens, just with
 * fallback type for that family. Losing the whole export because one file 404'd
 * would be a worse outcome than a cover in the wrong face — and the caller has
 * no way to fix it mid-export either way.
 */
export async function embedFontsInSvg(svg: string, document: ArtworkDocument): Promise<string> {
  const assets = collectUsedFontAssets(document);
  if (assets.length === 0) return svg;

  const settled = await Promise.allSettled(
    assets.map(async (asset) => ({
      family: asset.family,
      weight: asset.weight,
      format: asset.format,
      dataUrl: await fetchFontDataUrl(asset.url),
    })),
  );

  const embedded = settled
    .filter((result): result is PromiseFulfilledResult<EmbeddedFont> => result.status === 'fulfilled')
    .map((result) => result.value);

  return injectFontCss(svg, buildFontFaceCss(embedded));
}
