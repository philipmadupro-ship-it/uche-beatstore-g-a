import { describe, it, expect } from 'vitest';
import { computeRecentSalesByTrack } from './momentum';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-10T12:00:00Z');

describe('computeRecentSalesByTrack', () => {
  it('counts a purchase within the window', () => {
    const counts = computeRecentSalesByTrack(
      [{ track_ids: ['t1'], created_at: new Date(NOW - 2 * DAY).toISOString() }],
      7 * DAY,
      NOW,
    );
    expect(counts).toEqual({ t1: 1 });
  });

  it('excludes purchases outside the window', () => {
    const counts = computeRecentSalesByTrack(
      [{ track_ids: ['t1'], created_at: new Date(NOW - 10 * DAY).toISOString() }],
      7 * DAY,
      NOW,
    );
    expect(counts).toEqual({});
  });

  it('counts a multi-track purchase once per track', () => {
    const counts = computeRecentSalesByTrack(
      [{ track_ids: ['t1', 't2'], created_at: new Date(NOW - 1 * DAY).toISOString() }],
      7 * DAY,
      NOW,
    );
    expect(counts).toEqual({ t1: 1, t2: 1 });
  });

  it('sums multiple purchases of the same track', () => {
    const counts = computeRecentSalesByTrack(
      [
        { track_ids: ['t1'], created_at: new Date(NOW - 1 * DAY).toISOString() },
        { track_ids: ['t1'], created_at: new Date(NOW - 3 * DAY).toISOString() },
      ],
      7 * DAY,
      NOW,
    );
    expect(counts).toEqual({ t1: 2 });
  });

  it('ignores null/empty track_ids and unparseable dates', () => {
    const counts = computeRecentSalesByTrack(
      [
        { track_ids: null, created_at: new Date(NOW - 1 * DAY).toISOString() },
        { track_ids: [], created_at: new Date(NOW - 1 * DAY).toISOString() },
        { track_ids: ['t1'], created_at: 'not-a-date' },
      ],
      7 * DAY,
      NOW,
    );
    expect(counts).toEqual({});
  });

  it('treats the exact cutoff boundary as included (inclusive window)', () => {
    const counts = computeRecentSalesByTrack(
      [{ track_ids: ['t1'], created_at: new Date(NOW - 7 * DAY).toISOString() }],
      7 * DAY,
      NOW,
    );
    expect(counts).toEqual({ t1: 1 });
  });
});
