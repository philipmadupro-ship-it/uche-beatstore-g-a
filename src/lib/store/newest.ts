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

/**
 * "Featured": the producer's own arrangement, and the storefront default.
 *
 * The Store Editor's drag / arrow reorder writes `store_sort_order`, and until
 * this existed nothing on `/store` honoured it — the page was chosen by one
 * rule and displayed by another, so the arrangement changed neither.
 *
 * A beat with NO position (listed after the last reorder) comes FIRST, newest
 * first. That is deliberate: sorting it last is exactly what hid new uploads
 * off page one (STORE-03). The producer places it by dragging it in the
 * editor, which numbers every listed beat. Positioned beats follow in the
 * producer's order; `created_at` then `id` keep the order total for paging.
 */
export interface FeaturedRanked extends NewestRanked {
  store_sort_order?: number | string | null;
}

const positionOf = (t: FeaturedRanked): number | null => {
  if (t.store_sort_order == null || t.store_sort_order === '') return null;
  const n = Number(t.store_sort_order);
  return Number.isFinite(n) ? n : null;
};

export function compareFeatured(a: FeaturedRanked, b: FeaturedRanked): number {
  const pa = positionOf(a);
  const pb = positionOf(b);
  if (pa == null && pb != null) return -1;
  if (pa != null && pb == null) return 1;
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  return compareNewest(a, b);
}

export const FEATURED_ORDER_COLUMNS = [
  { column: 'store_sort_order', ascending: true, nullsFirst: true },
  ...NEWEST_ORDER_COLUMNS,
] as const;
