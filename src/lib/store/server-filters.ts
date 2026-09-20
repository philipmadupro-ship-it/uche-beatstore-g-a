/**
 * The three `/store` filters that used to run only in the browser.
 *
 * BPM, price and favourites were applied client-side over `tracks` — which
 * holds only the pages fetched so far, not the catalogue. So a BPM filter on a
 * 600-beat store searched the first 60 beats and confidently returned "3
 * results", while the facet sidebar advertised the tempo range of all 600
 * because `/api/store/facets` computes over the whole catalogue. Wrong
 * answers, with no indication anything was missing.
 *
 * Moving them to the server means expressing them as PostgREST predicates,
 * which is fiddly enough to be worth isolating and testing:
 *
 *   - A comma inside an interpolated `.or()` value is read as a condition
 *     separator, so every number that reaches one of these strings is
 *     validated as finite first and every id is checked against a UUID shape.
 *   - The browser's semantics have to be reproduced exactly, or moving the
 *     filter changes which beats a buyer sees. The two that matter: a track
 *     with **no BPM is kept** by a BPM filter, and a price of null means
 *     "inherit the producer's default" rather than free (migration 021).
 */

/** A validated, ordered numeric range. */
export interface NumericRange {
  min: number;
  max: number;
}

/** Widest BPM either bound may take; anything outside is not a tempo. */
const BPM_FLOOR = 0;
const BPM_CEILING = 1000;

/** Prices are dollars; the ceiling only exists to reject nonsense. */
const PRICE_FLOOR = 0;
const PRICE_CEILING = 1_000_000;

function parseRange(
  rawMin: string | null,
  rawMax: string | null,
  floor: number,
  ceiling: number,
): NumericRange | null {
  if (rawMin == null && rawMax == null) return null;

  const read = (raw: string | null, fallback: number): number | null => {
    if (raw == null || raw.trim() === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(Math.max(n, floor), ceiling);
  };

  const min = read(rawMin, floor);
  const max = read(rawMax, ceiling);
  if (min == null || max == null) return null;
  // A reversed range is a caller mistake, not an empty result set.
  return min <= max ? { min, max } : { min: max, max: min };
}

/** `?bpmMin=&bpmMax=` → a range, or null when neither was given or either was junk. */
export function parseBpmRange(rawMin: string | null, rawMax: string | null): NumericRange | null {
  const range = parseRange(rawMin, rawMax, BPM_FLOOR, BPM_CEILING);
  // A range covering everything is the same as no filter, and skipping it
  // keeps the query simpler for the common case.
  if (range && range.min <= BPM_FLOOR && range.max >= BPM_CEILING) return null;
  return range;
}

/** `?priceMin=&priceMax=` → a range, or null. */
export function parsePriceRange(rawMin: string | null, rawMax: string | null): NumericRange | null {
  return parseRange(rawMin, rawMax, PRICE_FLOOR, PRICE_CEILING);
}

/**
 * The `.or()` expression for a BPM range.
 *
 * `bpm.is.null` is the first arm on purpose: the browser filter reads
 * `if (t.bpm != null && out of range) return false`, so a track whose tempo was
 * never detected passes. Dropping that arm would quietly hide every
 * un-analysed beat the moment a buyer touched the tempo slider.
 */
export function bpmFilterExpression(range: NumericRange): string {
  return `bpm.is.null,and(bpm.gte.${range.min},bpm.lte.${range.max})`;
}

/**
 * The `.or()` expression for a lease-price range.
 *
 * A null `lease_price_usd` means "use the producer's profile default"
 * (migration 021), so whether nulls belong in the result depends on a value
 * that isn't in the row. The default is resolved here instead: if it falls in
 * the range, nulls are included; if it doesn't — or there isn't one — they are
 * not. `gt.0` reproduces the browser's rule that a zero or absent effective
 * price is not a price a buyer could pay, so it never matches a range.
 */
export function priceFilterExpression(
  range: NumericRange,
  defaultLeasePrice: number | null | undefined,
  options: { defaultUnknown?: boolean } = {},
): string {
  const priced = `and(lease_price_usd.gt.0,lease_price_usd.gte.${range.min},lease_price_usd.lte.${range.max})`;
  const withNulls = `lease_price_usd.is.null,${priced}`;

  // If the default could not be read, be over-inclusive rather than
  // under-inclusive. The browser runs the same filter again with the real
  // default, so an extra row is narrowed away a moment later — whereas a row
  // wrongly excluded here never reaches the page at all, and the buyer has no
  // way to tell it is missing.
  if (options.defaultUnknown) return withNulls;

  const fallback = defaultLeasePrice == null ? null : Number(defaultLeasePrice);
  const fallbackQualifies =
    fallback != null &&
    Number.isFinite(fallback) &&
    fallback > 0 &&
    fallback >= range.min &&
    fallback <= range.max;

  return fallbackQualifies ? withNulls : priced;
}

/**
 * A plausible track id: the UUIDs production uses, and the readable ids
 * fixtures and the local-store dev mode use. Deliberately a shape check rather
 * than a UUID check — these ids only ever reach `.in('id', …)`, which encodes
 * its values, so pinning the format would buy no safety and would silently
 * drop every id outside production's own convention.
 */
const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** How many ids a client may pin a request to, so the URL stays sane. */
export const MAX_PINNED_IDS = 200;

/**
 * `?ids=` — the buyer's wishlist, which lives in their own browser and so can
 * only reach the server by being sent. Anything malformed is dropped rather
 * than rejected: a stale localStorage entry should not 400 the whole
 * catalogue.
 */
export function parseTrackIds(raw: string | null): string[] | null {
  if (raw == null) return null;
  const ids = raw
    .split(',')
    .map((x) => x.trim())
    .filter((x) => TRACK_ID_RE.test(x));
  const unique = [...new Set(ids)];
  // An empty list is meaningful — "only my favourites" with none saved matches
  // nothing — and must not be confused with the filter being absent.
  return unique.slice(0, MAX_PINNED_IDS);
}

/**
 * Whether a track's effective lease price falls in range, for the local-store
 * path (which filters rows in JS rather than building a query).
 */
export function priceInRange(
  leasePrice: number | null | undefined,
  defaultLeasePrice: number | null | undefined,
  range: NumericRange,
): boolean {
  const raw = leasePrice ?? defaultLeasePrice ?? null;
  const price = raw != null && Number(raw) > 0 ? Number(raw) : null;
  if (price == null) return false;
  return price >= range.min && price <= range.max;
}

/** Whether a track's BPM falls in range, keeping tracks that have none. */
export function bpmInRange(bpm: number | null | undefined, range: NumericRange): boolean {
  if (bpm == null) return true;
  return bpm >= range.min && bpm <= range.max;
}
