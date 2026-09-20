import { normalizeKey } from '@/lib/audio/key-normalize';
import { comparePopularity } from './popularity';
import type { Track } from '@/lib/types';

export interface StoreTrack extends Track {
  tags?: { tag: string; category?: string | null }[];
  /** Internal-only play count from store_plays (not displayed to buyers). Used for popular sort. */
  play_count?: number;
}

export type TypeFilter = 'all' | 'beat' | 'instrumental' | 'song' | 'remix' | 'beats';
export type DurationBucket = '' | 'short' | 'medium' | 'long';
export type SortBy =
  | 'newest'
  | 'popular'
  | 'bpm-asc'
  | 'bpm-desc'
  | 'price-asc'
  | 'price-desc'
  | 'title';

export interface FilterState {
  searchQuery: string;
  typeFilter: TypeFilter;
  freeOnly: boolean;
  favoritesOnly: boolean;
  newThisWeek: boolean;
  priceRangeActive: boolean;
  priceMin: number;
  priceMax: number;
  bpmMin: number;
  bpmMax: number;
  keyFilter: string;
  scaleFilter: '' | 'major' | 'minor';
  durationBucket: DurationBucket;
  genreFilter: string;
  moodFilter: string;
  sortBy: SortBy;
  favoriteIds: Set<string>;
  defaultLeasePrice: number | null | undefined;
}

/**
 * Pure filter + sort for the store track list.
 *
 * Extracted from the Store page useMemo so it can be unit-tested
 * independently and so future layout refactors can't silently drop
 * sidebar features (price, scale, duration, popular sort, etc.).
 */
export function filterAndSortTracks(
  tracks: StoreTrack[],
  filters: FilterState,
): StoreTrack[] {
  const q = filters.searchQuery.trim().toLowerCase();

  const result = tracks.filter((t) => {
    // Type
    if (filters.typeFilter === 'beats' && t.type !== 'beat' && t.type !== 'instrumental') {
      return false;
    }
    if (filters.typeFilter !== 'all' && filters.typeFilter !== 'beats' && t.type !== filters.typeFilter) {
      return false;
    }

    // Free only
    if (filters.freeOnly && !t.free_download_enabled) return false;

    // Favorites
    if (filters.favoritesOnly && !filters.favoriteIds.has(t.id)) return false;

    // New this week
    if (filters.newThisWeek) {
      const created = t.created_at ? new Date(t.created_at).getTime() : 0;
      if (Date.now() - created > 7 * 24 * 60 * 60 * 1000) return false;
    }

    // Price range
    if (filters.priceRangeActive) {
      const lp = t.lease_price_usd ?? filters.defaultLeasePrice ?? null;
      const p = lp != null && Number(lp) > 0 ? Number(lp) : null;
      if (p == null || p < filters.priceMin || p > filters.priceMax) return false;
    }

    // BPM
    if (t.bpm != null && (t.bpm < filters.bpmMin || t.bpm > filters.bpmMax)) return false;

    // Key and scale, compared through `lib/audio/key-normalize` rather than as
    // raw strings. Three things write `tracks.key` and they spell enharmonics
    // differently, so a straight comparison made every track stored as `Bb`
    // invisible to a filter for `A#` — and the facet sidebar offers both
    // spellings, because it lists the distinct values actually in the column.
    //
    // Normalising also picks up a scale written into the key itself (`F#m`),
    // which the old scale comparison against `t.scale` alone could not see.
    if (filters.keyFilter || filters.scaleFilter) {
      const track = normalizeKey(t.key, t.scale);

      if (filters.keyFilter) {
        const wanted = normalizeKey(filters.keyFilter);
        if (wanted.key) {
          if (track.key !== wanted.key) return false;
        } else if ((t.key ?? '').toLowerCase() !== filters.keyFilter.toLowerCase()) {
          // The filter value isn't readable as a key. Fall back to the literal
          // comparison so an odd stored value is still selectable by its own
          // facet entry rather than matching nothing at all.
          return false;
        }
      }

      if (filters.scaleFilter && track.scale !== filters.scaleFilter) return false;
    }

    // Duration bucket
    if (filters.durationBucket) {
      const d = t.duration_seconds ?? 0;
      if (filters.durationBucket === 'short' && d >= 120) return false;
      if (filters.durationBucket === 'medium' && (d < 120 || d > 240)) return false;
      if (filters.durationBucket === 'long' && d <= 240) return false;
    }

    // Genre tag
    if (filters.genreFilter) {
      const hasGenre = (t.tags ?? []).some(
        (tag) => tag.category === 'genre' && tag.tag.toLowerCase() === filters.genreFilter.toLowerCase(),
      );
      if (!hasGenre) return false;
    }

    // Mood tag
    if (filters.moodFilter) {
      const hasMood = (t.tags ?? []).some(
        (tag) => tag.category === 'mood' && tag.tag.toLowerCase() === filters.moodFilter.toLowerCase(),
      );
      if (!hasMood) return false;
    }

    // Search text
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      (t.key ?? '').toLowerCase().includes(q) ||
      String(t.bpm ?? '').includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      (t.tags ?? []).some((tag) => tag.tag.toLowerCase().includes(q))
    );
  });

  // Sort
  const priceOf = (t: StoreTrack) => {
    const lease = t.lease_price_usd ?? filters.defaultLeasePrice ?? null;
    return lease != null && Number(lease) > 0 ? Number(lease) : Infinity;
  };

  const sorted = [...result];
  switch (filters.sortBy) {
    case 'bpm-asc':
      sorted.sort((a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity));
      break;
    case 'bpm-desc':
      sorted.sort((a, b) => (b.bpm ?? -Infinity) - (a.bpm ?? -Infinity));
      break;
    case 'price-asc':
      sorted.sort((a, b) => priceOf(a) - priceOf(b));
      break;
    case 'price-desc':
      sorted.sort((a, b) => priceOf(b) - priceOf(a));
      break;
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'popular':
      // One rule, shared with both server paths — see lib/store/popularity.
      // This used to score `play_count * 10 + rating * 100` here, which the
      // server could not express, so re-ranking a server-ordered page
      // produced an order that was neither rule's.
      sorted.sort(comparePopularity);
      break;
    case 'newest':
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
      );
  }

  return sorted;
}
