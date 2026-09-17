/**
 * Artboard sizes, and what happens to the artwork when one changes.
 *
 * The studio was square and only square — 3000×3000, written into the document
 * factory. That is the right default for a cover, and the wrong only option for
 * a producer who also needs a 4:5 for a feed post and a 9:16 for a story.
 *
 * Resizing is the interesting half. Layers are positioned in document units, so
 * changing the canvas without touching them leaves the artwork anchored to the
 * top-left of a differently-shaped board — everything drifts off-centre and a
 * full-bleed background stops reaching the edges. `resizeArtboard` therefore
 * offers two honest behaviours, and the scaling one is careful to scale
 * EVERYTHING measured in document units, including effects: a 24-unit blur on a
 * 3000px board is a soft haze, and the same 24 units on a 1080px board is a
 * smear. Effects that did not scale were the subtle bug waiting to happen here.
 *
 * Pure, per the repo's pure-logic rule, and tested alongside.
 */

import type { ArtworkDocument, ArtworkLayer } from '@/components/cover-art/cover-art-document';
import type { ArtworkLayerFx } from './effects';

export type ArtboardPreset = {
  id: string;
  name: string;
  hint: string;
  width: number;
  height: number;
};

/**
 * The sizes a beat producer actually ships to.
 *
 * Dimensions are the real platform requirements rather than round numbers:
 * 3000×3000 is the DSP master, 1400×1400 the minimum most stores accept.
 */
export const artboardPresets: ArtboardPreset[] = [
  { id: 'square-3000', name: 'Cover', hint: '1:1 · streaming master', width: 3000, height: 3000 },
  { id: 'square-2048', name: 'Cover 2K', hint: '1:1 · lighter master', width: 2048, height: 2048 },
  { id: 'square-1400', name: 'Cover 1.4K', hint: '1:1 · store minimum', width: 1400, height: 1400 },
  { id: 'portrait-4-5', name: 'Feed post', hint: '4:5 · Instagram feed', width: 2160, height: 2700 },
  { id: 'story-9-16', name: 'Story', hint: '9:16 · story / Reels', width: 1620, height: 2880 },
  { id: 'wide-16-9', name: 'Video', hint: '16:9 · YouTube / banner', width: 2560, height: 1440 },
  { id: 'banner-3-1', name: 'Banner', hint: '3:1 · storefront header', width: 2880, height: 960 },
];

/** Smallest and largest artboard we will accept, in document units. */
export const ARTBOARD_MIN = 320;
export const ARTBOARD_MAX = 6000;

export function clampArtboardSize(value: number): number {
  // Only NaN is meaningless and falls back to the minimum. An infinity is a
  // magnitude, so it clamps like any other too-large number — guarding with
  // `!Number.isFinite` lumped the two together and turned "far too big" into
  // "smallest possible board", which is the opposite of what was asked for.
  if (Number.isNaN(value)) return ARTBOARD_MIN;
  return Math.round(Math.min(ARTBOARD_MAX, Math.max(ARTBOARD_MIN, value)));
}

/** The preset matching a document's current size, if any. */
export function matchArtboardPreset(width: number, height: number): ArtboardPreset | null {
  return artboardPresets.find((preset) => preset.width === width && preset.height === height) ?? null;
}

/** Reduce a ratio to its simplest whole-number form, for display. */
export function aspectLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/**
 * How a resize treats the existing artwork.
 *
 * `scale` keeps the composition and rescales it to the new board — the right
 * default, because a producer changing 1:1 to 4:5 wants the same design.
 * `keep` leaves every layer exactly where it is, which is what you want when
 * you are extending the canvas to make room rather than reformatting.
 */
export type ArtboardResizeMode = 'scale' | 'keep';

/** Scale every length inside an effect object. Effects are in document units. */
export function scaleFx(fx: ArtworkLayerFx | undefined, factor: number): ArtworkLayerFx | undefined {
  if (!fx) return fx;
  const next: ArtworkLayerFx = { ...fx };
  if (typeof fx.blur === 'number') next.blur = fx.blur * factor;
  if (typeof fx.chromatic === 'number') next.chromatic = fx.chromatic * factor;
  if (fx.shadow) {
    next.shadow = {
      ...fx.shadow,
      x: fx.shadow.x * factor,
      y: fx.shadow.y * factor,
      blur: fx.shadow.blur * factor,
    };
  }
  if (fx.glow) next.glow = { ...fx.glow, blur: fx.glow.blur * factor };
  // brightness/contrast/saturation/hue/grain/vignette/posterize/gradientMap are
  // all unitless ratios or counts — scaling them would be meaningless.
  return next;
}

/** Scale one layer about the artboard centre. */
function scaleLayer(
  layer: ArtworkLayer,
  factor: number,
  from: { width: number; height: number },
  to: { width: number; height: number },
): ArtworkLayer {
  const centreX = (layer.x + layer.width / 2 - from.width / 2) * factor + to.width / 2;
  const centreY = (layer.y + layer.height / 2 - from.height / 2) * factor + to.height / 2;
  const width = layer.width * factor;
  const height = layer.height * factor;

  const base = {
    ...layer,
    x: Math.round(centreX - width / 2),
    y: Math.round(centreY - height / 2),
    width: Math.round(width),
    height: Math.round(height),
    fx: scaleFx(layer.fx, factor),
  };

  // Per-type lengths. Anything expressed in document units has to move with
  // the board or the design stops being the same design at a new size.
  if (base.type === 'text') {
    return {
      ...base,
      fontSize: base.fontSize * factor,
      tracking: base.tracking * factor,
      strokeWidth: base.strokeWidth === undefined ? undefined : base.strokeWidth * factor,
    };
  }
  if (base.type === 'shape') {
    return {
      ...base,
      strokeWidth: base.strokeWidth === undefined ? undefined : base.strokeWidth * factor,
      cornerRadius: base.cornerRadius === undefined ? undefined : base.cornerRadius * factor,
    };
  }
  if (base.type === 'image') {
    // `scale`, `offsetX` and `offsetY` are fractions of the frame, so they
    // survive a resize untouched; only the corner radius is a real length.
    return { ...base, radius: base.radius === undefined ? undefined : base.radius * factor };
  }
  if (base.type === 'waveform') {
    return { ...base, strokeWidth: base.strokeWidth * factor };
  }
  return base;
}

/**
 * Resize the artboard.
 *
 * The scale factor is the smaller of the two axis ratios, so a composition
 * always FITS the new board rather than being cropped by it — going from square
 * to 16:9 leaves margin at the sides instead of losing the top and bottom of
 * the title.
 */
export function resizeArtboard(
  document: ArtworkDocument,
  width: number,
  height: number,
  mode: ArtboardResizeMode = 'scale',
): ArtworkDocument {
  const nextWidth = clampArtboardSize(width);
  const nextHeight = clampArtboardSize(height);
  if (nextWidth === document.width && nextHeight === document.height) return document;

  if (mode === 'keep') {
    return { ...document, width: nextWidth, height: nextHeight };
  }

  const factor = Math.min(nextWidth / document.width, nextHeight / document.height);
  return {
    ...document,
    width: nextWidth,
    height: nextHeight,
    layers: document.layers.map((layer) => scaleLayer(
      layer,
      factor,
      { width: document.width, height: document.height },
      { width: nextWidth, height: nextHeight },
    )),
  };
}
