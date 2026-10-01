import { describe, expect, it } from 'vitest';
import type { LibraryFilters } from '@/components/library/FilterBar';
import { matchesLibraryFilters, type FilterableTrack } from './filter-tracks';

const none = (): LibraryFilters => ({
  types: new Set(), offlineOnly: false, genres: new Set(), statuses: new Set(), triage: new Set(),
  bpmMin: null, bpmMax: null, keys: new Set(), scale: 'all', rating: null, ratingMatch: 'atLeast',
});
const ctx = { cachedIds: new Set<string>(['cached']), hasDefaultPrice: true };
const track = (over: Partial<FilterableTrack> = {}): FilterableTrack => ({
  id: 't', type: 'beat', bpm: 140, key: 'F', scale: 'minor', status: 'finished', rating: 4,
  cover_url: 'x', store_listed: false, track_tags: [{ tag: 'Trap', category: 'genre' }], ...over,
});
const pass = (f: Partial<LibraryFilters>, t = track()) => matchesLibraryFilters(t, { ...none(), ...f }, ctx);

describe('matchesLibraryFilters', () => {
  it('no filters passes everything', () => expect(pass({})).toBe(true));

  it('types: any of the selected', () => {
    expect(pass({ types: new Set(['beat', 'song']) })).toBe(true);
    expect(pass({ types: new Set(['remix']) })).toBe(false);
    expect(pass({ types: new Set(['beat']) }, track({ type: null }))).toBe(false);
  });

  // The regression this module exists for: the Browse rows used to ignore all of these.
  it('bpm range, key, scale, rating, stage and offline each narrow', () => {
    expect(pass({ bpmMin: 150 })).toBe(false);
    expect(pass({ bpmMax: 130 })).toBe(false);
    expect(pass({ bpmMin: 120, bpmMax: 150 })).toBe(true);
    expect(pass({ bpmMin: 100 }, track({ bpm: null }))).toBe(false);
    expect(pass({ keys: new Set(['G']) })).toBe(false);
    expect(pass({ keys: new Set(['F']) })).toBe(true);
    expect(pass({ scale: 'major' })).toBe(false);
    expect(pass({ scale: 'minor' })).toBe(true);
    expect(pass({ rating: 5 })).toBe(false);
    expect(pass({ rating: 4 })).toBe(true);
    expect(pass({ rating: 4, ratingMatch: 'exact' }, track({ rating: 5 }))).toBe(false);
    expect(pass({ triage: new Set(['listed']) })).toBe(false);
    expect(pass({ triage: new Set(['listed']) }, track({ store_listed: true }))).toBe(true);
    expect(pass({ offlineOnly: true })).toBe(false);
    expect(pass({ offlineOnly: true }, track({ id: 'cached' }))).toBe(true);
  });

  it('statuses and genres', () => {
    expect(pass({ statuses: new Set(['maq']) })).toBe(false);
    expect(pass({ statuses: new Set(['finished', 'maq']) })).toBe(true);
    expect(pass({ statuses: new Set(['maq']) }, track({ status: null }))).toBe(false);
    expect(pass({ genres: new Set(['Drill']) })).toBe(false);
    expect(pass({ genres: new Set(['Drill', 'Trap']) })).toBe(true);
    // A mood tag named like a genre is not a genre.
    expect(pass({ genres: new Set(['Dark']) }, track({ track_tags: [{ tag: 'Dark', category: 'mood' }] }))).toBe(false);
  });

  it('a track with no default price reads as needs_price (stage filter uses the context)', () => {
    const bare = track({ lease_price_usd: null, exclusive_price_usd: null });
    const f = { ...none(), triage: new Set(['needs_price' as const]) };
    expect(matchesLibraryFilters(bare, f, { ...ctx, hasDefaultPrice: false })).toBe(true);
    expect(matchesLibraryFilters(bare, f, { ...ctx, hasDefaultPrice: true })).toBe(false);
  });
});
