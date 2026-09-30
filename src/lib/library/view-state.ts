/**
 * The Library's view state as a URL query string.
 *
 * Browse-vs-All-tracks, the Filters menu and the sort used to live only in
 * component state, so a refresh, a shared link or Back from a track page landed
 * on unfiltered Browse — and "See all → WIP" could not be bookmarked. This is the
 * codec between that state and `?view=all&status=needs_work&sort=rating`.
 *
 * Rules:
 * - Only what differs from the default is written, so an untouched library has a
 *   clean URL, and a default is never distinguishable from "absent".
 * - Multi-value facets repeat the key (`genre=Trap&genre=R%26B`), so no value
 *   needs a delimiter it might itself contain.
 * - Decoding validates. A hand-edited or stale URL must never smuggle in a value
 *   the filters can never match (which would render an empty library): unknown
 *   types/stages/sorts/statuses are dropped, numbers must be finite.
 * - Search text and the page number are deliberately not here: search is
 *   transient, and the page resets whenever a filter changes.
 *
 * Pure by design (CLAUDE.md: logic inside the component gets silently reverted).
 */

import {
  DEFAULT_FILTERS,
  deserializeFilters,
  serializeFilters,
  type LibraryFilters,
} from '@/components/library/FilterBar';
import {
  DEFAULT_LIBRARY_SORT,
  isLibrarySortMode,
  type LibrarySortMode,
} from '@/lib/library/sort-modes';

export type LibraryBrowseMode = 'sections' | 'all';

export interface LibraryViewState {
  browse: LibraryBrowseMode;
  sort: LibrarySortMode;
  filters: LibraryFilters;
}

/** Track states a URL may name — anything else is dropped on decode. */
const STATUSES = ['maq', 'needs_work', 'finished', 'archived'] as const;

export function encodeLibraryView(state: LibraryViewState): string {
  const p = new URLSearchParams();
  if (state.browse === 'all') p.set('view', 'all');
  if (state.sort !== DEFAULT_LIBRARY_SORT) p.set('sort', state.sort);

  const f = serializeFilters(state.filters) as {
    types: string[]; genres: string[]; statuses: string[]; triage: string[]; keys: string[];
    offlineOnly: boolean; bpmMin: number | null; bpmMax: number | null;
    scale: string; rating: number | null; ratingMatch: string;
  };
  for (const v of f.types) p.append('type', v);
  for (const v of f.genres) p.append('genre', v);
  for (const v of f.statuses) p.append('status', v);
  for (const v of f.triage) p.append('stage', v);
  for (const v of f.keys) p.append('key', v);
  if (f.offlineOnly) p.set('offline', '1');
  if (f.bpmMin != null) p.set('bpmMin', String(f.bpmMin));
  if (f.bpmMax != null) p.set('bpmMax', String(f.bpmMax));
  if (f.scale !== DEFAULT_FILTERS.scale) p.set('scale', f.scale);
  if (f.rating != null) {
    p.set('rating', String(f.rating));
    if (f.ratingMatch !== DEFAULT_FILTERS.ratingMatch) p.set('ratingMatch', f.ratingMatch);
  }
  return p.toString();
}

const num = (v: string | null): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse a `location.search` string. Always returns a full, valid state (defaults
 * for anything absent or invalid), so a caller can apply it unconditionally.
 */
export function decodeLibraryView(search: string): LibraryViewState {
  const p = new URLSearchParams(search);
  const sort = p.get('sort');
  const filters = deserializeFilters({
    types: p.getAll('type'),
    genres: p.getAll('genre').filter(Boolean),
    statuses: p.getAll('status').filter((s) => (STATUSES as readonly string[]).includes(s)),
    triage: p.getAll('stage'),
    keys: p.getAll('key').filter(Boolean),
    offlineOnly: p.get('offline') === '1',
    bpmMin: num(p.get('bpmMin')),
    bpmMax: num(p.get('bpmMax')),
    scale: p.get('scale'),
    rating: num(p.get('rating')),
    ratingMatch: p.get('ratingMatch'),
  });
  return {
    browse: p.get('view') === 'all' ? 'all' : 'sections',
    sort: isLibrarySortMode(sort) ? sort : DEFAULT_LIBRARY_SORT,
    filters,
  };
}

/** True when the query string carries anything the codec understands. */
export function hasLibraryViewParams(search: string): boolean {
  const p = new URLSearchParams(search);
  return ['view', 'sort', 'type', 'genre', 'status', 'stage', 'key', 'offline', 'bpmMin', 'bpmMax', 'scale', 'rating']
    .some((k) => p.has(k));
}
