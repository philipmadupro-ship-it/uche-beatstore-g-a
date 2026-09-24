/**
 * Star-rating filter for the library.
 *
 * `atLeast` is "4★ and up"; `exact` is "exactly 4★" — the mode a producer
 * wants when auditing one tier of the catalogue, e.g. every 4★ that should
 * become a 5★. Rating 0 in exact mode means "unrated", so the untriaged pile
 * is one click away too. Stored ratings of 0 and null both mean unrated.
 */
export type RatingMatch = 'atLeast' | 'exact';

export function matchesRating(
  trackRating: number | null | undefined,
  rating: number | null,
  mode: RatingMatch = 'atLeast',
): boolean {
  if (rating == null) return true;
  const r = trackRating ?? 0;
  return mode === 'exact' ? r === rating : r >= rating && r > 0;
}
