/**
 * Tempo from tapping.
 *
 * Typing a BPM means knowing it. Tapping it along to whatever is playing is
 * how a producer finds one they don't, so the session control offers both.
 *
 * Kept pure and separate from the control that hosts it: this is arithmetic
 * over a list of timestamps, and arithmetic hidden inside a component is the
 * thing this codebase has silently reverted more than once.
 */

import { clampSessionBpm } from './session-match';

/**
 * Taps further apart than this start a new measurement rather than extending
 * the old one. Two seconds is 30 BPM — slower than anyone taps deliberately,
 * so a gap this long means the previous attempt was abandoned.
 */
export const TAP_RESET_MS = 2000;

/**
 * How many taps are averaged. Long enough to settle, short enough that
 * speeding up or slowing down is followed rather than averaged away.
 */
export const TAP_WINDOW = 6;

/**
 * Add a tap, dropping the history if the last one was too long ago.
 *
 * Returns a new array; the caller keeps it in a ref, because a tap that only
 * extends the window should not re-render anything.
 */
export function pushTap(taps: readonly number[], now: number): number[] {
  const last = taps[taps.length - 1];
  const continuing = last != null && now - last <= TAP_RESET_MS;
  const next = continuing ? [...taps, now] : [now];
  return next.slice(-TAP_WINDOW);
}

/**
 * The tempo those taps describe, or null before there are two of them.
 *
 * Averaged as total span over interval count, NOT as a running mean of the
 * gaps. They give the same answer for even tapping, but the span form is far
 * less sensitive to one early or late tap — which is most of them.
 */
export function tempoFromTaps(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;

  const span = taps[taps.length - 1] - taps[0];
  if (span <= 0) return null;

  const interval = span / (taps.length - 1);
  const bpm = 60000 / interval;
  if (!Number.isFinite(bpm) || bpm <= 0) return null;

  return clampSessionBpm(bpm);
}
