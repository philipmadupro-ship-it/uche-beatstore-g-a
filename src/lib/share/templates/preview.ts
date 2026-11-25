import { renderArtworkDocumentSvg } from '@/components/cover-art/cover-art-document';
import { buildShareDocument } from './index';
import type { ShareFill } from './fill';
import type { CardStyle } from '@/lib/share/styles';
import type { SharePreset } from '@/lib/share/presets';

/**
 * The same SVG the export draws, sized to its container. On the page the
 * `@font-face` rules already apply, so no font embedding is needed to preview.
 */
export function shareSvgForPreview(style: CardStyle, fill: ShareFill, preset: SharePreset): string {
  const svg = renderArtworkDocumentSvg(buildShareDocument(style, fill, preset));
  return svg.replace(/^<svg ([^>]*?)width="\d+" height="\d+"/, '<svg $1width="100%" height="100%"');
}
