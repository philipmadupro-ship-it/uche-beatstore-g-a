import { describe, expect, it } from 'vitest';

import {
  MAX_PINNED_IDS,
  bpmFilterExpression,
  bpmInRange,
  parseBpmRange,
  parsePriceRange,
  parseTrackIds,
  priceFilterExpression,
  priceInRange,
} from './server-filters';

describe('parseBpmRange', () => {
  it('is null when neither bound is given', () => {
    expect(parseBpmRange(null, null)).toBe(null);
  });

  it('fills in the open end', () => {
    expect(parseBpmRange('100', null)).toEqual({ min: 100, max: 1000 });
    expect(parseBpmRange(null, '140')).toEqual({ min: 0, max: 140 });
  });

  it('reads both bounds', () => {
    expect(parseBpmRange('100', '140')).toEqual({ min: 100, max: 140 });
  });

  it('treats a full-width range as no filter', () => {
    expect(parseBpmRange('0', '1000')).toBe(null);
  });

  it('orders a reversed range rather than matching nothing', () => {
    expect(parseBpmRange('140', '100')).toEqual({ min: 100, max: 140 });
  });

  it('clamps absurd bounds instead of trusting them', () => {
    expect(parseBpmRange('-50', '99999')).toBe(null); // clamps to full width
    expect(parseBpmRange('-50', '140')).toEqual({ min: 0, max: 140 });
  });

  it('rejects junk rather than coercing it', () => {
    expect(parseBpmRange('abc', '140')).toBe(null);
    expect(parseBpmRange('100', 'NaN')).toBe(null);
    expect(parseBpmRange('Infinity', null)).toBe(null);
  });
});

describe('bpmFilterExpression', () => {
  it('keeps tracks with no detected tempo', () => {
    // The browser filter passed a null bpm; the server must too, or touching
    // the tempo slider silently hides every un-analysed beat.
    expect(bpmFilterExpression({ min: 100, max: 140 })).toBe(
      'bpm.is.null,and(bpm.gte.100,bpm.lte.140)',
    );
  });

  it('emits no commas inside a value, which PostgREST would read as separators', () => {
    const expr = bpmFilterExpression({ min: 100, max: 140 });
    // Only the separators between conditions, never inside a number.
    expect(expr).not.toMatch(/\d,\d/);
  });
});

describe('parsePriceRange', () => {
  it('reads bounds and keeps a full-width range', () => {
    // Unlike BPM, a full-width price range still excludes unpriced tracks,
    // so it is not the same as no filter.
    expect(parsePriceRange('0', '1000000')).toEqual({ min: 0, max: 1000000 });
  });

  it('is null when neither bound is given', () => {
    expect(parsePriceRange(null, null)).toBe(null);
  });

  it('rejects junk', () => {
    expect(parsePriceRange('free', '50')).toBe(null);
  });
});

describe('priceFilterExpression', () => {
  const range = { min: 20, max: 60 };

  it('includes unpriced tracks when the profile default falls in range', () => {
    // A null price means "inherit the default" (migration 021), so whether
    // nulls belong depends on a value that is not in the row.
    expect(priceFilterExpression(range, 30)).toBe(
      'lease_price_usd.is.null,and(lease_price_usd.gt.0,lease_price_usd.gte.20,lease_price_usd.lte.60)',
    );
  });

  it('excludes unpriced tracks when the default falls outside', () => {
    expect(priceFilterExpression(range, 99)).toBe(
      'and(lease_price_usd.gt.0,lease_price_usd.gte.20,lease_price_usd.lte.60)',
    );
  });

  it('excludes unpriced tracks when there is no default at all', () => {
    expect(priceFilterExpression(range, null)).not.toContain('is.null');
    expect(priceFilterExpression(range, undefined)).not.toContain('is.null');
  });

  it('never treats a zero default as a price a buyer could pay', () => {
    // Blank is not free; zero is not a sellable price.
    expect(priceFilterExpression({ min: 0, max: 60 }, 0)).not.toContain('is.null');
  });

  it('is over-inclusive when the default could not be read', () => {
    // A row wrongly excluded here never reaches the page; an extra one is
    // narrowed away by the browser pass a moment later.
    expect(priceFilterExpression(range, null, { defaultUnknown: true })).toContain('is.null');
  });

  it('always requires a positive stored price', () => {
    expect(priceFilterExpression({ min: 0, max: 60 }, null)).toContain('lease_price_usd.gt.0');
  });
});

describe('parseTrackIds', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';

  it('is null when the parameter is absent', () => {
    expect(parseTrackIds(null)).toBe(null);
  });

  it('distinguishes "no favourites saved" from "no filter"', () => {
    // An empty wishlist must match nothing, not everything.
    expect(parseTrackIds('')).toEqual([]);
  });

  it('reads a list and de-duplicates it', () => {
    expect(parseTrackIds(`${a},${b},${a}`)).toEqual([a, b]);
  });

  it('drops malformed entries rather than failing the request', () => {
    // A stale localStorage entry should not 400 the whole catalogue.
    expect(parseTrackIds(`${a},'; drop table --,has space`)).toEqual([a]);
  });

  it('accepts the readable ids the local-store dev mode uses', () => {
    // Production ids are UUIDs, but fixtures and no-database mode are not, and
    // these only ever reach `.in('id', …)`.
    expect(parseTrackIds('scale-track-7,scale-track-450')).toEqual([
      'scale-track-7',
      'scale-track-450',
    ]);
  });

  it('caps the list so the URL stays sane', () => {
    const many = Array.from({ length: MAX_PINNED_IDS + 50 }, (_, i) =>
      `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    ).join(',');
    expect(parseTrackIds(many)).toHaveLength(MAX_PINNED_IDS);
  });
});

describe('local-store predicates match the query semantics', () => {
  it('keeps a track with no BPM', () => {
    expect(bpmInRange(null, { min: 100, max: 140 })).toBe(true);
    expect(bpmInRange(120, { min: 100, max: 140 })).toBe(true);
    expect(bpmInRange(90, { min: 100, max: 140 })).toBe(false);
  });

  it('falls back to the profile default for an unpriced track', () => {
    expect(priceInRange(null, 30, { min: 20, max: 60 })).toBe(true);
    expect(priceInRange(null, 99, { min: 20, max: 60 })).toBe(false);
  });

  it('treats a missing or zero effective price as unsellable', () => {
    expect(priceInRange(null, null, { min: 0, max: 60 })).toBe(false);
    expect(priceInRange(0, null, { min: 0, max: 60 })).toBe(false);
  });

  it('prefers the track price over the default', () => {
    expect(priceInRange(80, 30, { min: 20, max: 60 })).toBe(false);
  });
});
