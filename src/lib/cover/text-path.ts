/**
 * Curves for text to sit on.
 *
 * Type on a path is the one typography feature that genuinely needs SVG rather
 * than CSS — there is no DOM equivalent of `<textPath>`. That would normally be
 * a problem here, because the studio draws every document twice and the canvas
 * half is DOM. The way out is the one the waveform layers already take: the
 * canvas renders an inline `<svg>` in document units for this layer type too,
 * so BOTH surfaces run the same `d` string through the same element. There is
 * no approximation to drift.
 *
 * Paths are generated in the layer's own coordinate space (0,0 to width,height)
 * so they scale with the layer for free and need no knowledge of zoom.
 *
 * Pure and tested, per the repo's pure-logic rule.
 */

export const textPathShapes = ['none', 'arc', 'circle', 'wave'] as const;

export type TextPathShape = (typeof textPathShapes)[number];

export type TextPathSettings = {
  shape: TextPathShape;
  /**
   * -1..1. Zero is flat, positive bulges up, negative sags down.
   *
   * Signed rather than a magnitude plus a direction flag: "curvature" is one
   * idea and a producer dragging a slider through zero expects the arc to flip
   * rather than to hit a wall and need a second control.
   */
  curvature: number;
};

export const defaultTextPath: TextPathSettings = { shape: 'none', curvature: 0.4 };

/** One place that decides what an unset path means, matching `imageCropDefaults`. */
export function textPathDefaults(path: Partial<TextPathSettings> | undefined | null): TextPathSettings {
  const shape = path?.shape && (textPathShapes as readonly string[]).includes(path.shape)
    ? path.shape
    : defaultTextPath.shape;
  const raw = typeof path?.curvature === 'number' && Number.isFinite(path.curvature)
    ? path.curvature
    : defaultTextPath.curvature;
  return { shape, curvature: Math.min(1, Math.max(-1, raw)) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The `d` attribute for a layer's text path, or null when the text is flat.
 *
 * Returning null rather than a straight line is deliberate: a flat `<textPath>`
 * still loses wrapping, `dominant-baseline` behaviour and multi-line support,
 * so "none" has to mean the ordinary text element, not a degenerate curve.
 */
export function textPathD(
  settings: TextPathSettings,
  width: number,
  height: number,
): string | null {
  const { shape, curvature } = textPathDefaults(settings);
  if (shape === 'none') return null;
  if (!(width > 0) || !(height > 0)) return null;

  if (shape === 'circle') {
    // A full circle, starting at the left and running clockwise. Inset by a
    // little so ascenders are not clipped by the layer's own bounds.
    const radius = Math.max(1, Math.min(width, height) / 2 - Math.min(width, height) * 0.06);
    const cx = width / 2;
    const cy = height / 2;
    // Two half-arcs: a single arc command cannot express 360 degrees, because
    // the start and end points would coincide and the renderer has no way to
    // tell a full turn from no turn at all.
    return `M ${round(cx - radius)} ${round(cy)}`
      + ` a ${round(radius)} ${round(radius)} 0 1 1 ${round(radius * 2)} 0`
      + ` a ${round(radius)} ${round(radius)} 0 1 1 ${round(-radius * 2)} 0`;
  }

  // Baseline sits low enough that a flat-ish arc still has room for descenders.
  const baseline = height * 0.72;
  // How far the curve departs from the baseline. Scaled off height so the shape
  // holds when the layer is resized.
  const rise = curvature * height * 0.55;

  if (shape === 'arc') {
    // Quadratic: the control point is twice the visual bulge, because a
    // quadratic curve reaches only halfway to its control point at the apex.
    return `M 0 ${round(baseline)} Q ${round(width / 2)} ${round(baseline - rise * 2)} ${round(width)} ${round(baseline)}`;
  }

  // Wave: two cubic segments meeting at the centre, one up one down.
  const quarter = width / 4;
  const mid = width / 2;
  return `M 0 ${round(baseline)}`
    + ` C ${round(quarter)} ${round(baseline - rise)}, ${round(quarter)} ${round(baseline - rise)}, ${round(mid)} ${round(baseline)}`
    + ` C ${round(mid + quarter)} ${round(baseline + rise)}, ${round(mid + quarter)} ${round(baseline + rise)}, ${round(width)} ${round(baseline)}`;
}

/**
 * Where along the path the text starts, and how it anchors there.
 *
 * `startOffset` and `text-anchor` have to agree or the text runs off the end:
 * anchoring at the middle while starting at 0% puts half the string before the
 * path begins, where nothing is drawn.
 */
export function textPathPlacement(align: 'left' | 'center' | 'right'): {
  startOffset: string;
  anchor: 'start' | 'middle' | 'end';
} {
  if (align === 'center') return { startOffset: '50%', anchor: 'middle' };
  if (align === 'right') return { startOffset: '100%', anchor: 'end' };
  return { startOffset: '0%', anchor: 'start' };
}

/**
 * Text on a path is a single run.
 *
 * SVG has no wrapping and `<textPath>` has no concept of lines, so a multi-line
 * string has to become one. Joining with a space is the honest reading of what
 * the producer typed; silently rendering only the first line would drop content
 * they can still see in the text field.
 */
export function flattenForPath(text: string): string {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
}

/** Does this layer draw its text along a curve? */
export function hasTextPath(path: Partial<TextPathSettings> | undefined | null): boolean {
  return textPathDefaults(path).shape !== 'none';
}
