import {
  defaultArtworkPalette,
  type ArtworkDocument, type ArtworkLayer, type ImageArtworkLayer, type ShapeArtworkLayer,
  type TextArtworkLayer, type WaveformArtworkLayer,
} from '@/components/cover-art/cover-art-document';
import { CARD_STYLES, type CardStyle } from '@/lib/share/styles';
import { safeBox, type Box, type SharePreset } from '@/lib/share/presets';
import { fitTitle, type ShareFill } from './fill';

/**
 * Share templates: (fill, preset) → an ordinary cover-art document.
 *
 * Nothing here draws. The result goes through `renderArtworkDocumentSvg` — the
 * same renderer as the Cover Art Studio — so fonts, effects, image crop and
 * waveform bars behave exactly as they do there, and there is no second
 * renderer to drift. Template ids ARE the saved `share_card_style` ids.
 */

export type ShareTemplate = (fill: ShareFill, preset: SharePreset) => ArtworkDocument;

const WHITE = '#FFFFFF';

type Base = Omit<ArtworkLayer, 'type'>;

function base(id: string, name: string, box: Box, z: number, extra: Partial<Base> = {}) {
  return {
    id, name, ...box, rotation: 0, opacity: 1, visible: true, locked: false,
    zIndex: z, blendMode: 'normal' as const, ...extra,
  };
}

type Layout = {
  cover: Box;
  text: Box;
  wave: Box;
  align: 'left' | 'center';
  titleLines: number;
  titleMax: number;
};

/** Where things go for each orientation, inside the safe zone. */
export function layoutFor(preset: SharePreset): Layout {
  const s = safeBox(preset);
  if (preset.orientation === 'landscape') {
    const cover = Math.min(s.height, 460);
    return {
      cover: { x: s.x + s.width - cover, y: s.y + Math.round((s.height - cover) / 2), width: cover, height: cover },
      text: { x: s.x, y: s.y + 20, width: s.width - cover - 56, height: s.height - 40 },
      wave: { x: s.x, y: s.y + s.height - 70, width: s.width - cover - 56, height: 70 },
      align: 'left', titleLines: 3, titleMax: 76,
    };
  }
  if (preset.orientation === 'square') {
    const cover = Math.round(s.width * 0.44);
    return {
      cover: { x: s.x + Math.round((s.width - cover) / 2), y: s.y, width: cover, height: cover },
      text: { x: s.x, y: s.y + cover + 36, width: s.width, height: 300 },
      wave: { x: s.x, y: s.y + s.height - 70, width: s.width, height: 70 },
      align: 'center', titleLines: 2, titleMax: 72,
    };
  }
  const cover = Math.round(s.width * 0.8);
  const coverY = s.y + 40;
  return {
    cover: { x: s.x + Math.round((s.width - cover) / 2), y: coverY, width: cover, height: cover },
    text: { x: s.x, y: coverY + cover + 70, width: s.width, height: 360 },
    wave: { x: s.x, y: s.y + s.height - 150, width: s.width, height: 150 },
    align: 'center', titleLines: 3, titleMax: 96,
  };
}

function textLayer(
  id: string, box: Box, z: number, text: string, o: Partial<TextArtworkLayer> & { fontSize: number },
): TextArtworkLayer {
  return {
    ...base(id, id, box, z), type: 'text', text,
    fontFamily: 'synkopy', fontWeight: 400, tracking: 0, lineHeight: 1.04,
    align: 'left', uppercase: false, color: WHITE, ...o,
  };
}

function rect(id: string, box: Box, z: number, fill: string, o: Partial<ShapeArtworkLayer> = {}): ShapeArtworkLayer {
  return { ...base(id, id, box, z, { opacity: o.opacity ?? 1 }), type: 'shape', shape: 'rect', fill, ...o };
}

function coverLayer(
  fill: ShareFill, box: Box, z: number, o: Partial<ImageArtworkLayer> = {}, id = 'cover',
): ArtworkLayer {
  if (!fill.coverUrl) {
    // No cover: a quiet accent panel rather than a broken image.
    return rect(id, box, z, fill.accent, { opacity: 0.16, cornerRadius: o.radius ?? 0 });
  }
  return {
    ...base(id, 'Cover', box, z), type: 'image', src: fill.coverUrl, label: 'Cover',
    treatment: 'normal', fit: 'cover', offsetX: 0, offsetY: 0, scale: 1, radius: 0, mask: 'none', ...o,
  } as ImageArtworkLayer;
}

