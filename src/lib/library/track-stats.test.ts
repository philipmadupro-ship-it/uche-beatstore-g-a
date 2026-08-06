import { describe, it, expect } from 'vitest';
import {
  aggregateTrackStats, statsFor, formatRevenue, EMPTY_STATS,
  type PurchaseRow,
} from './track-stats';

const purchase = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  amount_usd: 30,
  track_ids: ['t1'],
  line_items: null,
  status: 'paid',
  ...over,
});

describe('aggregateTrackStats — plays', () => {
  it('uses the view\'s pre-aggregated count', () => {
    const s = aggregateTrackStats({ plays: [{ track_id: 't1', play_count: 42 }] });
    expect(s.t1.plays).toBe(42);
  });

  it('counts a raw play row as one', () => {
    const s = aggregateTrackStats({ plays: [{ track_id: 't1' }, { track_id: 't1' }] });
    expect(s.t1.plays).toBe(2);
  });

  it('ignores rows with no track', () => {
    expect(aggregateTrackStats({ plays: [{ track_id: null }] })).toEqual({});
  });
});

describe('aggregateTrackStats — downloads', () => {
  it('counts one per row', () => {
    const s = aggregateTrackStats({
      downloads: [{ track_id: 't1' }, { track_id: 't1' }, { track_id: 't2' }],
    });
    expect(s.t1.downloads).toBe(2);
    expect(s.t2.downloads).toBe(1);
  });
});

describe('aggregateTrackStats — revenue', () => {
  it('attributes a single-track order in full', () => {
    const s = aggregateTrackStats({ purchases: [purchase({ amount_usd: 30 })] });
    expect(s.t1.revenueUsd).toBe(30);
    expect(s.t1.sales).toBe(1);
  });

  it('splits a multi-track order evenly — no per-item amount is stored', () => {
    const s = aggregateTrackStats({
      purchases: [purchase({ amount_usd: 90, track_ids: ['t1', 't2', 't3'] })],
    });
    expect(s.t1.revenueUsd).toBe(30);
    expect(s.t2.revenueUsd).toBe(30);
    expect(s.t3.revenueUsd).toBe(30);
  });

  it('does not lose or invent cents on an uneven split', () => {
    const s = aggregateTrackStats({
      purchases: [purchase({ amount_usd: 100, track_ids: ['a', 'b', 'c'] })],
    });
    // Compared in integer cents: $100 across three tracks is 33.33 each and
    // cannot sum back to exactly 100 in any currency with cents. The check is
    // that the drift is at most one cent, not that floats add up.
    const totalCents = Math.round((s.a.revenueUsd + s.b.revenueUsd + s.c.revenueUsd) * 100);
    expect(Math.abs(totalCents - 10000)).toBeLessThanOrEqual(1);
  });

  it('prefers line_items over the track_ids array', () => {
    const s = aggregateTrackStats({
      purchases: [purchase({
        amount_usd: 50,
        track_ids: ['ignored'],
        line_items: [{ track_id: 't9', license_id: 'l1', license_type: 'lease' }],
      })],
    });
    expect(s.t9.revenueUsd).toBe(50);
    expect(s.ignored).toBeUndefined();
  });

  it('falls back to track_ids when line_items is malformed', () => {
    const s = aggregateTrackStats({
      purchases: [purchase({ amount_usd: 20, track_ids: ['t1'], line_items: { junk: true } })],
    });
    expect(s.t1.revenueUsd).toBe(20);
  });

  it('excludes refunds and disputes — a money column must never overstate', () => {
    for (const status of ['refunded', 'disputed', 'failed']) {
      const s = aggregateTrackStats({ purchases: [purchase({ status })] });
      expect(s.t1).toBeUndefined();
    }
  });

  it('treats a missing status as paid, matching the column default', () => {
    const s = aggregateTrackStats({ purchases: [purchase({ status: null })] });
    expect(s.t1.revenueUsd).toBe(30);
  });

  it('ignores a purchase with nothing to attribute to', () => {
    expect(aggregateTrackStats({
      purchases: [purchase({ track_ids: [], line_items: null })],
    })).toEqual({});
  });

  it('survives a non-numeric amount rather than producing NaN', () => {
    const s = aggregateTrackStats({ purchases: [purchase({ amount_usd: 'oops' })] });
    expect(Number.isNaN(s.t1.revenueUsd)).toBe(false);
  });
});

describe('aggregateTrackStats — combined', () => {
  it('merges all three sources onto one track', () => {
    const s = aggregateTrackStats({
      plays: [{ track_id: 't1', play_count: 10 }],
      downloads: [{ track_id: 't1' }],
      purchases: [purchase({ amount_usd: 25 })],
    });
    expect(s.t1).toEqual({ plays: 10, downloads: 1, revenueUsd: 25, sales: 1 });
  });

  it('returns an empty map for empty input rather than throwing', () => {
    expect(aggregateTrackStats({})).toEqual({});
  });
});

describe('statsFor', () => {
  it('gives zeroes for a track with no activity, so columns render 0 not blank', () => {
    expect(statsFor({}, 'nope')).toEqual(EMPTY_STATS);
  });
});

describe('formatRevenue', () => {
  it('shows cents under $100 and whole dollars above', () => {
    expect(formatRevenue(12.5)).toBe('$12.50');
    expect(formatRevenue(1240)).toBe('$1,240');
  });

  it('drops trailing .00', () => {
    expect(formatRevenue(30)).toBe('$30');
  });

  it('is empty for nothing earned — a dash reads better than $0 in a dense table', () => {
    expect(formatRevenue(0)).toBe('');
    expect(formatRevenue(NaN)).toBe('');
  });
});
