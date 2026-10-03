import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/audio/analyze.server', () => ({ analyzeAudio: vi.fn() }));
vi.mock('@/lib/audio/audd', () => ({ getAuddFeatures: vi.fn() }));
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: vi.fn(), uploadPeaksSidecar: vi.fn(), uploadPublicPreview: vi.fn(),
}));

import { claimableJobFilter, claimJob, STALE_PROCESSING_LOCK_MS, compareAndSet } from './processing';

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
 * PostgREST 12.2 rejects any `or=` filter on a PATCH, so a claim written as
 * one update with `claimableJobFilter` threw on every job and the queue never
 * processed anything. The claim is two plain compare-and-set updates instead.
 */
describe('claimJob', () => {
  type Call = [string, ...unknown[]];
  function fakeAdmin(results: Array<{ data: unknown; error: { message: string } | null }>) {
    const calls: Call[] = [];
    let n = 0;
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['update', 'eq', 'in', 'lt', 'or']) {
      chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
    }
    chain.select = () => Promise.resolve(results[n++] ?? { data: [], error: null });
    const admin = { from: (t: string) => { calls.push(['from', t]); return chain; } };
    return { admin: admin as never, calls };
  }
  const now = Date.parse('2026-10-03T12:00:00.000Z');
  const stamp = new Date(now).toISOString();
  const patch = { status: 'processing', locked_at: stamp, updated_at: stamp };

  it('claims a pending or failed job in one update, without an or filter', async () => {
    const { admin, calls } = fakeAdmin([{ data: [{ id: 'j1' }], error: null }]);
    expect(await claimJob(admin, 'j1', now)).toBe(true);
    expect(calls).toEqual([
      ['from', 'upload_processing_jobs'], ['update', patch], ['eq', 'id', 'j1'], ['in', 'status', ['pending', 'failed']],
    ]);
  });

  it('reclaims a processing job only once its lock is stale', async () => {
    const { admin, calls } = fakeAdmin([{ data: [], error: null }, { data: [{ id: 'j1' }], error: null }]);
    expect(await claimJob(admin, 'j1', now)).toBe(true);
    expect(calls.slice(4)).toEqual([
      ['from', 'upload_processing_jobs'], ['update', patch], ['eq', 'id', 'j1'], ['eq', 'status', 'processing'],
      ['lt', 'locked_at', new Date(now - STALE_PROCESSING_LOCK_MS).toISOString()],
    ]);
  });

  it('gives up when another worker holds a live lock (or the job is done)', async () => {
    const { admin } = fakeAdmin([{ data: [], error: null }, { data: [], error: null }]);
    expect(await claimJob(admin, 'j1', now)).toBe(false);
  });

  it('never sends an or filter on the update', async () => {
    const { admin, calls } = fakeAdmin([{ data: [], error: null }, { data: [], error: null }]);
    await claimJob(admin, 'j1', now);
    expect(calls.some(([m]) => m === 'or')).toBe(false);
  });

  it('throws on a database error rather than reporting "not claimed"', async () => {
    const { admin } = fakeAdmin([{ data: null, error: { message: 'boom' } }]);
    await expect(claimJob(admin, 'j1', now)).rejects.toThrow('Upload processing claim failed: boom');
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