function waveLayer(fill: ShareFill, box: Box, z: number, color: string, o: Partial<WaveformArtworkLayer> = {}): ArtworkLayer[] {
  if (fill.peaks.length === 0) return [];
  const count = Math.max(24, Math.floor(box.width / 14));
  return [{
    ...base('wave', 'Waveform', box, z), type: 'waveform',
    mode: 'mirror', style: 'low-scanline', amplitude: 1, strokeWidth: 8, smoothing: 0.1, color,
    peakSource: 'real', peaks: fill.peaks, barCount: count, barGap: 0.45, cap: 'round',
    normalize: true, mirror: true, ...o,
  }];
}

function meta(fill: ShareFill): string {
  return [fill.bpm ? `${fill.bpm} BPM` : null, fill.key].filter(Boolean).join('  ·  ');
}

function make(fill: ShareFill, preset: SharePreset, id: CardStyle, layers: ArtworkLayer[], background = '#090907'): ArtworkDocument {
  return {
    id: `share-${id}-${preset.id}`,
    name: `${fill.title} · ${id}`,
    version: 1,
    width: preset.width,
    height: preset.height,
    background,
    palette: { ...defaultArtworkPalette, background, accent: fill.accent, text: WHITE },
    templateId: 'brutalist-archive' as ArtworkDocument['templateId'],
    directionId: 'de-roche-mineral',
    source: { kind: 'track', label: fill.title },
    layers: layers.map((l, i) => ({ ...l, zIndex: i })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Eyebrow + title + artist + meta, left- or centre-aligned in the text box. */
function copyBlock(fill: ShareFill, preset: SharePreset, L: Layout, z: number, o: { upper?: boolean; accentArtist?: boolean; glow?: boolean } = {}): ArtworkLayer[] {
  const { text: t, align } = L;
  const eyebrowSize = preset.orientation === 'landscape' ? 20 : 26;
  const artistSize = preset.orientation === 'landscape' ? 28 : 38;
  // What is left for the headline once the other lines and the waveform are placed.
  const fixed = eyebrowSize + 26 + 22 + artistSize + (meta(fill) ? 26 + 30 : 0);
  const room = L.wave.y - 28 - t.y - fixed;
  const title = fitTitle(o.upper ? fill.title.toUpperCase() : fill.title, t.width, L.titleMax, 36, L.titleLines, room);
  const titleH = Math.round(title.lines.length * title.size * 1.04);
  const out: ArtworkLayer[] = [];
  let y = t.y;
  out.push(textLayer('eyebrow', { x: t.x, y, width: t.width, height: eyebrowSize + 6 }, z, fill.eyebrow, {
    fontFamily: 'panchang', fontSize: eyebrowSize, tracking: eyebrowSize * 0.22, uppercase: true,
    color: fill.accent, align,
  }));
  y += eyebrowSize + 26;
  out.push(textLayer('title', { x: t.x, y, width: t.width, height: titleH }, z + 1, title.lines.join('\n'), {
    fontSize: title.size, uppercase: !!o.upper, align,
    fx: o.glow ? { glow: { color: fill.accent, blur: 28, opacity: 0.55 } } : undefined,
  }));
  y += titleH + 22;
  out.push(textLayer('artist', { x: t.x, y, width: t.width, height: artistSize + 6 }, z + 2, `prod. ${fill.artist}`, {
    fontFamily: 'akira', fontSize: artistSize, color: o.accentArtist ? fill.accent : 'rgba(255,255,255,0.82)', align,
  }));
  const m = meta(fill);
  if (m) {
    y += artistSize + 26;
    out.push(textLayer('meta', { x: t.x, y, width: t.width, height: 30 }, z + 3, m, {
      fontFamily: 'panchang', fontSize: 22, tracking: 4, color: 'rgba(255,255,255,0.5)', align,
    }));
  }
  return out;
}

const minimal: ShareTemplate = (fill, preset) => {
  const L = layoutFor(preset);
  const full = { x: 0, y: 0, width: preset.width, height: preset.height };
  const layers: ArtworkLayer[] = [];
  if (fill.coverUrl) {
    layers.push({ ...coverLayer(fill, full, 0, {}, 'backdrop'), opacity: 0.35, fx: { blur: 60 } });
  }
  layers.push(rect('wash', full, 1, fill.accent, { opacity: 0.1 }));
  layers.push(coverLayer(fill, L.cover, 2, { radius: 32 }));
  layers.push(...copyBlock(fill, preset, L, 3));
  layers.push(...waveLayer(fill, L.wave, 10, fill.accent));
  return make(fill, preset, 'minimal', layers);
};

const magazine: ShareTemplate = (fill, preset) => {
  const L = layoutFor(preset);
  const s = safeBox(preset);
  const layers: ArtworkLayer[] = [];
  const portrait = preset.orientation === 'portrait';
  // Landscape and square: the cover bleeds off the right edge as a full-height
  // panel. Portrait: it bleeds right under the headline and the copy stacks below.
  const panel = preset.orientation === 'landscape' ? 520 : 500;
  const cover: Box = portrait
    ? { x: Math.round(preset.width * 0.18), y: 0, width: Math.round(preset.width * 0.82), height: Math.round(preset.width * 0.82) }
    : { x: preset.width - panel, y: 0, width: panel, height: preset.height };
  layers.push(coverLayer(fill, cover, 0));
  const textWidth = portrait ? s.width : preset.width - panel - s.x - 40;
  const text: Box = portrait
    ? { ...L.text, y: cover.y + cover.height + 80 }
    : { ...L.text, x: s.x, y: s.y + 40, width: textWidth };
  layers.push(rect('rule', { x: s.x, y: text.y - 28, width: 96, height: 8 }, 1, fill.accent));
  const left: Layout = { ...L, align: 'left', text, titleLines: 4 };
  layers.push(...copyBlock(fill, preset, left, 2, { upper: true }));
  layers.push(...waveLayer(fill, { ...L.wave, x: s.x, width: textWidth }, 10, 'rgba(255,255,255,0.6)'));
  return make(fill, preset, 'magazine', layers);
};

const mono: ShareTemplate = (fill, preset) => {
  const L = layoutFor(preset);
  const s = safeBox(preset);
  const layers: ArtworkLayer[] = [];
  layers.push(rect('bar', { x: 0, y: 0, width: preset.width, height: 14 }, 0, fill.accent));
  layers.push(coverLayer(fill, L.cover, 1, { treatment: 'grayscale' }));
  const left: Layout = { ...L, align: 'left', text: { ...L.text, x: s.x } };
  layers.push(...copyBlock(fill, preset, left, 2, { upper: true, accentArtist: true }));
  layers.push(...waveLayer(fill, L.wave, 10, WHITE, { barGap: 0.6, cap: 'flat' }));
  layers.push(rect('bar2', { x: 0, y: preset.height - 14, width: preset.width, height: 14 }, 11, fill.accent));
  return make(fill, preset, 'mono', layers, '#000000');
};

const glow: ShareTemplate = (fill, preset) => {
  const L = layoutFor(preset);
  const full = { x: 0, y: 0, width: preset.width, height: preset.height };
  const layers: ArtworkLayer[] = [];
  if (fill.coverUrl) layers.push({ ...coverLayer(fill, full, 0, {}, 'backdrop'), opacity: 0.55, fx: { blur: 90, saturation: 1.3 } });
  layers.push(rect('veil', full, 1, '#090907', { opacity: 0.45 }));
  layers.push(coverLayer(fill, L.cover, 2, { radius: 32, fx: { shadow: { color: fill.accent, blur: 60, x: 0, y: 0, opacity: 0.5 } } }));
  layers.push(...copyBlock(fill, preset, L, 3, { glow: true }));
  layers.push(...waveLayer(fill, L.wave, 10, fill.accent));
  return make(fill, preset, 'glow', layers);
};

export const SHARE_TEMPLATES: Record<CardStyle, ShareTemplate> = { minimal, magazine, mono, glow };

export function buildShareDocument(style: CardStyle, fill: ShareFill, preset: SharePreset): ArtworkDocument {
  return (SHARE_TEMPLATES[style] ?? minimal)(fill, preset);
}

export { CARD_STYLES };
