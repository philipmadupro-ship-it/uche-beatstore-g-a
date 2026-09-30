/**
 * "See all →" on a Library Browse row.
 *
 * A Browse row is a capped sample (`maxItems`) of "tracks matching this row's
 * criteria". See all has to open All tracks showing THOSE tracks, uncapped —
 * which means translating the row's criteria (`HomeRowFilter`) into the filter
 * model the All tracks list runs on (`LibraryFilters`). It used to translate
 * nothing: every row's See all just flipped the mode, so "WIP → See all" landed
 * on the whole vault.
 *
 * Rule: the clicked row's own criteria win on every dimension it names;
 * everything else the producer already set is kept. Keeping is deliberate —
 * dropping a filter the toolbar still shows as active would change the list
 * behind the producer's back. Where the row also honours a dimension of the
 * shared filters (genre, state, type — see `homeRows` in the page), the row's
 * value replaces it: the row is what was clicked.
 *
 * Pure by design (CLAUDE.md: logic inside the component gets silently
 * reverted). The mapping onto existing facets, none of them new:
 *
 *   genres / statuses  → the same-named sets
 *   types              → `type`, which is a SINGLE-select — see below
 *   storeListed        → triage stage `listed` (triageStage() returns it exactly
 *                        when `store_listed` is true)
 *   notStoreListed     → every other triage stage (the stages partition tracks)
 *   minRating          → `rating` with `atLeast`
 *
 * Not carried: `sortBy`. The row orders by recency / rating / plays; All tracks
 * has its own sort control, which the producer keeps. Multi-value `types`
 * cannot be expressed by the single-select `type` facet, so it is left
 * unchanged rather than guessed at; no default row uses it.
 */

import type { HomeRowFilter } from '@/lib/dashboard/home-config';
import { TRIAGE_STAGE_ORDER, type TriageStage } from '@/lib/library/triage';
import type { LibraryFilters, LibraryTrackType } from '@/components/library/FilterBar';

const LIBRARY_TYPES: readonly LibraryTrackType[] = ['beat', 'instrumental', 'song', 'remix'];

export function filtersForHomeRow(
  row: HomeRowFilter | undefined,
  current: LibraryFilters,
): LibraryFilters {
  // Copy every Set: the result becomes React state, and sharing a Set with the
  // previous state would let a later mutation leak backwards.
  const next: LibraryFilters = {
    ...current,
    genres: new Set(current.genres),
    statuses: new Set(current.statuses),
    keys: new Set(current.keys),
    triage: new Set(current.triage),
  };
  if (!row) return next;

  if (row.genres?.length) next.genres = new Set(row.genres);
  if (row.statuses?.length) next.statuses = new Set(row.statuses);

  if (row.types?.length === 1 && LIBRARY_TYPES.includes(row.types[0] as LibraryTrackType)) {
    next.type = row.types[0] as LibraryTrackType;
  }

  if (row.storeListed) {
    next.triage = new Set<TriageStage>(['listed']);
  } else if (row.notStoreListed) {
    next.triage = new Set<TriageStage>(TRIAGE_STAGE_ORDER.filter((s) => s !== 'listed'));
  }

  if (row.minRating != null && row.minRating > 0) {
    next.rating = row.minRating;
    next.ratingMatch = 'atLeast';
  }

  return next;
}
