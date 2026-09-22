/**
 * One definition of "popular", for every surface that sorts by it.
 *
 * There used to be three, under one label:
 *   - the browser scored `play_count * 10 + rating * 100`, tie-broken by title
 *     (`lib/store/filters.ts`);
 *   - the Supabase path ordered by `rating`, then `created_at`
 *     (`api/store/route.ts`);
 *   - the local-store path ordered by `rating` alone.
 *
 * So a buyer paging through a catalogue got an order that was none of them:
 * `/api/store` picks and orders the PAGE in SQL, and only afterwards attaches
 * play counts to the rows it already chose. The browser then re-ranked inside
 * that page using a signal the page boundary knew nothing about — shuffling
 * rows that rating had already selected, while the genuinely most-played beat
 * on page four stayed on page four.
 *
 * ## What this fixes, and what it does not
 *
 * Fixed: there is now ONE rule, written once. A beat that outranks another in
 * the browser outranks it in the no-database path too, and the SQL ordering
 * applies the same keys in the same direction rather than a different subset.
 *
 * NOT fixed: play count still cannot reach the SQL ordering. Play counts live
 * in `store_play_counts`, a VIEW (migration 102) over `store_events`, not a
 * column on `tracks` — Postgres cannot order a paginated `tracks` query by it
 * without a join PostgREST will not express, and reading every play count
 * before paginating would undo server-side pagination, which
 * `catalog-scale.test.ts` holds to 500ms and 256KB over 600 tracks.
 *
 * So on a catalogue that fits in one page, "popular" means plays and this rule
 * decides it outright. On a larger one, SQL picks the page by rating and this
 * rule orders WITHIN it — a viral beat on page four still does not climb to
 * page one. That is a smaller lie than three rules disagreeing, and it is
 * written down here rather than discovered.
 *
 * The complete fix is to denormalise the count onto `tracks` (a column, plus
 * something keeping it current), after which `POPULAR_ORDER_COLUMNS` gains
 * `play_count` as its first key and every call site follows automatically —
 * which is the point of the rule living here instead of in three places.
 */

/**
 * The fields the ordering reads. Deliberately minimal, and deliberately loose
 * about `rating`: the no-database local store round-trips through JSON, where
 * a rating can come back as a string. Coercing here is what lets the same
 * comparator serve both paths instead of one of them needing its own copy.
 */
export interface PopularityRanked {
  id?: string | null;
  rating?: number | string | null;
  created_at?: string | null;
  /** From the `store_play_counts` view; absent on surfaces that never read it. */
  play_count?: number | string | null;
}

const numberOf = (v: number | string | null | undefined) =>
  v == null ? 0 : Number(v) || 0;

const ratingOf = (t: PopularityRanked) => numberOf(t.rating);

/**
 * Plays weigh ten, a rating point a hundred. So a beat needs ten plays to
 * match one rating star — enough that a genuinely viral track outranks a
 * well-rated one nobody has listened to, without a handful of plays
 * overturning a deliberate rating. These are the weights the storefront
 * already shipped with; they are kept rather than re-invented.
 */
const scoreOf = (t: PopularityRanked) => numberOf(t.play_count) * 10 + ratingOf(t) * 100;

const createdAtOf = (t: PopularityRanked) => {
  if (!t.created_at) return 0;
  const ms = new Date(t.created_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * Most popular first — plays and rating combined; ties broken by newest, then
 * by id.
 *
 * The id tiebreak is not cosmetic. Without a total order, two equally rated
 * beats uploaded in the same second can swap places between requests, and a
 * row then appears on two pages or on none as the offset moves past it.
 * `orderPopularColumns` applies the same three keys in SQL for that reason.
 */
export function comparePopularity(a: PopularityRanked, b: PopularityRanked): number {
  const byScore = scoreOf(b) - scoreOf(a);
  if (byScore !== 0) return byScore;

  const byRecency = createdAtOf(b) - createdAtOf(a);
  if (byRecency !== 0) return byRecency;

  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

/**
 * The ordering as PostgREST `.order()` arguments, in the order they must be
 * applied — the closest SQL can get to `comparePopularity` while play count
 * lives in a view. Exported as data so a test can hold the two to the same
 * keys rather than letting them merely look similar.
 */
export const POPULAR_ORDER_COLUMNS = [
  { column: 'rating', ascending: false, nullsFirst: false },
  { column: 'created_at', ascending: false, nullsFirst: false },
  { column: 'id', ascending: true, nullsFirst: false },
] as const;
