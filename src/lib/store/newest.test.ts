import { describe, expect, it } from 'vitest';
import { NEWEST_ORDER_COLUMNS, compareNewest, type NewestRanked } from './newest';
import { filterAndSortTracks, type FilterState, type StoreTrack } from './filters';

/** Applies `.order()` column specs the way Postgres would, NULLS LAST. */
function sqlOrder(rows: NewestRanked[]) {
  return rows.slice().sort((a, b) => {
    for (const { column, ascending } of NEWEST_ORDER_COLUMNS) {
      const av = (a as Record<string, unknown>)[column] as string | null | undefined;
      const bv = (b as Record<string, unknown>)[column] as string | null | undefined;
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return ascending ? cmp : -cmp;
    }
    return 0;
  });
}

const rows: NewestRanked[] = [
  { id: 'b', created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'a', created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'c', created_at: '2026-09-27T10:00:00.000Z' },
  { id: 'd', created_at: '2025-06-01T00:00:00.000Z' },
];

describe('compareNewest', () => {
  it('orders newest first with a total id tie-break', () => {
    expect(rows.slice().sort(compareNewest).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('agrees with the SQL ordering the server pages by', () => {
    expect(rows.slice().sort(compareNewest)).toEqual(sqlOrder(rows));
  });

  it('never keys on store_sort_order', () => {
    expect(NEWEST_ORDER_COLUMNS.map((c) => c.column)).not.toContain('store_sort_order');
  });

  it('is the rule the browser displays "Newest first" by', () => {
    const tracks = [
      { id: 'old-arranged', title: 'Old', created_at: '2026-01-01T00:00:00.000Z', store_sort_order: 0 },
      { id: 'fresh', title: 'Fresh', created_at: '2026-09-27T10:00:00.000Z', store_sort_order: null },
    ] as unknown as StoreTrack[];
    const state: FilterState = {
      searchQuery: '', typeFilter: 'all', freeOnly: false, favoritesOnly: false,
      newThisWeek: false, priceRangeActive: false, priceMin: 0, priceMax: 99999,
      bpmMin: 0, bpmMax: 999, keyFilter: '', scaleFilter: '', durationBucket: '',
      genreFilter: '', moodFilter: '', sortBy: 'newest', favoriteIds: new Set(),
      defaultLeasePrice: null,
    };
    expect(filterAndSortTracks(tracks, state).map((t) => t.id)).toEqual(['fresh', 'old-arranged']);
  });
});
