import type { LibraryFilters } from '@/components/library/FilterBar';
import { DEFAULT_FILTERS } from '@/components/library/FilterBar';
import { matchesLibraryFilters, type FilterableTrack } from '@/lib/library/filter-tracks';
import { keyRank } from '@/lib/library/key-rank';
import { decodeLibraryView, encodeLibraryView } from '@/lib/library/view-state';

/**
 * The view of a share page's track list: search, the Library's own filters and
 * a sort. Pure, so it is Vitest-covered and the component only renders it.
 *
 * It is the Library's model, not a second one. Filtering is
 * `matchesLibraryFilters` (types, genres, tags by name, BPM, key, scale), the
 * URL is the Library's codec (`tag=`, `genre=`, `bpmMin=`…), and the key sort is
 * the Library's `keyRank`. The only things that differ are the ones that must:
 * a share has no state / stage / rating / offline facets (they are the owner's),
 * its default order is the producer's arrangement (`share`), and its search also
 * reads tags, so "dark" finds the dark ones.
 */

export const SHARE_SORT_MODES = ['share', 'recent', 'title', 'bpm', 'bpm-desc', 'key'] as const;
export type ShareSortMode = (typeof SHARE_SORT_MODES)[number];

export const SHARE_SORT_OPTIONS: { value: ShareSortMode; label: string }[] = [
  { value: 'share', label: 'Share order' },
  { value: 'recent', label: 'Newest' },
  { value: 'title', label: 'Title A→Z' },
  { value: 'bpm', label: 'BPM ↑' },
  { value: 'bpm-desc', label: 'BPM ↓' },
  { value: 'key', label: 'Key' },
];

export interface ShareViewState {
  search: string;
  filters: LibraryFilters;
  sort: ShareSortMode;
}

export const DEFAULT_SHARE_VIEW: ShareViewState = {
  search: '',
  filters: DEFAULT_FILTERS,
  sort: 'share',
};

/** Below this many tracks a list is short enough to read; no toolbar. */
export const SHARE_TOOLBAR_MIN_TRACKS = 8;

export interface ShareViewTrack extends FilterableTrack {
  title: string;
  created_at?: string | null;
}

export function isShareSort(v: unknown): v is ShareSortMode {
  return typeof v === 'string' && (SHARE_SORT_MODES as readonly string[]).includes(v);
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every word of the query must appear in the title, key, BPM, type or a tag. */
export function matchesShareSearch(t: ShareViewTrack, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([
    t.title,
    t.key ? `${t.key} ${t.scale ?? ''}${t.scale === 'minor' ? ` ${t.key}m` : ''}` : '',
    t.bpm != null ? String(t.bpm) : '',
    t.type ?? '',
    ...(t.track_tags ?? []).map((x) => x.tag),
  ].join(' \n '));
  return words.every((w) => hay.includes(w));
}

export function filterAndSortShareTracks<T extends ShareViewTrack>(tracks: T[], view: ShareViewState): T[] {
  // Owner-only facets are not offered to a recipient and are not applied from
  // a hand-edited URL either.
  const filters: LibraryFilters = {
    ...view.filters,
    statuses: new Set(),
    triage: new Set(),
    offlineOnly: false,
    rating: null,
  };
  const matched: { track: T; index: number }[] = [];
  tracks.forEach((track, index) => {
    if (!matchesLibraryFilters(track, filters, { cachedIds: new Set(), hasDefaultPrice: true })) return;
    if (!matchesShareSearch(track, view.search)) return;
    matched.push({ track, index });
  });

  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;
  const created = (t: T) => String(t.created_at ?? '');
  switch (view.sort) {
    case 'title':
      matched.sort((a, b) => (a.track.title || '').localeCompare(b.track.title || '', undefined, { numeric: true, sensitivity: 'base' }) || byIndex(a, b));
      break;
    case 'bpm':
      matched.sort((a, b) => (a.track.bpm ?? Infinity) - (b.track.bpm ?? Infinity) || byIndex(a, b));
      break;
    case 'bpm-desc':
      matched.sort((a, b) => (b.track.bpm ?? -Infinity) - (a.track.bpm ?? -Infinity) || byIndex(a, b));
      break;
    case 'key':
      matched.sort((a, b) => keyRank(a.track) - keyRank(b.track) || byIndex(a, b));
      break;
    case 'recent':
      matched.sort((a, b) => created(b.track).localeCompare(created(a.track)) || byIndex(a, b));
      break;
    case 'share':
    default:
      break; // the producer's arrangement, already the input order
  }
  return matched.map((m) => m.track);
}

/** Whether the view narrows or reorders anything. */
export function isDefaultShareView(v: ShareViewState): boolean {
  return v.search.trim() === '' && v.sort === 'share' && encodeLibraryView({ browse: 'sections', sort: 'recent', filters: stripOwnerFacets(v.filters) }) === '';
}

function stripOwnerFacets(f: LibraryFilters): LibraryFilters {
  return { ...f, statuses: new Set(), triage: new Set(), offlineOnly: false, rating: null };
}

// ── URL ──────────────────────────────────────────────────────────────────
// The Library's keys plus `q` for search; `sort=share` is implicit. Params a
// share page owns for other reasons (`purchase`, `session_id`…) are kept.

const LIBRARY_KEYS = ['view', 'sort', 'type', 'genre', 'tag', 'status', 'stage', 'key', 'offline', 'bpmMin', 'bpmMax', 'scale', 'rating', 'ratingMatch'];

export function decodeShareView(search: string): ShareViewState {
  const p = new URLSearchParams(search);
  const lib = decodeLibraryView(search);
  const sortParam = p.get('sort');
  return {
    search: (p.get('q') ?? '').slice(0, 200),
    filters: stripOwnerFacets(lib.filters),
    sort: isShareSort(sortParam) ? sortParam : 'share',
  };
}

/** The new query string for `view`, preserving everything that is not the list's. */
export function encodeShareView(view: ShareViewState, currentSearch: string): string {
  const next = new URLSearchParams(currentSearch);
  for (const k of [...LIBRARY_KEYS, 'q']) next.delete(k);
  const lib = new URLSearchParams(encodeLibraryView({ browse: 'sections', sort: 'recent', filters: stripOwnerFacets(view.filters) }));
  lib.delete('sort');
  lib.forEach((v, k) => next.append(k, v));
  if (view.sort !== 'share') next.set('sort', view.sort);
  if (view.search.trim()) next.set('q', view.search.trim());
  return next.toString();
}

export function shareCountLabel(shown: number, total: number): string {
  if (shown === total) return `${total} ${total === 1 ? 'track' : 'tracks'}`;
  return `${shown} of ${total}`;
}
