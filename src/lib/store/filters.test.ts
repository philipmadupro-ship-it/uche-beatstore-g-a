import { describe, it, expect } from 'vitest';
import { filterAndSortTracks, type StoreTrack, type FilterState } from './filters';

function makeTrack(overrides: Partial<StoreTrack> = {}): StoreTrack {
  return {
    id: 't1',
    user_id: 'u1',
    title: 'Test Beat',
    type: 'beat',
    audio_url: '',
    duration_seconds: 180,
    bpm: 140,
    key: 'C',
    scale: 'minor',
    stems_status: 'none',
    created_at: new Date().toISOString(),
    lease_price_usd: 30,
    exclusive_price_usd: 300,
    free_download_enabled: false,
    tags: [],
    ...overrides,
  } as StoreTrack;
}

const DEFAULT_FILTERS: FilterState = {
  searchQuery: '',
  typeFilter: 'all',
  freeOnly: false,
  favoritesOnly: false,
  newThisWeek: false,
  priceRangeActive: false,
  priceMin: 0,
  priceMax: 99999,
  bpmMin: 0,
  bpmMax: 999,
  keyFilter: '',
  scaleFilter: '',
  durationBucket: '',
  genreFilter: '',
  moodFilter: '',
  sortBy: 'newest',
  favoriteIds: new Set(),
  defaultLeasePrice: null,
};

