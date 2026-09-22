/**
 * The row waveform, adapted from splicedd's `Waveform.tsx`.
 *
 * What is worth taking from it is how cheap it makes the moving part:
 *
 *   - One `<path>` in a FIXED viewBox with `preserveAspectRatio="none"`. The
 *     geometry is built once, in viewBox units, and the browser scales it to
 *     whatever box the row gives it — no measuring, no resize observer.
 *   - Playback progress costs no geometry at all. It is a two-stop gradient
 *     whose stops sit at the SAME offset, so the colour change is a hard edge,
 *     and moving that edge is a single attribute change per frame. The path
 *     is never rebuilt while a track plays.
 *
 * Downsampling is not done here. It goes through `resampleVisualPeaks`, which
 * takes the peak of each bucket — interpolating between samples would land
 * between transients and flatten the kick drum the eye is looking for.
 */

/** viewBox units. Arbitrary; `preserveAspectRatio="none"` maps them to the box. */
export const WAVEFORM_VIEW_WIDTH = 1000;
export const WAVEFORM_VIEW_HEIGHT = 200;

/** How far ←/→ (or ↑/↓) move the playhead on a focused waveform. */
export const WAVEFORM_SEEK_STEP = 0.05;

/**
 * A mirrored outline: along the top from left to right, back along the bottom
 * from right to left, then closed. Filled, that is the familiar waveform shape.
 *
 * Coordinates are fixed to one decimal place. The `d` string is part of every
 * row's markup; full float precision would roughly triple its size for a
 * difference no screen can show.
 */
export function waveformPath(
  peaks: readonly number[],
  width: number = WAVEFORM_VIEW_WIDTH,
  height: number = WAVEFORM_VIEW_HEIGHT,
): string {
  if (peaks.length === 0) return '';
  const mid = height / 2;
  const amp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)) * mid;

  // A single point would draw nothing visible; stretch it across the box.
  const points = peaks.length === 1 ? [peaks[0], peaks[0]] : peaks;
  const n = points.length - 1;
  const px = (i: number) => ((i / n) * width).toFixed(1);

  let d = `M 0 ${mid.toFixed(1)}`;
  for (let i = 0; i <= n; i += 1) d += ` L ${px(i)} ${(mid - amp(points[i])).toFixed(1)}`;
  for (let i = n; i >= 0; i -= 1) d += ` L ${px(i)} ${(mid + amp(points[i])).toFixed(1)}`;
  return `${d} Z`;
}

/** Where along the waveform a pointer landed, as a 0–1 fraction. */
export function fractionFromPointer(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width));
}

/**
 * Seconds to seek to, for a fraction of the track.
 *
 * Prefers the media element's own duration, but falls back to the duration
 * already stored on the track. The fallback is what makes clicking the
 * waveform of a track that is NOT playing work at all: that click loads the
 * track and seeks in the same moment, when the element has no metadata yet and
 * reports `NaN`. The engine used to see that, drop the seek, and start from
 * zero. Setting `currentTime` before metadata arrives is defined behaviour — it
 * becomes the default start position — so a known duration is all it needs.
 * splicedd hit the same problem and solved it the same way.
 *
 * Null when neither duration is usable: better to not seek than to seek to a
 * guess.
 */
export function seekSeconds(
  fraction: number,
  mediaDuration: number,
  knownDuration: number | null | undefined,
): number | null {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const duration =
    Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : knownDuration != null && Number.isFinite(knownDuration) && knownDuration > 0
        ? knownDuration
        : null;
  return duration == null ? null : f * duration;
}

/**
 * An id usable inside `url(#…)`.
 *
 * `useId` returns strings like `:r0:` (React 18) or `«r0»` (React 19), and
 * neither colons nor guillemets are valid in an SVG fragment reference — the
 * gradient silently fails to resolve and the waveform renders with no fill.
 */
export function svgSafeId(id: string): string {
  return `wf-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
}
