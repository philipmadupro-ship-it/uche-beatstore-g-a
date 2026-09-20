import { describe, it, expect } from 'vitest';
import { planOfflineEviction, OFFLINE_CACHE_MAX_BYTES, type OfflineCacheEntry } from './eviction';

const GB = 1024 * 1024 * 1024;

describe('planOfflineEviction', () => {
  it('evicts nothing when comfortably under the cap', () => {
    const existing: OfflineCacheEntry[] = [
      { id: 'a', size: 10 * 1024 * 1024, cached_at: 1 },
      { id: 'b', size: 10 * 1024 * 1024, cached_at: 2 },
    ];
    expect(planOfflineEviction(existing, 10 * 1024 * 1024)).toEqual([]);
  });

  it('evicts nothing when the new total lands exactly on the cap', () => {
    const existing: OfflineCacheEntry[] = [{ id: 'a', size: 1 * GB, cached_at: 1 }];
    expect(planOfflineEviction(existing, 1 * GB, 2 * GB)).toEqual([]);
  });

  it('evicts the oldest-SAVED entry first, not the largest or smallest', () => {
    const existing: OfflineCacheEntry[] = [
      { id: 'oldest', size: 0.5 * GB, cached_at: 1 },
      { id: 'middle', size: 0.5 * GB, cached_at: 2 },
      { id: 'newest', size: 0.5 * GB, cached_at: 3 },
    ];
    // Cap 1GB, current total 1.5GB, incoming 0.4GB -> need to free 0.9GB.
    const evicted = planOfflineEviction(existing, 0.4 * GB, 1 * GB);
    expect(evicted).toEqual(['oldest', 'middle']);
  });

  it('evicts only as many of the oldest entries as needed, never more', () => {
    const existing: OfflineCacheEntry[] = [
      { id: 'a', size: 0.3 * GB, cached_at: 1 },
      { id: 'b', size: 0.3 * GB, cached_at: 2 },
      { id: 'c', size: 0.3 * GB, cached_at: 3 },
    ];
    // Cap 1GB, total 0.9GB, incoming 0.2GB -> over by 0.1GB, only oldest needed.
    const evicted = planOfflineEviction(existing, 0.2 * GB, 1 * GB);
    expect(evicted).toEqual(['a']);
  });

  it('never includes the incoming track as a candidate — it is not in `existing`', () => {
    const existing: OfflineCacheEntry[] = [{ id: 'a', size: 0.1 * GB, cached_at: 1 }];
    const evicted = planOfflineEviction(existing, 5 * GB, 1 * GB);
    expect(evicted).not.toContain('incoming');
    expect(evicted).toEqual(['a']);
  });

  it('allows a single incoming save larger than the whole cap through, evicting everything else', () => {
    const existing: OfflineCacheEntry[] = [
      { id: 'a', size: 0.5 * GB, cached_at: 1 },
      { id: 'b', size: 0.5 * GB, cached_at: 2 },
    ];
    // Incoming alone (3GB) already exceeds the 1GB cap — evict everything we
    // can, but the caller still proceeds with the save (see file header).
    const evicted = planOfflineEviction(existing, 3 * GB, 1 * GB);
    expect(evicted.sort()).toEqual(['a', 'b']);
  });

  it('defaults to the documented 2GB cap', () => {
    expect(OFFLINE_CACHE_MAX_BYTES).toBe(2 * GB);
  });

  it('handles an empty cache', () => {
    expect(planOfflineEviction([], 10 * 1024 * 1024)).toEqual([]);
  });
});
