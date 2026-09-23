import { describe, expect, it } from 'vitest';
import { loadMoreState } from './load-more';

describe('loadMoreState', () => {
  it('says how far through the catalogue you are', () => {
    const s = loadMoreState({ loaded: 150, total: 633, hasMore: true, filtersActive: false });
    expect(s.countLabel).toBe('150 of 633 tracks');
    expect(s.progress).toBeCloseTo(150 / 633);
    expect(s.remaining).toBe(483);
    expect(s.filtersPartial).toBe(false);
  });

  it('falls back to a plain count when the total is unknown', () => {
    const s = loadMoreState({ loaded: 50, total: null, hasMore: true, filtersActive: false });
    expect(s.countLabel).toBe('50 tracks');
    expect(s.progress).toBeNull();
    expect(s.remaining).toBeNull();
  });

  it('warns that filters are partial only while more tracks remain', () => {
    expect(loadMoreState({ loaded: 50, total: 633, hasMore: true, filtersActive: true }).filtersPartial).toBe(true);
    expect(loadMoreState({ loaded: 633, total: 633, hasMore: false, filtersActive: true }).filtersPartial).toBe(false);
  });

  it('never reports more loaded than the total', () => {
    const s = loadMoreState({ loaded: 700, total: 633, hasMore: false, filtersActive: false });
    expect(s.countLabel).toBe('700 of 700 tracks');
    expect(s.progress).toBe(1);
  });

  it('uses the singular for one track', () => {
    expect(loadMoreState({ loaded: 1, total: 1, hasMore: false, filtersActive: false }).countLabel).toBe('1 of 1 track');
  });
});
