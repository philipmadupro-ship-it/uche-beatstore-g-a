/**
 * The Library's All tracks sort modes, and how a Browse row's `sortBy` maps
 * onto them.
 *
 * Lives here (not in the page) because three things must agree on the list: the
 * sort dropdown, the URL codec that restores a shared/refreshed view, and See
 * all, which carries the row's ordering into All tracks.
 */

import type { HomeSortMode } from '@/lib/dashboard/home-config';

export const LIBRARY_SORT_MODES = [
  'recent',
  'title',
  'bpm',
  'bpm-desc',
  'key',
  'rating',
  'plays',
  'store_order',
] as const;

export type LibrarySortMode = (typeof LIBRARY_SORT_MODES)[number];

export const DEFAULT_LIBRARY_SORT: LibrarySortMode = 'recent';

export function isLibrarySortMode(v: unknown): v is LibrarySortMode {
  return typeof v === 'string' && (LIBRARY_SORT_MODES as readonly string[]).includes(v);
}

/**
 * A row with no `sortBy` renders newest-first (the `default` branch of the
 * page's row sort), so "no sort" maps to `recent` rather than to "leave the
 * producer's sort alone" — See all should open in the order the row showed.
 */
export function sortForHomeRow(sortBy: HomeSortMode | undefined): LibrarySortMode {
  switch (sortBy) {
    case 'plays': return 'plays';
    case 'rating': return 'rating';
    case 'alphabetical': return 'title';
    case 'newest':
    default: return 'recent';
  }
}
