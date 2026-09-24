/**
 * Zoom maths shared by the two canvas editors (Store Editor, Cover Art Studio).
 *
 * Both used to own a linear range slider with a hardcoded ceiling — the cover
 * art one stopped at 60%, so a 3000px artboard could never be inspected at
 * actual size from the control on screen (only from a keyboard shortcut
 * nobody knew about). A linear slider is also wrong for zoom: 4%→10% is a
 * big visual jump squeezed into a sliver of travel while 150%→200% eats a
 * quarter of it. The slider here is logarithmic, and the +/- buttons walk a
 * fixed ladder of familiar stops, the way every design tool does it.
 */

export interface ZoomRange {
  min: number;
  max: number;
}

/** Familiar stops for the +/- buttons. */
export const ZOOM_STEPS = [0.02, 0.04, 0.06, 0.08, 0.1, 0.125, 0.167, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export function clampZoom(zoom: number, range: ZoomRange): number {
  if (!Number.isFinite(zoom)) return range.min;
  return Math.min(range.max, Math.max(range.min, zoom));
}

/**
 * Next stop on the ladder in `direction`, clamped to the range.
 *
 * Strictly greater / smaller than the current value (with a small tolerance),
 * so a zoom that sits between stops — which fit-to-window and wheel zoom
 * always produce — moves to the NEXT stop rather than snapping to the one it
 * is already nearly on and looking like the click did nothing.
 */
export function stepZoom(zoom: number, direction: 1 | -1, range: ZoomRange): number {
  const tolerance = 0.001;
  const stops = ZOOM_STEPS.filter((stop) => stop >= range.min && stop <= range.max);
  if (direction > 0) {
    const next = stops.find((stop) => stop > zoom + tolerance);
    return clampZoom(next ?? range.max, range);
  }
  const previous = [...stops].reverse().find((stop) => stop < zoom - tolerance);
  return clampZoom(previous ?? range.min, range);
}

/** Slider position (0–1000) for a zoom, on a log scale across the range. */
export function zoomToSlider(zoom: number, range: ZoomRange): number {
  const z = clampZoom(zoom, range);
  const span = Math.log(range.max) - Math.log(range.min);
  if (span <= 0) return 0;
  return Math.round(((Math.log(z) - Math.log(range.min)) / span) * 1000);
}

/** Inverse of `zoomToSlider`. */
export function sliderToZoom(position: number, range: ZoomRange): number {
  const t = Math.min(1000, Math.max(0, position)) / 1000;
  // Ends exact: exp(log(x)) drifts, and a slider parked at the far end should
  // read as the real maximum, not 199.99999%.
  if (t === 0) return range.min;
  if (t === 1) return range.max;
  const value = Math.exp(Math.log(range.min) + t * (Math.log(range.max) - Math.log(range.min)));
  return clampZoom(value, range);
}

/** "42%" — whole numbers above 10%, one decimal below so 4% and 4.5% differ. */
export function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${percent < 10 ? Math.round(percent * 10) / 10 : Math.round(percent)}%`;
}
