/**
 * Which BPM / lease-price bounds the storefront should send to /api/store.
 *
 * A bound is omitted when it filters nothing: either it is still the page's
 * "untouched" sentinel, or it sits at (or beyond) the catalogue's own edge as
 * reported by /api/store/facets. The second case matters because /store
 * initialises its sliders to the catalogue range once tracks load; sending
 * those values changed the query key and re-fetched an identical catalogue on
 * every visit.
 *
 * `bounds` must be catalogue-wide (the facets endpoint), never derived from a
 * loaded page — a page's range is narrower than the catalogue, and treating it
 * as the edge would silently drop a real filter.
 */
export const BPM_SENTINEL = { min: 0, max: 999 } as const;
export const PRICE_SENTINEL = { min: 0, max: 99999 } as const;

export type NumericRange = { min: number; max: number };

export type RangeQueryInput = {
  bpmMin: number;
  bpmMax: number;
  priceMin: number;
  priceMax: number;
};

export type RangeParam = 'bpmMin' | 'bpmMax' | 'priceMin' | 'priceMax';

export type RangeQueryBounds = {
  bpm?: NumericRange | null;
  price?: NumericRange | null;
};

export function rangeQueryParams(
  values: RangeQueryInput,
  bounds: RangeQueryBounds = {},
): Partial<Record<RangeParam, string>> {
  const out: Partial<Record<RangeParam, string>> = {};
  const lower = (v: number, sentinel: number, edge: number | undefined) =>
    v !== sentinel && !(edge != null && v <= edge);
  const upper = (v: number, sentinel: number, edge: number | undefined) =>
    v !== sentinel && !(edge != null && v >= edge);

  if (lower(values.bpmMin, BPM_SENTINEL.min, bounds.bpm?.min)) out.bpmMin = String(values.bpmMin);
  if (upper(values.bpmMax, BPM_SENTINEL.max, bounds.bpm?.max)) out.bpmMax = String(values.bpmMax);
  if (lower(values.priceMin, PRICE_SENTINEL.min, bounds.price?.min)) out.priceMin = String(values.priceMin);
  if (upper(values.priceMax, PRICE_SENTINEL.max, bounds.price?.max)) out.priceMax = String(values.priceMax);
  return out;
}
