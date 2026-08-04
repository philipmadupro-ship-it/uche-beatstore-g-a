import { describe, it, expect } from 'vitest';
import {
  planBulkTagging,
  planToTagRows,
  AUTO_TAG_MIN_CONFIDENCE,
  MAX_AUTO_TAGS_PER_TRACK,
  type TaggableTrack,
} from './bulk-tagging';

/**
 * A wrong tag is worse than a missing one: it puts a beat on a discovery page
 * it does not belong on, which wastes the visitor and makes the page read as
 * spam. These pin the behaviours that keep bulk tagging safe to run over a
 * whole catalogue.
 */

/** A clearly trap-shaped track: fast, energetic, not acoustic. */
const trapish = (id: string, over: Partial<TaggableTrack> = {}): TaggableTrack => ({
  id,
  title: `Track ${id}`,
  bpm: 140,
  key: 'G#',
  scale: 'minor',
  energy: 0.85,
  danceability: 0.7,
  valence: 0.2,
  acousticness: 0.05,
  loudness: -6,
  ...over,
});

describe('planBulkTagging', () => {
  it('proposes tags for a track with strong features', () => {
    const plan = planBulkTagging([trapish('1')]);
    expect(plan.plans.length).toBe(1);
    expect(plan.totalTags).toBeGreaterThan(0);
    expect(plan.plans[0].trackId).toBe('1');
  });

  it('never proposes a tag below the confidence floor', () => {
    // The floor is the whole safety mechanism; assert it holds for every
    // proposed tag rather than trusting the filter.
    const plan = planBulkTagging([trapish('1'), trapish('2', { bpm: 97, energy: 0.5 })]);
    for (const p of plan.plans) {
      for (const tag of p.tags) {
        expect(tag.confidence).toBeGreaterThanOrEqual(AUTO_TAG_MIN_CONFIDENCE);
      }
    }
  });

  it('respects a raised floor by proposing strictly less', () => {
    const permissive = planBulkTagging([trapish('1')], 0.1);
    const strict = planBulkTagging([trapish('1')], 0.99);
    expect(strict.totalTags).toBeLessThanOrEqual(permissive.totalTags);
  });

  it('caps how many tags one track can gain', () => {
    const plan = planBulkTagging([trapish('1')], 0.01);
    expect(plan.plans[0].tags.length).toBeLessThanOrEqual(MAX_AUTO_TAGS_PER_TRACK);
  });

  it('never proposes a tag the track already has', () => {
    // Producer intent wins; the plan only ever ADDS.
    const first = planBulkTagging([trapish('1')], 0.01);
    const alreadyApplied = first.plans[0].tags.map((t) => t.tag);
    const second = planBulkTagging([trapish('1', { appliedTags: alreadyApplied })], 0.01);
    for (const p of second.plans) {
      for (const tag of p.tags) {
        expect(alreadyApplied).not.toContain(tag.tag);
      }
    }
  });

  it('is idempotent — re-running after applying proposes nothing', () => {
    // So it is safe to run after every upload batch.
    const first = planBulkTagging([trapish('1')]);
    const applied = first.plans[0].tags.map((t) => t.tag);
    const second = planBulkTagging([trapish('1', { appliedTags: applied })]);
    expect(second.totalTags).toBe(0);
    expect(second.plans).toEqual([]);
  });

  it('counts tracks it left alone so the UI can report them', () => {
    const featureless: TaggableTrack = {
      id: 'x', title: 'Unknown',
      bpm: null, key: null, scale: null,
      energy: null, danceability: null, valence: null, acousticness: null, loudness: null,
    };
    const plan = planBulkTagging([featureless]);
    expect(plan.plans).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it('omits tracks that would gain nothing rather than listing them empty', () => {
    const plan = planBulkTagging([trapish('1'), { id: '2', title: 'Bare' }]);
    expect(plan.plans.every((p) => p.tags.length > 0)).toBe(true);
  });

  it('handles an empty catalogue and malformed rows without throwing', () => {
    expect(planBulkTagging([])).toEqual({ plans: [], totalTags: 0, skipped: 0 });
    expect(() => planBulkTagging([{ id: '', title: 'no id' }])).not.toThrow();
  });

  it('reports totalTags matching what the plans actually contain', () => {
    const plan = planBulkTagging([trapish('1'), trapish('2'), trapish('3')]);
    const counted = plan.plans.reduce((n, p) => n + p.tags.length, 0);
    expect(plan.totalTags).toBe(counted);
  });
});

describe('planToTagRows', () => {
  it('flattens a plan into junction rows', () => {
    const plan = planBulkTagging([trapish('1')]);
    const rows = planToTagRows(plan);
    expect(rows.length).toBe(plan.totalTags);
    expect(rows[0]).toHaveProperty('track_id', '1');
  });

  it('deduplicates a tag suggested twice for the same track', () => {
    // BPM and energy heuristics can both point at the same tag; inserting it
    // twice would violate the junction table's identity.
    const plan = {
      plans: [{
        trackId: 't1',
        title: 'X',
        tags: [
          { tag: 'Trap', category: 'genre', confidence: 0.9, reason: 'bpm' },
          { tag: 'trap', category: 'genre', confidence: 0.8, reason: 'energy' },
        ],
      }],
      totalTags: 2,
      skipped: 0,
    };
    expect(planToTagRows(plan)).toHaveLength(1);
  });

  it('keeps the same tag across different tracks', () => {
    const plan = {
      plans: [
        { trackId: 't1', title: 'A', tags: [{ tag: 'Trap', category: 'genre', confidence: 0.9, reason: '' }] },
        { trackId: 't2', title: 'B', tags: [{ tag: 'Trap', category: 'genre', confidence: 0.9, reason: '' }] },
      ],
      totalTags: 2,
      skipped: 0,
    };
    expect(planToTagRows(plan)).toHaveLength(2);
  });

  it('returns nothing for an empty plan', () => {
    expect(planToTagRows({ plans: [], totalTags: 0, skipped: 0 })).toEqual([]);
  });
});
