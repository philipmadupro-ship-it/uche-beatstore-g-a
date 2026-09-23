/**
 * Star-rating filtering for the library.
 *
 * Lived inline in the library page's filter memo as one line —
 * `t.rating == null || t.rating < filters.rating` — which could only ever
 * express "at least N stars". Asking for exactly the 4-star tracks, or for
 * the tracks nobody has rated yet (the triage question), was impossible.
 * Pulled out per the pure-logic-extract rule so the three modes are tested
 * and cannot be quietly reverted to the one.
 */

export type RatingMode = 'atLeast' | 'exactly';

/**
 * `rating` is the filter value: `null` = off, `0` = unrated only, 1–5 = stars.
 * `0` doubles as "unrated" because the rate API already stores a cleared
 * rating as null and treats 0 as "clear" — there is no such thing as a track
 * rated zero stars, so the value is free to mean "no rating".
 */
export function matchesRating(
  trackRating: number | null | undefined,
  rating: number | null,
  mode: RatingMode,
): boolean {
  if (rating == null) return true;
  const value = trackRating ?? 0;
  if (rating === 0) return value === 0;
  return mode === 'exactly' ? value === rating : value >= rating;
}

/** The chip text in the applied-filters row. */
export function ratingFilterLabel(rating: number | null, mode: RatingMode): string {
  if (rating == null) return '';
  if (rating === 0) return 'Unrated';
  if (rating === 5 || mode === 'exactly') return `★ ${rating}`;
  return `★ ${rating}+`;
}

/** Coerce a stored value, so a saved view from an older build stays valid. */
export function parseRatingMode(value: unknown): RatingMode {
  return value === 'exactly' ? 'exactly' : 'atLeast';
}

export function parseRatingValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 5 ? value : null;
}

/**
 * How a bulk rating settled, for the toast.
 *
 * Each track is a separate request (the rate endpoint also writes
 * `rating_history`), so a partial failure is a real outcome and the message
 * has to say which way it went rather than claiming success for all.
 */
export function bulkRatingMessage(value: number, total: number, failed: number): {
  tone: 'success' | 'warning' | 'error';
  text: string;
} {
  const noun = (n: number) => `${n} track${n === 1 ? '' : 's'}`;
  const what = value === 0 ? 'Cleared rating on' : `Rated ${value}★:`;
  if (failed === 0) return { tone: 'success', text: `${what} ${noun(total)}` };
  if (failed === total) return { tone: 'error', text: `Couldn't rate ${noun(total)}` };
  return { tone: 'warning', text: `${what} ${noun(total - failed)} — ${failed} failed` };
}
