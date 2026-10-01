/**
 * The Library's shared filter predicate — one rule for "does this track pass
 * the Filters menu", used by BOTH views.
 *
 * All tracks and the Browse rows used to carry their own copy. The rows' copy
 * only knew genre, state and type, so a BPM, key, scale, rating, stage or
 * offline filter narrowed All tracks but left every Browse row untouched — the
 * Filters button read "1" over rows that had not moved. One predicate means the
 * two views cannot disagree about what a filter means. (Free-text search is
 * deliberately not part of it: it is the toolbar's, applied by All tracks.)
 *
 * Pure by design (CLAUDE.md: logic inside the component gets silently
 * reverted).
 */

import type { LibraryFilters } from '@/components/library/FilterBar';
import { matchesRating } from '@/lib/library/rating-filter';
import { triageStage, type TriageTrack } from '@/lib/library/triage';

export interface FilterableTrack extends TriageTrack {
  id: string;
  type?: string | null;
  scale?: string | null;
  status?: string | null;
  rating?: number | null;
}

export interface FilterContext {
  /** Ids cached for offline play (the `offlineOnly` facet). */
  cachedIds: ReadonlySet<string>;
  /** The producer has a default price, so a beat with none of its own is still sellable. */
  hasDefaultPrice: boolean;
}

export function matchesLibraryFilters(
  t: FilterableTrack,
  filters: LibraryFilters,
  ctx: FilterContext,
): boolean {
  if (filters.offlineOnly && !ctx.cachedIds.has(t.id)) return false;
  if (filters.types.size > 0 && !(t.type && filters.types.has(t.type as never))) return false;
  if (filters.bpmMin != null && (t.bpm == null || t.bpm < filters.bpmMin)) return false;
  if (filters.bpmMax != null && (t.bpm == null || t.bpm > filters.bpmMax)) return false;
  if (filters.keys.size > 0 && (!t.key || !filters.keys.has(t.key))) return false;
  if (filters.scale === 'major' && t.scale === 'minor') return false;
  if (filters.scale === 'minor' && t.scale !== 'minor') return false;
  if (filters.statuses.size > 0 && (!t.status || !filters.statuses.has(t.status))) return false;
  if (!matchesRating(t.rating, filters.rating, filters.ratingMatch)) return false;
  // Pipeline stage — derived from the row, so it needs no extra fetch.
  if (filters.triage.size > 0 && !filters.triage.has(triageStage(t, { hasDefaultPrice: ctx.hasDefaultPrice }))) {
    return false;
  }
  // Genre — track_tags come down from the API rich select.
  if (filters.genres.size > 0) {
    const has = (t.track_tags ?? []).some(
      (tt) => tt.category === 'genre' && filters.genres.has(tt.tag),
    );
    if (!has) return false;
  }
  return true;
}
