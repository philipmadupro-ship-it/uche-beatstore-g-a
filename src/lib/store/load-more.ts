/**
 * "Load more" on the storefront: how pages accumulate, and when they stop.
 *
 * Two defects lived in the page component, which is why this is here.
 *
 * ## It grew without limit
 *
 * Each press appended another 80 beats to what was rendered, forever. Rows are
 * memoised now, which makes each one cheaper to re-render, but it does not
 * make there be fewer of them — every row is still a card with artwork, a
 * waveform and its own store subscriptions, and the DOM only ever grew.
 *
 * It stops at `MAX_ACCUMULATED_TRACKS`. Past that the page offers the filters
 * instead of another page, which is the better answer anyway: filters are
 * applied server-side across the whole catalogue now, so narrowing finds the
 * beat, while scrolling past four hundred cards almost never does.
 *
 * ## A stale page could land in the wrong results
 *
 * A load-more request captured the query it was issued for. Change a filter
 * while one was in flight and the page reset its accumulated rows for the new
 * query — then the old request resolved and appended the OLD filter's beats to
 * the new results, and overwrote the cursor with one from the wrong query. A
 * buyer who filtered to Trap could watch Afrobeats appear at the bottom.
 *
 * `isCurrentRequest` is the fix: a response is applied only if the query it
 * was asked for is still the query on screen.
 */

/** Five pages of 80. More than any buyer browses by scrolling. */
export const MAX_ACCUMULATED_TRACKS = 400;

export interface LoadedPage<T> {
  /** Everything accumulated so far, de-duplicated, never over the cap. */
  tracks: T[];
  /** True when the cap, not the catalogue, is what stopped growth. */
  capped: boolean;
}

/**
 * Append a newly loaded page to what is already showing.
 *
 * De-duplicates by id, because offset pagination over a catalogue that changes
 * underneath it — a beat listed or re-ordered between two requests — can hand
 * the same row back on two consecutive pages. Keeps first-seen order so rows
 * never jump. Truncates at the cap rather than refusing the page, so a page
 * that straddles the limit still fills up to it.
 */
export function mergeLoadedPage<T extends { id?: string | null }>(
  current: readonly T[],
  incoming: readonly T[],
  cap: number = MAX_ACCUMULATED_TRACKS,
): LoadedPage<T> {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const track of [...current, ...incoming]) {
    const id = track?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(track);
  }

  const capped = merged.length >= cap;
  return { tracks: capped ? merged.slice(0, cap) : merged, capped };
}

/**
 * Whether the page should offer another page.
 *
 * All three have to hold: the server says there is more, it gave a cursor to
 * fetch it with, and the cap has not been reached. A missing cursor with
 * `hasMore: true` is treated as "no more" rather than retried, since there is
 * nothing to ask for.
 */
export function canLoadMore(
  pageInfo: { hasMore: boolean; nextCursor: string | null },
  accumulated: number,
  cap: number = MAX_ACCUMULATED_TRACKS,
): boolean {
  return pageInfo.hasMore && pageInfo.nextCursor != null && accumulated < cap;
}

/**
 * Whether a response still belongs on screen.
 *
 * Compares the query string a request was issued for against the one showing
 * now. Only the current one may write — anything else is a stale answer to a
 * question the buyer has already changed.
 */
export function isCurrentRequest(issuedFor: string, current: string): boolean {
  return issuedFor === current;
}
