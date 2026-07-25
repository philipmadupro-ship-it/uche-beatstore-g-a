import { describe, expect, it } from 'vitest';
import {
  addRecentStoreSearch,
  buildStoreSearchSuggestions,
  normalizeRecentStoreSearches,
} from './search-suggestions';
import type { StoreTrack } from './filters';

function track(overrides: Partial<StoreTrack>): StoreTrack {
  return {
    id: 't1',
    user_id: 'u1',
    title: 'Midnight Bounce',
    type: 'beat',
    audio_url: '',
    duration_seconds: 180,
    bpm: 140,
    key: 'C',
    scale: 'minor',
    stems_status: 'none',
    created_at: '2026-01-01T00:00:00Z',
    tags: [],
    ...overrides,
  } as StoreTrack;
}

describe('store search suggestions', () => {
  it('normalizes and deduplicates recent searches', () => {
    expect(normalizeRecentStoreSearches(['  Dark   Trap ', 'dark trap', '', 'Afro bounce'])).toEqual([
      'Dark Trap',
      'Afro bounce',
    ]);
    expect(addRecentStoreSearch(['Dark Trap', 'Afro bounce'], 'dark trap')).toEqual([
      'dark trap',
      'Afro bounce',
    ]);
  });

  it('prioritizes matching recent searches before catalogue suggestions', () => {
    const suggestions = buildStoreSearchSuggestions({
      query: 'dr',
      recentSearches: ['Drill loops'],
      tracks: [track({ title: 'Dream State' })],
      genres: ['Drill'],
      moods: [],
      keys: [],
    });

    expect(suggestions.map((item) => item.kind)).toEqual(['recent', 'track', 'genre']);
    expect(suggestions[0].value).toBe('Drill loops');
  });

  it('returns track, genre, mood, key, and tag suggestions without duplicates', () => {
    const suggestions = buildStoreSearchSuggestions({
      query: 'dark',
      recentSearches: [],
      tracks: [
        track({ id: 'a', title: 'Dark Matter', play_count: 3, tags: [{ tag: 'Dark', category: 'mood' }] }),
        track({ id: 'b', title: 'Dark Matter', play_count: 9, tags: [{ tag: 'Dark Piano', category: 'instrument' }] }),
      ],
      genres: ['Dark Trap'],
      moods: ['Dark'],
      keys: ['D'],
    });

    expect(suggestions.map((item) => `${item.kind}:${item.value}`)).toEqual([
      'track:Dark Matter',
      'genre:Dark Trap',
      'mood:Dark',
      'tag:Dark',
      'tag:Dark Piano',
    ]);
  });

  it('honors the suggestion limit', () => {
    const suggestions = buildStoreSearchSuggestions({
      query: '',
      recentSearches: ['one', 'two', 'three'],
      tracks: [track({ id: 'a', title: 'Alpha' })],
      genres: ['Trap'],
      moods: ['Hype'],
      keys: ['C'],
      limit: 2,
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((item) => item.value)).toEqual(['one', 'two']);
  });
});
