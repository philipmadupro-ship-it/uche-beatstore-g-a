import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/audio/analyze.server', () => ({ analyzeAudio: vi.fn() }));
vi.mock('@/lib/audio/audd', () => ({ getAuddFeatures: vi.fn() }));
vi.mock('@/lib/audio/peaks', () => ({ extractPeaks: vi.fn() }));
vi.mock('@/lib/storage/upload', () => ({
  readStoredObject: vi.fn(), uploadPeaksSidecar: vi.fn(), uploadPublicPreview: vi.fn(),
}));

import { claimableJobFilter, STALE_PROCESSING_LOCK_MS } from './processing';

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
