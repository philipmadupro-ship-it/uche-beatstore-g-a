/**
 * One definition of "Newest first", the storefront's default sort, for every
 * surface that applies it.
 *
 * ## Why this exists
 *
 * `/api/store` picks each 80-beat PAGE in SQL; the browser then re-sorts the
 * rows it was handed (`lib/store/filters.ts`). For "Newest first" those two
 * used different rules:
 *
 *   - SQL ordered by `store_sort_order ASC NULLS LAST`, then `created_at`;
 *   - the browser ordered by `created_at` alone.
 *
 * `store_sort_order` is written for every listed beat the moment the producer
 * reorders anything (Store Editor drag / arrows, the library's store reorder).
 * A beat uploaded and listed after that has `store_sort_order = NULL`, so SQL
 * put it after EVERY ordered beat. On a catalogue larger than one page it was
 * never on page one — the producer listed it, reloaded `/store`, and it was
 * not there. Scrolling to "Load more" found it, and the browser's re-sort then
 * threw it to the top, which is where "Newest first" said it belonged all
 * along.
 *
 * The browser re-sort also meant the manual order never decided what a buyer
 * SAW within a page; it only decided which beats made the page. So page
 * selection now uses the same rule the page is displayed by.
 *
 * The `id` key makes the order total, as in `lib/store/popularity`: two beats
 * created in the same instant must not swap between requests, or one shows up
 * on two pages or on none as the offset moves past it.
 */

export interface NewestRanked {
  id?: string | null;
  created_at?: string | null;
}

const createdAtOf = (t: NewestRanked) => {
  if (!t.created_at) return 0;
  const ms = new Date(t.created_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/** Newest first; ties broken by id ascending, matching `NEWEST_ORDER_COLUMNS`. */
export function compareNewest(a: NewestRanked, b: NewestRanked): number {
  const byRecency = createdAtOf(b) - createdAtOf(a);
  if (byRecency !== 0) return byRecency;
  const ai = String(a.id ?? '');
  const bi = String(b.id ?? '');
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * The same ordering as PostgREST `.order()` arguments, in application order.
 * Exported as data so a test can hold SQL and `compareNewest` to the same keys.
 */
export const NEWEST_ORDER_COLUMNS = [
  { column: 'created_at', ascending: false, nullsFirst: false },
  { column: 'id', ascending: true, nullsFirst: false },
] as const;
