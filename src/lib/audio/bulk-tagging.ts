/**
 * Bulk auto-tagging — planning half.
 *
 * WHY THIS EXISTS. `suggestTags` already turns audio features into
 * confidence-scored genre/mood suggestions, and `TagPicker` shows them. But it
 * is manual and per-track, so a 57-track catalogue means 57 separate decisions
 * — and the result is that almost nothing is tagged.
 *
 * That is not just untidy. The discovery engine generates its landing pages
 * from genre and mood tags, so an untagged catalogue produces no entry points:
 * the store stays invisible to search no matter how good the beats are.
 *
 * WHAT MAKES THIS SAFE TO RUN OVER A WHOLE CATALOGUE
 *
 *   - A confidence FLOOR. A wrong tag is worse than no tag — it puts a beat on
 *     a page it does not belong on, which wastes the visitor and makes the page
 *     look like spam. Only strong suggestions are applied automatically; the
 *     weaker ones remain available in `TagPicker` for a human.
 *   - Manual tags are never touched. `suggestTags` already filters out applied
 *     tags, and the plan only ever ADDS.
 *   - Idempotent. Re-running proposes nothing new, so it is safe to run after
 *     every upload batch.
 *
 * Pure and dependency-free so it is unit-testable, per the project rule that
 * logic inside a component cannot be tested and gets silently reverted.
 */

import { suggestTags, type TrackFeatures, type TagSuggestion } from './feature-tags';

/**
 * Minimum confidence for an automatic tag.
 *
 * Set deliberately high. The cost of a missing tag is one fewer landing page;
 * the cost of a wrong tag is a page that lies about its contents. Those are not
 * symmetric, so the threshold favours silence.
 */
export const AUTO_TAG_MIN_CONFIDENCE = 0.7;

/**
 * Cap on a track's TOTAL tags, not on one run's additions.
 *
 * A per-run cap looks equivalent but is not: a track with five strong
 * suggestions would gain four now and the fifth on the next run, so repeated
 * runs creep past the limit the cap exists to enforce. Counting tags the track
 * already has makes the bound real and makes re-running genuinely converge.
 */
export const MAX_AUTO_TAGS_PER_TRACK = 4;

export interface TaggableTrack extends TrackFeatures {
  id: string;
  title: string;
  /** Tags already on the track, whatever their source. */
  appliedTags?: readonly string[];
}

export interface TrackTagPlan {
  trackId: string;
  title: string;
  /** Tags to add. Empty entries are dropped before the plan is returned. */
  tags: Array<{ tag: string; category: string; confidence: number; reason: string }>;
}

export interface BulkTagPlan {
  /** Only tracks that would actually gain something. */
  plans: TrackTagPlan[];
  /** Total tags across all plans — what the UI reports. */
  totalTags: number;
  /** Tracks considered but left alone, so the UI can say "12 already tagged". */
  skipped: number;
}

/**
 * Decide what to tag, without writing anything.
 *
 * Separating the plan from the write means the caller can show the producer
 * what is about to happen, and means this whole decision is testable without a
 * database.
 */
export function planBulkTagging(
  tracks: TaggableTrack[],
  minConfidence = AUTO_TAG_MIN_CONFIDENCE,
  maxPerTrack = MAX_AUTO_TAGS_PER_TRACK,
): BulkTagPlan {
  const plans: TrackTagPlan[] = [];
  let totalTags = 0;
  let skipped = 0;

  for (const track of tracks) {
    if (!track?.id) continue;

    const applied = track.appliedTags ?? [];

    // Budget is what the track can still take, not what one run may add.
    const budget = Math.max(0, maxPerTrack - applied.length);
    if (budget === 0) {
      skipped += 1;
      continue;
    }

    const suggestions: TagSuggestion[] = suggestTags(
      track,
      applied,
      // Ask for more than the budget so the confidence filter has room to
      // reject weak ones without starving the result.
      maxPerTrack * 3,
    );

    const strong = suggestions
      .filter((s) => s.confidence >= minConfidence)
      .slice(0, budget);

    if (strong.length === 0) {
      skipped += 1;
      continue;
    }

    plans.push({
      trackId: track.id,
      title: track.title,
      tags: strong.map((s) => ({
        tag: s.tag,
        category: s.category,
        confidence: s.confidence,
        reason: s.reason,
      })),
    });
    totalTags += strong.length;
  }

  return { plans, totalTags, skipped };
}

/**
 * Flatten a plan into rows for `track_tags`.
 *
 * Deduplicated on (track, tag) because the same tag can legitimately be
 * suggested by two different heuristics — BPM and energy can both point at
 * "Trap" — and inserting it twice would violate the junction table's identity.
 */
export function planToTagRows(plan: BulkTagPlan): Array<{
  track_id: string; tag: string; category: string;
}> {
  const seen = new Set<string>();
  const rows: Array<{ track_id: string; tag: string; category: string }> = [];

  for (const trackPlan of plan.plans) {
    for (const tag of trackPlan.tags) {
      const key = `${trackPlan.trackId}::${tag.tag.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ track_id: trackPlan.trackId, tag: tag.tag, category: tag.category });
    }
  }
  return rows;
}
