/**
 * Home page section configuration.
 *
 * This is the single place to define which rows appear on the dashboard
 * Home page and what data they show. Each entry maps to a horizontal
 * scrollable row of cards on the page.
 *
 * Later this can be exposed in the Store Editor so the producer can
 * reorder/hide/rename rows without touching code.
 */

import type { TrackStatus, TrackType } from '@/lib/types';

// ── Data source for a row ─────────────────────────────────────────
export type HomeRowSource = 'tracks' | 'playlists' | 'projects' | 'recent';

export type HomeSortMode =
  | 'newest'       // by created_at desc
  | 'plays'        // by play count desc (requires analytics join)
  | 'rating'       // by rating desc
  | 'alphabetical'; // by title asc

export interface HomeRowFilter {
  /** Genre tags to match (OR logic — any match qualifies the track) */
  genres?: string[];
  /** Track states to match (OR logic) */
  statuses?: TrackStatus[];
  /** Track types to match (OR logic) */
  types?: TrackType[];
  /** Only include tracks listed in the store */
  storeListed?: boolean;
  /** Only include tracks NOT listed in the store */
  notStoreListed?: boolean;
  /** Tracks with a rating ≥ this value */
  minRating?: number;
}

export interface HomeRowConfig {
  /** Stable unique id used as React key and for user preference storage */
  id: string;
  /** Row heading shown above the card strip */
  title: string;
  /** Optional sub-label shown below the title in smaller text */
  subtitle?: string;
  /** Where the cards come from */
  source: HomeRowSource;
  /** Filter criteria (only applies to 'tracks' source) */
  filter?: HomeRowFilter;
  /** Sort order for the row cards */
  sortBy?: HomeSortMode;
  /** Max number of cards in the strip (default 10) */
  maxItems?: number;
  /** If true, this row is hidden when home filters are active and nothing matches */
  hideWhenEmpty?: boolean;
}

// ── Default rows ──────────────────────────────────────────────────
// Edit this array to reorder/add/remove rows without touching any
// rendering code. Each entry is one horizontal strip.

export const DEFAULT_HOME_ROWS: HomeRowConfig[] = [
  {
    id: 'recent',
    title: 'Recently played',
    source: 'recent',
    maxItems: 8,
  },
  {
    id: 'maq_ideas',
    title: 'MAQ — Maquette ideas',
    subtitle: 'Stripped demos to develop',
    source: 'tracks',
    filter: { statuses: ['maq'] },
    sortBy: 'newest',
    maxItems: 10,
    hideWhenEmpty: true,
  },
  {
    id: 'wip',
    title: 'WIP',
    subtitle: 'In progress',
    source: 'tracks',
    filter: { statuses: ['needs_work'] },
    sortBy: 'newest',
    maxItems: 10,
    hideWhenEmpty: true,
  },
  {
    id: 'finished_for_sale',
    title: 'Finished beats',
    subtitle: 'Ready to sell',
    source: 'tracks',
    filter: { statuses: ['finished'] },
    sortBy: 'rating',
    maxItems: 10,
    hideWhenEmpty: true,
  },
  {
    id: 'playlists',
    title: 'Your playlists',
    source: 'playlists',
    sortBy: 'newest',
    maxItems: 8,
  },
  {
    id: 'projects',
    title: 'Projects',
    subtitle: 'Active sessions',
    source: 'projects',
    sortBy: 'newest',
    maxItems: 8,
  },
  {
    id: 'store',
    title: 'In your store',
    source: 'tracks',
    filter: { storeListed: true },
    sortBy: 'plays',
    maxItems: 10,
  },
  {
    id: 'top_rated',
    title: 'Top rated',
    source: 'tracks',
    filter: { minRating: 4 },
    sortBy: 'rating',
    maxItems: 10,
    hideWhenEmpty: true,
  },
];

// ── Genre rows are the producer's own ────────────────────────────
// The default list once hard-coded five genres; a producer whose catalogue is
// UK drill or pop got none, and one with all five got five near-duplicate rows.

/** Genre rows are inserted right after this row. */
export const GENRE_ROWS_AFTER = 'projects';
export const MAX_GENRE_ROWS = 3;

/** Row ids the five original genres had; `filtersForHomeRow` and e2e rely on them. */
const LEGACY_GENRE_SLUGS: Record<string, string> = { 'R&B': 'rnb' };

export function genreRowId(genre: string): string {
  const slug = LEGACY_GENRE_SLUGS[genre] ?? genre.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `genre_${slug || 'other'}`;
}

interface TaggedTrack { track_tags?: Array<{ tag: string; category?: string | null }> | null }

/** The producer's most common genres, most common first (ties: alphabetical). */
export function topGenreRows(tracks: TaggedTrack[], max = MAX_GENRE_ROWS): HomeRowConfig[] {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const own = new Set<string>();
    for (const tt of t.track_tags ?? []) if (tt.category === 'genre' && tt.tag) own.add(tt.tag);
    for (const g of own) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([genre]) => ({
      id: genreRowId(genre),
      title: genre,
      source: 'tracks' as const,
      filter: { genres: [genre] },
      sortBy: 'newest' as const,
      maxItems: 10,
      hideWhenEmpty: true,
    }));
}

/** DEFAULT_HOME_ROWS with the producer's genre rows spliced in. */
export function resolveHomeRows(tracks: TaggedTrack[], base: HomeRowConfig[] = DEFAULT_HOME_ROWS): HomeRowConfig[] {
  const genres = topGenreRows(tracks);
  const at = base.findIndex((r) => r.id === GENRE_ROWS_AFTER);
  const index = at === -1 ? base.length : at + 1;
  return [...base.slice(0, index), ...genres, ...base.slice(index)];
}

// ── Discovery rows don't repeat each other ───────────────────────
// Genres, "In your store" and "Top rated" are discovery: the same beat in all
// four is noise. Status rows (MAQ / WIP / Finished) and Recently played are
// where a producer LOOKS for a beat, so they never lose one and never feed this.

export const DISCOVERY_MIN_KEEP = 4;

export function isDiscoveryRow(id: string): boolean {
  return id.startsWith('genre_') || id === 'store' || id === 'top_rated';
}

/**
 * Pick each row's tracks from its full pool (already filtered and sorted).
 * A discovery row skips tracks an earlier discovery row showed, unless that
 * would leave it thinner than min(4, its pool): then it keeps its own pool.
 */
export function selectRowTracks<T extends { id: string }>(
  pools: Array<{ id: string; maxItems?: number; tracks: T[] }>,
  minKeep = DISCOVERY_MIN_KEEP,
): Record<string, T[]> {
  const shown = new Set<string>();
  const out: Record<string, T[]> = {};
  for (const row of pools) {
    const cap = row.maxItems ?? 10;
    let picked = row.tracks;
    if (isDiscoveryRow(row.id)) {
      const fresh = row.tracks.filter((t) => !shown.has(t.id));
      if (fresh.length >= Math.min(minKeep, row.tracks.length)) picked = fresh;
    }
    picked = picked.slice(0, cap);
    out[row.id] = picked;
    if (isDiscoveryRow(row.id)) for (const t of picked) shown.add(t.id);
  }
  return out;
}
