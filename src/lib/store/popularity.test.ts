import { describe, expect, it } from 'vitest';

import {
  POPULAR_ORDER_COLUMNS,
  comparePopularity,
  type PopularityRanked,
} from './popularity';

const t = (over: Partial<PopularityRanked>): PopularityRanked => ({
  id: 'a',
  rating: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const order = (rows: PopularityRanked[]) =>
  [...rows].sort(comparePopularity).map((r) => r.id);

describe('comparePopularity', () => {
  it('lets a viral beat outrank a well-rated one nobody has played', () => {
    // The storefront's shipped intent, and the reason plays are in the rule at
    // all: ten plays are worth one rating star.
    expect(
      order([
        t({ id: 'viral', rating: 1, play_count: 200 }),
        t({ id: 'rated', rating: 5, play_count: 0 }),
        t({ id: 'mid', rating: 3, play_count: 10 }),
      ]),
    ).toEqual(['viral', 'rated', 'mid']);
  });

  it('does not let a handful of plays overturn a deliberate rating', () => {
    expect(
      order([
        t({ id: 'few-plays', rating: 3, play_count: 5 }),
        t({ id: 'rated', rating: 4, play_count: 0 }),
      ]),
    ).toEqual(['rated', 'few-plays']);
  });

  it('coerces a play count that arrived as a string', () => {
    expect(
      order([t({ id: 'many', play_count: '500' }), t({ id: 'none', play_count: null })]),
    ).toEqual(['many', 'none']);
  });

  it('puts the highest rated first', () => {
    expect(
      order([t({ id: 'low', rating: 1 }), t({ id: 'high', rating: 5 }), t({ id: 'mid', rating: 3 })]),
    ).toEqual(['high', 'mid', 'low']);
  });

  it('breaks a rating tie with the newer beat', () => {
    expect(
      order([
        t({ id: 'old', rating: 4, created_at: '2025-01-01T00:00:00Z' }),
        t({ id: 'new', rating: 4, created_at: '2026-06-01T00:00:00Z' }),
      ]),
    ).toEqual(['new', 'old']);
  });

  it('is a TOTAL order, so paging cannot drop or repeat a row', () => {
    // Two beats rated the same in the same second must not be free to swap
    // between requests: as the offset moves past them one would appear on two
    // pages, or on neither.
    const same = { rating: 4, created_at: '2026-01-01T00:00:00Z' };
    const forwards = order([t({ id: 'b', ...same }), t({ id: 'a', ...same })]);
    const backwards = order([t({ id: 'a', ...same }), t({ id: 'b', ...same })]);
    expect(forwards).toEqual(['a', 'b']);
    expect(backwards).toEqual(forwards);
  });

  it('treats a missing rating as zero rather than sorting it first', () => {
    expect(order([t({ id: 'none', rating: null }), t({ id: 'rated', rating: 1 })])).toEqual([
      'rated',
      'none',
    ]);
    expect(order([t({ id: 'undef', rating: undefined }), t({ id: 'rated', rating: 1 })])).toEqual([
      'rated',
      'undef',
    ]);
  });

  it('coerces a rating that arrived as a string from the local store', () => {
    expect(order([t({ id: 'two', rating: '2' }), t({ id: 'five', rating: '5' })])).toEqual([
      'five',
      'two',
    ]);
  });

  it('survives an unparseable date instead of ordering by NaN', () => {
    const rows = [
      t({ id: 'bad', rating: 4, created_at: 'not a date' }),
      t({ id: 'good', rating: 4, created_at: '2026-01-01T00:00:00Z' }),
    ];
    // NaN comparisons are all false, which would make the sort unstable and
    // platform-dependent. The bad date reads as epoch, so it simply sorts last.
    expect(order(rows)).toEqual(['good', 'bad']);
  });

  it('handles a missing created_at', () => {
    expect(
      order([t({ id: 'none', rating: 4, created_at: null }), t({ id: 'dated', rating: 4 })]),
    ).toEqual(['dated', 'none']);
  });
});

describe('POPULAR_ORDER_COLUMNS', () => {
  it('applies the keys SQL can reach, in the comparator\'s order', () => {
    // Exported as data so the SQL path cannot quietly drift into a different
    // meaning of "popular" than the JS one.
    //
    // `play_count` is deliberately absent: it lives in the `store_play_counts`
    // VIEW, not on `tracks`, so SQL cannot order a paginated query by it. When
    // it is denormalised onto `tracks`, it becomes the first key here and this
    // expectation is what will force the change to be deliberate.
    expect(POPULAR_ORDER_COLUMNS.map((c) => c.column)).toEqual(['rating', 'created_at', 'id']);
  });

  it('sorts rating and recency descending, and the id tiebreak ascending', () => {
    // Must match comparePopularity: b - a for the score and recency,
    // a.localeCompare(b) for the id.
    expect(POPULAR_ORDER_COLUMNS.map((c) => c.ascending)).toEqual([false, false, true]);
  });

  it('agrees with the comparator whenever no track has been played', () => {
    // On a catalogue with no play data the two orderings must be identical,
    // which is the guarantee that makes the SQL path a real approximation
    // rather than a second rule wearing the same name.
    const rows = [
      t({ id: 'c', rating: 2, created_at: '2026-01-03T00:00:00Z' }),
      t({ id: 'a', rating: 5, created_at: '2026-01-01T00:00:00Z' }),
      t({ id: 'b', rating: 2, created_at: '2026-01-09T00:00:00Z' }),
    ];
    const bySql = [...rows].sort(
      (x, y) =>
        Number(y.rating) - Number(x.rating) ||
        new Date(y.created_at!).getTime() - new Date(x.created_at!).getTime() ||
        String(x.id).localeCompare(String(y.id)),
    );
    expect(order(rows)).toEqual(bySql.map((r) => r.id));
  });

  it('never puts nulls first, matching the comparator treating them as zero', () => {
    expect(POPULAR_ORDER_COLUMNS.every((c) => c.nullsFirst === false)).toBe(true);
  });
});
