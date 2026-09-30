import { describe, expect, it } from 'vitest';
import { deserializeFilters, serializeFilters, type LibraryFilters } from '@/components/library/FilterBar';
import { decodeLibraryView, encodeLibraryView, hasLibraryViewParams, type LibraryViewState } from './view-state';

const base = (): LibraryViewState => ({ browse: 'sections', sort: 'recent', filters: deserializeFilters({}) });

describe('encodeLibraryView', () => {
  it('an untouched library has a clean URL', () => {
    expect(encodeLibraryView(base())).toBe('');
  });

  it('writes only what differs from the default', () => {
    const s = base();
    s.browse = 'all';
    s.sort = 'plays';
    s.filters.statuses = new Set(['needs_work']);
    const qs = encodeLibraryView(s);
    expect(new URLSearchParams(qs).getAll('status')).toEqual(['needs_work']);
    expect(qs).toContain('view=all');
    expect(qs).toContain('sort=plays');
    expect(qs).not.toContain('scale');
    expect(qs).not.toContain('rating');
  });

  it('repeats keys instead of delimiting, so a value may contain any character', () => {
    const s = base();
    s.filters.genres = new Set(['R&B', 'Lo-fi, chill']);
    expect(new URLSearchParams(encodeLibraryView(s)).getAll('genre')).toEqual(['R&B', 'Lo-fi, chill']);
  });
});

describe('decodeLibraryView', () => {
  it('empty query is the default state', () => {
    expect(decodeLibraryView('')).toEqual(base());
    expect(hasLibraryViewParams('')).toBe(false);
    expect(hasLibraryViewParams('?utm_source=x')).toBe(false);
  });

  it('round-trips every facet', () => {
    const filters: LibraryFilters = {
      types: new Set(['beat', 'remix']),
      offlineOnly: true,
      genres: new Set(['Trap', 'R&B']),
      statuses: new Set(['maq', 'finished']),
      triage: new Set(['listed', 'needs_price']),
      bpmMin: 120,
      bpmMax: 150,
      keys: new Set(['F', 'C#']),
      scale: 'minor',
      rating: 4,
      ratingMatch: 'exact',
    };
    const state: LibraryViewState = { browse: 'all', sort: 'rating', filters };
    const back = decodeLibraryView(encodeLibraryView(state));
    expect(back.browse).toBe('all');
    expect(back.sort).toBe('rating');
    expect(serializeFilters(back.filters)).toEqual(serializeFilters(filters));
  });

  it('round-trips a URL through the leading ? that location.search carries', () => {
    expect(decodeLibraryView('?view=all&status=maq').filters.statuses.has('maq')).toBe(true);
    expect(hasLibraryViewParams('?view=all')).toBe(true);
  });

  it('drops values the filters could never match instead of emptying the library', () => {
    const s = decodeLibraryView('?sort=nonsense&type=podcast&stage=bogus&status=deleted&scale=weird&bpmMin=abc&rating=NaN&view=whatever');
    expect(s).toEqual(base());
  });

  it('an unknown ratingMatch falls back to at-least', () => {
    expect(decodeLibraryView('?rating=3&ratingMatch=nope').filters.ratingMatch).toBe('atLeast');
  });
});

describe('legacy saved filters', () => {
  it('a smart playlist saved with a single `type` still narrows to it', () => {
    expect([...deserializeFilters({ type: 'beat' }).types]).toEqual(['beat']);
    expect([...deserializeFilters({ type: 'all' }).types]).toEqual([]);
  });

  it('reads the new `types` array, dropping unknowns', () => {
    expect([...deserializeFilters({ types: ['beat', 'nope', 'song'] }).types]).toEqual(['beat', 'song']);
  });
});
