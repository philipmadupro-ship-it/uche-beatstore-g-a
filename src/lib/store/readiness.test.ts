import { describe, it, expect } from 'vitest';
import {
  trackBlockers,
  summariseReadiness,
  isHardBlocker,
  BLOCKER_LABELS,
  BLOCKER_REASONS,
  type ReadinessTrack,
} from './readiness';

/**
 * The gap these pin: the store editor's "needs attention" panel only inspects
 * ALREADY-LISTED beats, so an uploaded-but-never-listed track is structurally
 * invisible to it. Combined with upload being a dead end, a producer can end up
 * with a vault of finished music that nobody can buy and an app that never
 * mentions it.
 */

const complete = (over: Partial<ReadinessTrack> = {}): ReadinessTrack => ({
  id: 't1',
  title: 'Finished Beat',
  store_listed: true,
  cover_url: 'https://cdn/x.jpg',
  lease_price_usd: 30,
  bpm: 140,
  key: 'G#',
  tags: [{ tag: 'Trap', category: 'genre' }],
  ...over,
});

describe('trackBlockers', () => {
  it('reports nothing for a fully sellable track', () => {
    expect(trackBlockers(complete(), true)).toEqual([]);
  });

  it('flags a track that was uploaded but never listed', () => {
    // The exact case the existing panel cannot see.
    expect(trackBlockers(complete({ store_listed: false }), true)).toContain('not-listed');
  });

  it('flags each missing piece independently', () => {
    expect(trackBlockers(complete({ cover_url: null }), true)).toEqual(['no-cover']);
    expect(trackBlockers(complete({ tags: [] }), true)).toEqual(['no-tags']);
    expect(trackBlockers(complete({ bpm: null }), true)).toEqual(['no-metadata']);
    expect(trackBlockers(complete({ key: null }), true)).toEqual(['no-metadata']);
  });

  it('does not report "no price" when a profile default covers it', () => {
    // The store falls back to creator_profiles pricing, so flagging every
    // track would be noise — and noise is what makes a checklist ignored.
    const noOwnPrice = complete({ lease_price_usd: null, exclusive_price_usd: null });
    expect(trackBlockers(noOwnPrice, true)).toEqual([]);
    expect(trackBlockers(noOwnPrice, false)).toContain('no-price');
  });

  it('accepts an exclusive-only price as a price', () => {
    const exclusiveOnly = complete({ lease_price_usd: null, exclusive_price_usd: 300 });
    expect(trackBlockers(exclusiveOnly, false)).toEqual([]);
  });

  it('treats a zero price as set, not missing', () => {
    // Free beats are a deliberate strategy, not an oversight.
    expect(trackBlockers(complete({ lease_price_usd: 0 }), false)).toEqual([]);
  });

  it('does not count an instrument or status tag as a genre/mood tag', () => {
    // Only genre and mood drive discovery pages, so only they count here.
    const wrongCategory = complete({ tags: [{ tag: '808s', category: 'instrument' }] });
    expect(trackBlockers(wrongCategory, true)).toContain('no-tags');
  });

  it('ignores blank tags', () => {
    expect(trackBlockers(complete({ tags: [{ tag: '  ', category: 'genre' }] }), true))
      .toContain('no-tags');
  });

  it('accumulates every blocker on a bare upload', () => {
    const bare: ReadinessTrack = { id: 'x', title: 'Just uploaded' };
    const blockers = trackBlockers(bare, false);
    expect(blockers).toEqual(
      expect.arrayContaining(['not-listed', 'no-price', 'no-cover', 'no-tags', 'no-metadata']),
    );
  });
});

describe('summariseReadiness', () => {
  it('counts sellable against blocked', () => {
    const summary = summariseReadiness(
      [complete(), complete({ id: 't2', store_listed: false })],
      true,
    );
    expect(summary.sellableCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
  });

  it('orders tracks worst-first so the panel shows what is furthest from earning', () => {
    const summary = summariseReadiness([
      complete({ id: 'nearly', cover_url: null }),
      complete({ id: 'bare', store_listed: false, cover_url: null, tags: [], bpm: null }),
    ], true);
    expect(summary.tracks[0].id).toBe('bare');
  });

  it('orders blockers by how many tracks they affect', () => {
    // That is the order in which a bulk fix is worth doing.
    const summary = summariseReadiness([
      complete({ id: '1', tags: [] }),
      complete({ id: '2', tags: [] }),
      complete({ id: '3', cover_url: null }),
    ], true);
    expect(summary.byBlocker[0].blocker).toBe('no-tags');
    expect(summary.byBlocker[0].count).toBe(2);
  });

  it('handles an empty catalogue', () => {
    expect(summariseReadiness([], true)).toEqual({
      tracks: [],
      blockedCount: 0,
      unpurchasableCount: 0,
      purchasableCount: 0,
      sellableCount: 0,
      byBlocker: [],
    });
  });

  it('skips rows with no id rather than producing a blank entry', () => {
    const summary = summariseReadiness([{ id: '', title: 'broken' }], true);
    expect(summary.tracks).toEqual([]);
  });

  it('reports counts that match the per-track blockers', () => {
    const summary = summariseReadiness([
      complete({ id: '1', cover_url: null }),
      complete({ id: '2', cover_url: null, tags: [] }),
    ], true);
    const coverCount = summary.tracks.filter((t) => t.blockers.includes('no-cover')).length;
    expect(summary.byBlocker.find((b) => b.blocker === 'no-cover')!.count).toBe(coverCount);
  });
});

describe('purchasable vs merely improvable', () => {
  it('counts a listed, priced beat as purchasable even without a cover', () => {
    // The correction that prompted this split: reporting "0 ready to sell"
    // while beats are genuinely on sale is false, and an overstating
    // diagnostic is one the producer learns to ignore.
    const listedNoCover = complete({ cover_url: null });
    const summary = summariseReadiness([listedNoCover], true);
    expect(summary.purchasableCount).toBe(1);
    expect(summary.unpurchasableCount).toBe(0);
    expect(summary.sellableCount).toBe(0);
  });

  it('counts an unlisted beat as unpurchasable', () => {
    const summary = summariseReadiness([complete({ store_listed: false })], true);
    expect(summary.unpurchasableCount).toBe(1);
    expect(summary.purchasableCount).toBe(0);
  });

  it('treats only listing and price as hard blockers', () => {
    expect(isHardBlocker('not-listed')).toBe(true);
    expect(isHardBlocker('no-price')).toBe(true);
    expect(isHardBlocker('no-cover')).toBe(false);
    expect(isHardBlocker('no-tags')).toBe(false);
    expect(isHardBlocker('no-metadata')).toBe(false);
  });

  it('lists unpurchasable beats before merely improvable ones', () => {
    const summary = summariseReadiness([
      complete({ id: 'improvable', cover_url: null, tags: [], bpm: null }),
      complete({ id: 'unbuyable', store_listed: false }),
    ], true);
    expect(summary.tracks[0].id).toBe('unbuyable');
  });
});

describe('copy', () => {
  it('has a label and a reason for every blocker', () => {
    // A checklist without a "why" is a chore list; the reason is what lets the
    // producer decide what to fix first.
    for (const key of Object.keys(BLOCKER_LABELS) as Array<keyof typeof BLOCKER_LABELS>) {
      expect(BLOCKER_LABELS[key]).toBeTruthy();
      expect(BLOCKER_REASONS[key]).toBeTruthy();
    }
  });
});
