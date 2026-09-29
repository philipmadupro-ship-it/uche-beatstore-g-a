/**
 * Loading the Store Editor's whole beat catalogue.
 *
 * The Beat Listing section used to fetch one 100-row page of `/api/tracks`
 * and stop, with a "Load next 100 beats" button for the rest. That page is
 * the 100 NEWEST beats, so on a larger catalogue:
 *
 * - listed beats older than the newest 100 were missing from the list,
 *   the attention filter and the storefront preview;
 * - reordering wrote `store_sort_order` 0..n for only the loaded listed
 *   beats, leaving every unloaded listed beat on its old position — the
 *   two sets then collided and /store showed an order nobody chose;
 * - search went to the server and replaced the list with the matches, so a
 *   drag while searching renumbered just those.
 *
 * The API keeps its 100-row ceiling per request (a server protection, not a
 * product rule); this walks every page instead of the first.
 */

/** `/api/tracks` clamps `limit` to this. */
export const TRACK_PAGE_SIZE = 100;

/** Safety stop: 200 × 100 = 20,000 beats. Hitting it reports `complete: false`. */
export const MAX_TRACK_PAGES = 200;

export type TrackPage<T> = {
  tracks?: T[] | null;
  pageInfo?: { hasMore?: boolean | null; nextCursor?: string | null } | null;
};

export type TrackCatalogue<T> = {
  tracks: T[];
  /** False when a page limit or a non-advancing cursor stopped the walk early. */
  complete: boolean;
};

/**
 * Follow `nextCursor` until the API says there is nothing more.
 *
 * Rows are de-duplicated by id (offset paging can repeat a row if the table
 * changes mid-walk). `onPage` receives the rows accumulated so far after each
 * page, so the list can fill progressively. A cursor that does not advance
 * stops the walk rather than looping forever.
 */
export async function fetchAllTrackPages<T extends { id: string }>(
  fetchPage: (cursor: string | null) => Promise<TrackPage<T>>,
  options: { maxPages?: number; onPage?: (rows: T[]) => void } = {},
): Promise<TrackCatalogue<T>> {
  const maxPages = options.maxPages ?? MAX_TRACK_PAGES;
  const rows: T[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await fetchPage(cursor);
    for (const row of data.tracks ?? []) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      rows.push(row);
    }
    options.onPage?.([...rows]);

    const next = data.pageInfo?.hasMore ? data.pageInfo.nextCursor ?? null : null;
    if (!next) return { tracks: rows, complete: true };
    if (seenCursors.has(next)) return { tracks: rows, complete: false };
    seenCursors.add(next);
    cursor = next;
  }
  return { tracks: rows, complete: false };
}

/**
 * `Promise.all(items.map(fn))` with at most `limit` in flight. Once every
 * listed beat is loaded, per-beat requests (license links) would otherwise
 * fire hundreds at once.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
