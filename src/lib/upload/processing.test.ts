import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/audio/analyze.server', () => ({ analyzeAudio: vi.fn() }));
vi.mock('@/lib/audio/audd', () => ({ getAuddFeatures: vi.fn() }));
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: vi.fn(), uploadPeaksSidecar: vi.fn(), uploadPublicPreview: vi.fn(),
}));

import { claimableJobFilter, STALE_PROCESSING_LOCK_MS, compareAndSet } from './processing';

describe('claimableJobFilter', () => {
  it('claims pending and failed jobs', () => {
    expect(claimableJobFilter(0)).toContain('status.in.(pending,failed)');
  });

  it('reclaims a processing job only once its lock is stale', () => {
    const now = Date.parse('2026-09-17T12:00:00.000Z');
    const cutoff = new Date(now - STALE_PROCESSING_LOCK_MS).toISOString();
    expect(claimableJobFilter(now)).toBe(
      `status.in.(pending,failed),and(status.eq.processing,locked_at.lt.${cutoff})`,
    );
  });

  it('keeps the stale window longer than the 300s function ceiling', () => {
    expect(STALE_PROCESSING_LOCK_MS).toBeGreaterThan(300_000);
  });
});

/**
 * The background pass must not undo a value the producer set after upload
 * (one click in the uploads tray, or the track drawer).
 */
describe('compareAndSet', () => {
  type Call = [string, ...unknown[]];
  function fakeAdmin(rows: Array<{ id: string }>) {
    const calls: Call[] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['update', 'eq', 'is']) {
      chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
    }
    chain.select = () => Promise.resolve({ data: rows, error: null });
    const admin = { from: (t: string) => { calls.push(['from', t]); return chain; } };
    return { admin: admin as never, calls };
  }
  const job = { track_id: 't1', user_id: 'u1' };

  it('writes only where the row still holds what upload wrote', async () => {
    const { admin, calls } = fakeAdmin([{ id: 't1' }]);
    expect(await compareAndSet(admin, job, { bpm: 97 }, { bpm: 140 })).toBe(true);
    expect(calls).toEqual([
      ['from', 'tracks'], ['update', { bpm: 97 }], ['eq', 'id', 't1'], ['eq', 'user_id', 'u1'], ['eq', 'bpm', 140],
    ]);
  });

  it('matches a null expectation with IS NULL', async () => {
    const { admin, calls } = fakeAdmin([{ id: 't1' }]);
    await compareAndSet(admin, job, { key: 'F', scale: 'minor' }, { key: null, scale: null });
    expect(calls).toContainEqual(['is', 'key', null]);
    expect(calls).toContainEqual(['is', 'scale', null]);
  });

  it('reports a kept value when the producer changed it in between', async () => {
    const { admin } = fakeAdmin([]);
    expect(await compareAndSet(admin, job, { bpm: 97 }, { bpm: 140 })).toBe(false);
  });

  it('skips the query when nothing would change', async () => {
    const { admin, calls } = fakeAdmin([]);
    expect(await compareAndSet(admin, job, { bpm: 140 }, { bpm: 140 })).toBe(true);
    expect(calls).toEqual([]);
  });
});

