import { describe, expect, it } from 'vitest';
import { deliverExpectation, latestApprovalIds, releaseItemsKey, storeExpectation } from './release-fingerprint';

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe('releaseItemsKey', () => {
  it('orders by position then id and lower-cases', () => {
    const key = releaseItemsKey([
      { id: U(2), position: 2, song_track_id: 'AA', master_track_id: 'BB' },
      { id: U(1), position: 1, song_track_id: 'CC', master_track_id: 'DD' },
      { id: U(3), position: 1, song_track_id: 'EE', master_track_id: 'FF' },
    ]);
    expect(key).toBe('cc:dd,ee:ff,aa:bb');
  });
  it('is empty for no items', () => expect(releaseItemsKey([])).toBe(''));
});

describe('latestApprovalIds', () => {
  it('picks the newest row per gate and leaves the rest empty', () => {
    const out = latestApprovalIds([
      { id: U(1), gate: 'master', created_at: '2026-01-01T00:00:00Z' },
      { id: U(2), gate: 'master', created_at: '2026-01-02T00:00:00Z' },
      { id: U(3), gate: 'legal', created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(out).toEqual({ master: U(2), artwork: '', legal: U(3), marketing: '', metadata: '' });
  });
});

describe('expectations', () => {
  it('keeps the raw updated_at string untouched', () => {
    const raw = '2026-11-01T10:00:00.123456+00:00';
    const e = deliverExpectation({ updatedAt: raw, items: '', approvals: latestApprovalIds([]) });
    expect(e.release_updated_at).toBe(raw);
  });
  it('carries the listing facts', () => {
    expect(storeExpectation({ state: 'delivered', imported_released: false, release_date: null, store_listed: false }, 'a:b')).toEqual({
      state: 'delivered', imported_released: false, release_date: null, store_listed: false, items: 'a:b',
    });
  });
});