describe('filterAndSortTracks', () => {
  it('returns all tracks when no filters are active', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })];
    expect(filterAndSortTracks(tracks, DEFAULT_FILTERS)).toHaveLength(2);
  });

  it('filters by scale (major/minor)', () => {
    const tracks = [
      makeTrack({ id: 'a', scale: 'major' }),
      makeTrack({ id: 'b', scale: 'minor' }),
      makeTrack({ id: 'c', scale: null }),
    ];
    const major = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, scaleFilter: 'major' });
    expect(major.map((t) => t.id)).toEqual(['a']);

    const minor = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, scaleFilter: 'minor' });
    expect(minor.map((t) => t.id)).toEqual(['b']);
  });

  it('filters by duration bucket', () => {
    const tracks = [
      makeTrack({ id: 'short', duration_seconds: 60 }),
      makeTrack({ id: 'medium', duration_seconds: 150 }),
      makeTrack({ id: 'long', duration_seconds: 300 }),
    ];
    expect(
      filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, durationBucket: 'short' }).map((t) => t.id),
    ).toEqual(['short']);
    expect(
      filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, durationBucket: 'medium' }).map((t) => t.id),
    ).toEqual(['medium']);
    expect(
      filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, durationBucket: 'long' }).map((t) => t.id),
    ).toEqual(['long']);
  });

  it('filters by price range using track-level override', () => {
    const tracks = [
      makeTrack({ id: 'cheap', lease_price_usd: 10 }),
      makeTrack({ id: 'mid', lease_price_usd: 50 }),
      makeTrack({ id: 'expensive', lease_price_usd: 200 }),
    ];
    const result = filterAndSortTracks(tracks, {
      ...DEFAULT_FILTERS,
      priceRangeActive: true,
      priceMin: 20,
      priceMax: 100,
    });
    expect(result.map((t) => t.id)).toEqual(['mid']);
  });

  it('falls back to defaultLeasePrice when track has no override', () => {
    const tracks = [
      makeTrack({ id: 'a', lease_price_usd: null }),
      makeTrack({ id: 'b', lease_price_usd: 200 }),
    ];
    const result = filterAndSortTracks(tracks, {
      ...DEFAULT_FILTERS,
      priceRangeActive: true,
      priceMin: 10,
      priceMax: 50,
      defaultLeasePrice: 30,
    });
    // 'a' falls back to default 30 (inside range), 'b' is 200 (outside)
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('sorts by popular (rating desc, then bpm, then title)', () => {
    const tracks = [
      makeTrack({ id: 'low', rating: 2, bpm: 100, title: 'Zebra' }),
      makeTrack({ id: 'high', rating: 5, bpm: 90, title: 'Apple' }),
      makeTrack({ id: 'mid', rating: 3, bpm: 120, title: 'Banana' }),
    ];
    const sorted = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, sortBy: 'popular' });
    expect(sorted.map((t) => t.id)).toEqual(['high', 'mid', 'low']);
  });

  it('popular sort tiebreaker is deterministic by title when score is equal', () => {
    const tracks = [
      makeTrack({ id: 'z', rating: 4, bpm: 100, title: 'Zebra' }),
      makeTrack({ id: 'a', rating: 4, bpm: 100, title: 'Apple' }),
      makeTrack({ id: 'm', rating: 4, bpm: 100, title: 'Mango' }),
    ];
    const sorted = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, sortBy: 'popular' });
    expect(sorted.map((t) => t.id)).toEqual(['a', 'm', 'z']);
  });

  it('popular sort places null ratings last but preserves title tiebreak among them', () => {
    const tracks = [
      makeTrack({ id: 'rated', rating: 3, bpm: 0, title: 'Zebra' }),
      makeTrack({ id: 'unrated-b', rating: null as any, bpm: 0, title: 'Banana' }),
      makeTrack({ id: 'unrated-a', rating: null as any, bpm: 0, title: 'Apple' }),
    ];
    const sorted = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, sortBy: 'popular' });
    expect(sorted.map((t) => t.id)).toEqual(['rated', 'unrated-a', 'unrated-b']);
  });

  it('sorts by price ascending', () => {
    const tracks = [
      makeTrack({ id: 'c', lease_price_usd: 100 }),
      makeTrack({ id: 'a', lease_price_usd: 10 }),
      makeTrack({ id: 'b', lease_price_usd: 50 }),
    ];
    const sorted = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, sortBy: 'price-asc' });
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by BPM descending', () => {
    const tracks = [
      makeTrack({ id: 'slow', bpm: 80 }),
      makeTrack({ id: 'fast', bpm: 160 }),
      makeTrack({ id: 'mid', bpm: 120 }),
    ];
    const sorted = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, sortBy: 'bpm-desc' });
    expect(sorted.map((t) => t.id)).toEqual(['fast', 'mid', 'slow']);
  });

  it('filters by genre tag', () => {
    const tracks = [
      makeTrack({ id: 'trap', tags: [{ tag: 'Trap', category: 'genre' }] }),
      makeTrack({ id: 'drill', tags: [{ tag: 'Drill', category: 'genre' }] }),
      makeTrack({ id: 'none', tags: [{ tag: 'Dark', category: 'mood' }] }),
    ];
    const result = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, genreFilter: 'trap' });
    expect(result.map((t) => t.id)).toEqual(['trap']);
  });

  it('filters by mood tag', () => {
    const tracks = [
      makeTrack({ id: 'dark', tags: [{ tag: 'Dark', category: 'mood' }] }),
      makeTrack({ id: 'chill', tags: [{ tag: 'Chill', category: 'mood' }] }),
    ];
    const result = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, moodFilter: 'chill' });
    expect(result.map((t) => t.id)).toEqual(['chill']);
  });

  it('filters by free download', () => {
    const tracks = [
      makeTrack({ id: 'free', free_download_enabled: true }),
      makeTrack({ id: 'paid', free_download_enabled: false }),
    ];
    const result = filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, freeOnly: true });
    expect(result.map((t) => t.id)).toEqual(['free']);
  });

  it('filters by favorites', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })];
    const result = filterAndSortTracks(tracks, {
      ...DEFAULT_FILTERS,
      favoritesOnly: true,
      favoriteIds: new Set(['b']),
    });
    expect(result.map((t) => t.id)).toEqual(['b']);
  });

  it('searches across title, key, bpm, description and tags', () => {
    const tracks = [
      makeTrack({ id: 'title', title: 'Summer Vibes' }),
      makeTrack({ id: 'key', key: 'F#m', title: 'X' }),
      makeTrack({ id: 'bpm', bpm: 128, title: 'X' }),
      makeTrack({ id: 'desc', description: 'Smooth jazz', title: 'X' }),
      makeTrack({ id: 'tag', tags: [{ tag: 'Lo-fi', category: 'genre' }], title: 'X' }),
    ];
    expect(filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, searchQuery: 'summer' }).map((t) => t.id)).toEqual(['title']);
    expect(filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, searchQuery: 'f#' }).map((t) => t.id)).toEqual(['key']);
    expect(filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, searchQuery: '128' }).map((t) => t.id)).toEqual(['bpm']);
    expect(filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, searchQuery: 'smooth' }).map((t) => t.id)).toEqual(['desc']);
    expect(filterAndSortTracks(tracks, { ...DEFAULT_FILTERS, searchQuery: 'lo-fi' }).map((t) => t.id)).toEqual(['tag']);
  });

  it('sorts newest by created_at descending', () => {
    const tracks = [
      makeTrack({ id: 'old', created_at: '2023-01-01T00:00:00Z' }),
      makeTrack({ id: 'new', created_at: '2024-01-01T00:00:00Z' }),
    ];
    const sorted = filterAndSortTracks(tracks, DEFAULT_FILTERS);
    expect(sorted.map((t) => t.id)).toEqual(['new', 'old']);
  });
});
