import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_FILTERS,
  activeShareFilterCount,
  buildShareFacets,
  filterAndSortShareTracks,
  matchesShareSearch,
  parseBpmBound,
  shareControlsVisibility,
  shareCountLabel,
  shareKeyLabel,
  type ShareListFilters,
  type ShareListTrack,
} from './track-list';

const t = (id: string, o: Partial<ShareListTrack> = {}): ShareListTrack => ({ id, title: id, ...o });
const f = (o: Partial<ShareListFilters> = {}): ShareListFilters => ({ ...DEFAULT_SHARE_FILTERS, ...o });
const ids = (xs: ShareListTrack[]) => xs.map((x) => x.id);

const set: ShareListTrack[] = [
  t('Night Shift', { bpm: 140, key: 'F', scale: 'minor', type: 'beat', created_at: '2026-03-01T00:00:00Z', tags: [{ tag: 'Dark', category: 'mood' }, { tag: 'Trap', category: 'genre' }] }),
  t('Cold Front', { bpm: 92, key: 'Bb', scale: 'major', type: 'beat', created_at: '2026-05-01T00:00:00Z', tags: [{ tag: 'Chill', category: 'mood' }, { tag: 'Lo-fi', category: 'genre' }] }),
  t('Loop 2', { bpm: 92, key: 'A#', scale: 'major', type: 'loop', created_at: '2026-04-01T00:00:00Z' }),
  t('Untitled 10', { bpm: null, key: null, type: 'beat' }),
  t('Untitled 9', { bpm: 150, key: 'C', scale: 'minor', type: 'beat', tags: [{ tag: 'Trap', category: 'genre' }] }),
];

describe('filterAndSortShareTracks', () => {
  it('returns the share order untouched by default', () => {
    expect(ids(filterAndSortShareTracks(set, f()))).toEqual(['Night Shift', 'Cold Front', 'Loop 2', 'Untitled 10', 'Untitled 9']);
  });

  it('does not mutate its input', () => {
    const copy = [...set];
    filterAndSortShareTracks(set, f({ sort: 'title' }));
    expect(set).toEqual(copy);
  });

  it('filters by genre and mood case-insensitively, by category', () => {
    expect(ids(filterAndSortShareTracks(set, f({ genre: 'trap' })))).toEqual(['Night Shift', 'Untitled 9']);
    expect(ids(filterAndSortShareTracks(set, f({ mood: 'CHILL' })))).toEqual(['Cold Front']);
    // A mood word is not a genre.
    expect(filterAndSortShareTracks(set, f({ genre: 'Dark' }))).toEqual([]);
  });

  it('treats Bb and A# as one key', () => {
    expect(ids(filterAndSortShareTracks(set, f({ key: 'A#' })))).toEqual(['Cold Front', 'Loop 2']);
    expect(shareKeyLabel({ key: 'Bb', scale: 'major' })).toBe('A#');
    expect(shareKeyLabel({ key: 'F#m' })).toBe('F#m');
    expect(shareKeyLabel({ key: null })).toBeNull();
  });

  it('BPM range keeps only tracks with a tempo in range', () => {
    expect(ids(filterAndSortShareTracks(set, f({ bpmMin: 90, bpmMax: 100 })))).toEqual(['Cold Front', 'Loop 2']);
    expect(ids(filterAndSortShareTracks(set, f({ bpmMin: 145 })))).toEqual(['Untitled 9']);
    expect(ids(filterAndSortShareTracks(set, f({ bpmMax: 100 })))).toEqual(['Cold Front', 'Loop 2']);
  });

  it('filters by type', () => {
    expect(ids(filterAndSortShareTracks(set, f({ type: 'loop' })))).toEqual(['Loop 2']);
  });

  it('search needs every word, across title, tags, key and BPM', () => {
    expect(ids(filterAndSortShareTracks(set, f({ search: 'night' })))).toEqual(['Night Shift']);
    expect(ids(filterAndSortShareTracks(set, f({ search: 'dark trap' })))).toEqual(['Night Shift']);
    expect(ids(filterAndSortShareTracks(set, f({ search: '92' })))).toEqual(['Cold Front', 'Loop 2']);
    expect(ids(filterAndSortShareTracks(set, f({ search: 'fm' })))).toEqual(['Night Shift']);
    expect(filterAndSortShareTracks(set, f({ search: 'dark chill' }))).toEqual([]);
    expect(matchesShareSearch(t('Café'), 'cafe')).toBe(true);
    expect(matchesShareSearch(t('x'), '   ')).toBe(true);
  });

  it('combines filters with AND', () => {
    expect(ids(filterAndSortShareTracks(set, f({ genre: 'trap', bpmMin: 145 })))).toEqual(['Untitled 9']);
  });

  it('sorts by BPM with missing tempos last in both directions, ties in share order', () => {
    expect(ids(filterAndSortShareTracks(set, f({ sort: 'bpm-asc' })))).toEqual(['Cold Front', 'Loop 2', 'Night Shift', 'Untitled 9', 'Untitled 10']);
    expect(ids(filterAndSortShareTracks(set, f({ sort: 'bpm-desc' })))).toEqual(['Untitled 9', 'Night Shift', 'Cold Front', 'Loop 2', 'Untitled 10']);
  });

  it('sorts by title naturally (9 before 10)', () => {
    expect(ids(filterAndSortShareTracks(set, f({ sort: 'title' })))).toEqual(['Cold Front', 'Loop 2', 'Night Shift', 'Untitled 9', 'Untitled 10']);
  });

  it('sorts newest first, undated last', () => {
    expect(ids(filterAndSortShareTracks(set, f({ sort: 'newest' })))).toEqual(['Cold Front', 'Loop 2', 'Night Shift', 'Untitled 10', 'Untitled 9']);
  });
});

