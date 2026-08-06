/**
 * Crop geometry.
 *
 * The maths behind a pan-and-zoom cropper is the part that quietly goes wrong:
 * an off-by-one on the clamp lets the frame slide past the edge of the image
 * and the export picks up transparent pixels; a missing minimum-zoom lets a
 * portrait photo be cropped square with bars down the sides. Neither is
 * visible in the editor — both are visible in the exported cover.
 *
 * So the geometry lives here, pure, and the component only renders what it
 * returns.
 *
 * The model: the crop frame is FIXED (a square viewport), and the image moves
 * behind it. `scale` is relative to the size at which the image exactly covers
 * the frame, so `scale = 1` always means "just covers" regardless of the
 * source aspect. `offset` is the image centre relative to the frame centre, in
 * frame pixels.
 */

export interface Size { width: number; height: number }
export interface Offset { x: number; y: number }

export interface CropState {
  scale: number;
  offset: Offset;
}

export interface CropRect {
  /** Source-pixel rect to copy out of the original image. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The scale at which the image exactly covers a square frame.
 *
 * Everything else is expressed as a multiple of this, which is what makes
 * `scale >= 1` a sufficient guarantee that the frame is never underfilled.
 */
export function coverScale(image: Size, frame: number): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame / image.width, frame / image.height);
}

/** Rendered size of the image at a given zoom. */
export function renderedSize(image: Size, frame: number, scale: number): Size {
  const base = coverScale(image, frame);
  return {
    width: image.width * base * scale,
    height: image.height * base * scale,
  };
}

/**
 * Clamp the pan so the frame is always fully covered.
 *
 * Without this the image can be dragged past its own edge and the exported
 * crop contains transparent pixels — which then composite as black over the
 * gradient, and read as a corrupted upload rather than a mis-drag.
 */
export function clampOffset(image: Size, frame: number, scale: number, offset: Offset): Offset {
  const size = renderedSize(image, frame, scale);
  // How far the centre may move before an edge enters the frame.
  const maxX = Math.max(0, (size.width - frame) / 2);
  const maxY = Math.max(0, (size.height - frame) / 2);
  // `-0` normalised away: clamping a negative offset against a zero bound
  // yields it, and it then travels into CSS transforms and stored state where
  // it compares unequal to 0 for no useful reason.
  const noNegZero = (v: number) => (v === 0 ? 0 : v);
  return {
    x: noNegZero(Math.min(maxX, Math.max(-maxX, offset.x))),
    y: noNegZero(Math.min(maxY, Math.max(-maxY, offset.y))),
  };
}

/** Zoom is bounded: below 1 the frame underfills, far above it the crop is mush. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Convert the on-screen state into a source-pixel rect to copy.
 *
 * This is the step that has to agree exactly with what the editor showed. The
 * frame's top-left in rendered space is `(size - frame) / 2 - offset`; dividing
 * by the total rendered scale converts that back to source pixels.
 */
export function cropRect(image: Size, frame: number, state: CropState): CropRect {
  const scale = clampScale(state.scale);
  const offset = clampOffset(image, frame, scale, state.offset);
  const size = renderedSize(image, frame, scale);
  const totalScale = size.width / image.width;

  const left = ((size.width - frame) / 2 - offset.x) / totalScale;
  const top = ((size.height - frame) / 2 - offset.y) / totalScale;
  const side = frame / totalScale;

  // Clamp to the source bounds: floating point can push the rect a fraction of
  // a pixel outside, and canvas drawImage silently yields transparent there.
  const x = Math.max(0, Math.min(image.width - side, left));
  const y = Math.max(0, Math.min(image.height - side, top));

  return {
    x,
    y,
    width: Math.min(side, image.width),
    height: Math.min(side, image.height),
  };
}

/** Starting state: centred, just covering. */
export function initialCrop(): CropState {
  return { scale: 1, offset: { x: 0, y: 0 } };
}
