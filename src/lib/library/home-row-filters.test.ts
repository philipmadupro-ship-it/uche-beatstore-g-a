import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_ROWS } from '@/lib/dashboard/home-config';
import { matchesRating } from '@/lib/library/rating-filter';
import { triageStage, TRIAGE_STAGE_ORDER } from '@/lib/library/triage';
import type { LibraryFilters } from '@/components/library/FilterBar';
import { filtersForHomeRow } from './home-row-filters';
import { isLibrarySortMode, sortForHomeRow } from './sort-modes';

function empty(): LibraryFilters {
  return {
    types: new Set(),
    offlineOnly: false,
    genres: new Set(),
    statuses: new Set(),
    triage: new Set(),
    bpmMin: null,
    bpmMax: null,
    keys: new Set(),
    scale: 'all',
    rating: null,
    ratingMatch: 'atLeast',
  };
}

const row = (id: string) => {
  const cfg = DEFAULT_HOME_ROWS.find((r) => r.id === id);
  if (!cfg) throw new Error(`no default row ${id}`);
  return cfg.filter;
};

describe('filtersForHomeRow', () => {
  it('maps a status row onto the status facet', () => {
    expect([...filtersForHomeRow(row('wip'), empty()).statuses]).toEqual(['needs_work']);
    expect([...filtersForHomeRow(row('maq_ideas'), empty()).statuses]).toEqual(['maq']);
    expect([...filtersForHomeRow(row('finished_for_sale'), empty()).statuses]).toEqual(['finished']);
  });

  it('maps a genre row onto the genre facet', () => {
    expect([...filtersForHomeRow(row('genre_rnb'), empty()).genres]).toEqual(['R&B']);
  });

  it('maps "In your store" onto the Listed triage stage', () => {
    expect([...filtersForHomeRow(row('store'), empty()).triage]).toEqual(['listed']);
  });

  it('maps "Top rated" onto rating 4★ and up', () => {
    const f = filtersForHomeRow(row('top_rated'), { ...empty(), rating: 2, ratingMatch: 'exact' });
    expect(f.rating).toBe(4);
    expect(f.ratingMatch).toBe('atLeast');
  });

  it('maps notStoreListed onto every stage except Listed', () => {
    const f = filtersForHomeRow({ notStoreListed: true }, empty());
    expect(f.triage.has('listed')).toBe(false);
    expect(f.triage.size).toBe(TRIAGE_STAGE_ORDER.length - 1);
  });

  it('maps a single type and a multi-type row onto the types set', () => {
    expect([...filtersForHomeRow({ types: ['remix'] }, empty()).types]).toEqual(['remix']);
    expect([...filtersForHomeRow({ types: ['beat', 'song'] }, empty()).types].sort()).toEqual(['beat', 'song']);
  });

  it('a row with no types leaves the producer\'s type selection alone', () => {
    const current = { ...empty(), types: new Set(['remix' as const]) };
    expect([...filtersForHomeRow(row('wip'), current).types]).toEqual(['remix']);
  });

  it("the row's own criteria replace the same dimension of the current filters", () => {
    const current = { ...empty(), statuses: new Set(['finished']), genres: new Set(['Trap']) };
    const f = filtersForHomeRow(row('wip'), current);
    expect([...f.statuses]).toEqual(['needs_work']);
    // Untouched dimension carries over.
    expect([...f.genres]).toEqual(['Trap']);
  });

  it('keeps filters the row does not define', () => {
    const current = { ...empty(), bpmMin: 120, bpmMax: 150, scale: 'minor' as const, keys: new Set(['F']), offlineOnly: true };
    const f = filtersForHomeRow(row('genre_drill'), current);
    expect(f.bpmMin).toBe(120);
    expect(f.bpmMax).toBe(150);
    expect(f.scale).toBe('minor');
    expect([...f.keys]).toEqual(['F']);
    expect(f.offlineOnly).toBe(true);
  });

  it('a row with no criteria returns the current filters unchanged', () => {
    const current = { ...empty(), genres: new Set(['Trap']) };
    const f = filtersForHomeRow(undefined, current);
    expect(f).toEqual(current);
  });

  it('never shares a Set with the previous state', () => {
    const current = { ...empty(), genres: new Set(['Trap']), statuses: new Set(['maq']) };
    const f = filtersForHomeRow(row('store'), current);
    expect(f.genres).not.toBe(current.genres);
    expect(f.statuses).not.toBe(current.statuses);
    expect(f.triage).not.toBe(current.triage);
    f.genres.add('Drill');
    expect(current.genres.has('Drill')).toBe(false);
  });

  it('does not mutate its input', () => {
    const current = empty();
    filtersForHomeRow(row('wip'), current);
    expect(current.statuses.size).toBe(0);
  });

  /**
   * The point of the whole module: for every default row, the tracks the
   * translated filters select are exactly the tracks the row's own criteria
   * select. This re-states each side independently (row rules as the page's
   * applyTrackFilter writes them, filter rules as the page's `filtered` writes
   * them), so a new HomeRowFilter field that the translator forgets shows up
   * here as a mismatch.
   */
  describe('the translated filters select what the row selects', () => {
    const catalogue = [
      { id: 'a', status: 'maq', genres: ['Drill'], rating: 0, listed: false },
      { id: 'b', status: 'needs_work', genres: ['Trap'], rating: 3, listed: true },
      { id: 'c', status: 'finished', genres: ['R&B'], rating: 5, listed: true },
      { id: 'd', status: null, genres: ['Afrobeats'], rating: 4, listed: false },
      { id: 'e', status: 'archived', genres: ['Amapiano'], rating: null, listed: false },
      { id: 'f', status: 'finished', genres: [], rating: 4, listed: true },
      { id: 'g', status: null, genres: [], rating: null, listed: false },
    ] as const;

    const byRow = (f: NonNullable<ReturnType<typeof row>>) =>
      catalogue.filter((t) => {
        if (f.genres?.length && !f.genres.some((g) => (t.genres as readonly string[]).includes(g))) return false;
        if (f.statuses?.length && (!t.status || !f.statuses.includes(t.status as never))) return false;
        if (f.storeListed && !t.listed) return false;
        if (f.notStoreListed && t.listed) return false;
        if (f.minRating != null && (t.rating ?? 0) < f.minRating) return false;
        return true;
      }).map((t) => t.id);

    const byFilters = (f: LibraryFilters) =>
      catalogue.filter((t) => {
        if (f.statuses.size > 0 && (!t.status || !f.statuses.has(t.status))) return false;
        if (!matchesRating(t.rating, f.rating, f.ratingMatch)) return false;
        if (f.triage.size > 0 && !f.triage.has(triageStage({ store_listed: t.listed, bpm: 1, key: 'C', cover_url: 'x', lease_price_usd: 1, track_tags: [{ tag: 'g', category: 'genre' }] }))) return false;
        if (f.genres.size > 0 && !t.genres.some((g) => f.genres.has(g))) return false;
        return true;
      }).map((t) => t.id);

    for (const cfg of DEFAULT_HOME_ROWS.filter((r) => r.source === 'tracks')) {
      it(cfg.id, () => {
        expect(byFilters(filtersForHomeRow(cfg.filter, empty()))).toEqual(byRow(cfg.filter ?? {}));
      });
    }
  });
});

describe('sortForHomeRow', () => {
  it('maps every row ordering onto an All tracks sort', () => {
    expect(sortForHomeRow('newest')).toBe('recent');
    expect(sortForHomeRow('plays')).toBe('plays');
    expect(sortForHomeRow('rating')).toBe('rating');
    expect(sortForHomeRow('alphabetical')).toBe('title');
  });

  it('a row with no sortBy opens newest-first, as it rendered', () => {
    expect(sortForHomeRow(undefined)).toBe('recent');
  });

  it('every default row maps to a sort the dropdown offers', () => {
    for (const cfg of DEFAULT_HOME_ROWS) expect(isLibrarySortMode(sortForHomeRow(cfg.sortBy))).toBe(true);
  });
});