describe('facets and visibility', () => {
  it('builds counted facets, merging key spellings', () => {
    const facets = buildShareFacets(set);
    expect(facets.genres).toEqual([{ value: 'Trap', count: 2 }, { value: 'Lo-fi', count: 1 }]);
    expect(facets.keys.find((k) => k.value === 'A#')?.count).toBe(2);
    expect(facets.types).toEqual([{ value: 'beat', count: 4 }, { value: 'loop', count: 1 }]);
    expect(facets.bpm).toEqual({ min: 92, max: 150 });
    expect(facets.hasDates).toBe(true);
  });

  it('shows no controls for a short share', () => {
    const v = shareControlsVisibility(3, buildShareFacets(set.slice(0, 3)));
    expect(v.any).toBe(false);
    expect(v.search || v.sort || v.genre || v.bpm).toBe(false);
  });

  it('hides facets that cannot narrow anything', () => {
    const many = Array.from({ length: 10 }, (_, i) => t(`b${i}`, { type: 'beat', bpm: 120, key: 'C', scale: 'major' }));
    const v = shareControlsVisibility(many.length, buildShareFacets(many));
    expect(v.any).toBe(true);
    expect(v.search && v.sort).toBe(true);
    expect(v.genre || v.mood || v.key || v.type || v.bpm).toBe(false);
  });

  it('offers type only when the share mixes types', () => {
    const many = Array.from({ length: 9 }, (_, i) => t(`b${i}`, { type: i === 0 ? 'loop' : 'beat' }));
    expect(shareControlsVisibility(9, buildShareFacets(many)).type).toBe(true);
  });
});

describe('helpers', () => {
  it('counts active filters but not the sort', () => {
    expect(activeShareFilterCount(f({ sort: 'title' }))).toBe(0);
    expect(activeShareFilterCount(f({ search: 'x', genre: 'Trap', bpmMin: 90 }))).toBe(3);
    expect(activeShareFilterCount(f({ search: '   ' }))).toBe(0);
  });

  it('parses BPM bounds', () => {
    expect(parseBpmBound('')).toBeNull();
    expect(parseBpmBound('abc')).toBeNull();
    expect(parseBpmBound('-4')).toBeNull();
    expect(parseBpmBound(' 140.4 ')).toBe(140);
  });

  it('words the count', () => {
    expect(shareCountLabel(50, 50)).toBe('50 tracks');
    expect(shareCountLabel(1, 1)).toBe('1 track');
    expect(shareCountLabel(12, 50)).toBe('12 of 50');
  });
});
