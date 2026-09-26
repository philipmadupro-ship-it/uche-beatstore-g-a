import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockRequireProducer = vi.fn();
const mockConfigured = vi.fn();
vi.mock('@/lib/auth/ownership', () => ({ requireProducer: () => mockRequireProducer() }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => mockConfigured() }));

import { authorizeStemJob, isValidJobId, isValidStemName } from './authorize';

function admin(stemTrackId: string | null, ownerId: string | null) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        in: () => q,
        eq: () => q,
        limit: async () => ({ data: stemTrackId ? [{ track_id: stemTrackId }] : [] }),
        maybeSingle: async () => ({ data: table === 'tracks' ? { user_id: ownerId } : null }),
      };
      return q;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigured.mockReturnValue(true);
});

describe('stem reference validation', () => {
  it('accepts backend job ids and rejects path injection', () => {
    expect(isValidJobId('demucs:abc-123')).toBe(true);
    expect(isValidJobId('abc_123')).toBe(true);
    expect(isValidJobId('../jobs/x')).toBe(false);
    expect(isValidJobId('a%2F..')).toBe(false);
    expect(isValidJobId('a?x=1')).toBe(false);
  });
  it('allowlists stem names', () => {
    expect(isValidStemName('vocals')).toBe(true);
    expect(isValidStemName('../../admin')).toBe(false);
  });
});

describe('authorizeStemJob', () => {
  it('401s an anonymous caller', async () => {
    mockRequireProducer.mockResolvedValue({ ok: false, res: NextResponse.json({}, { status: 401 }) });
    expect((await authorizeStemJob('job-1'))?.status).toBe(401);
  });
  it('403s a signed-in buyer (no producer profile)', async () => {
    mockRequireProducer.mockResolvedValue({ ok: false, res: NextResponse.json({}, { status: 403 }) });
    expect((await authorizeStemJob('job-1'))?.status).toBe(403);
  });
  it('403s another producer', async () => {
    mockRequireProducer.mockResolvedValue({ ok: true, userId: 'u-other', admin: admin('t1', 'u-owner') });
    expect((await authorizeStemJob('job-1'))?.status).toBe(403);
  });
  it('403s a null-owner track (owner-only, mig 097)', async () => {
    mockRequireProducer.mockResolvedValue({ ok: true, userId: 'u-owner', admin: admin('t1', null) });
    expect((await authorizeStemJob('job-1'))?.status).toBe(403);
  });
  it('allows the owner', async () => {
    mockRequireProducer.mockResolvedValue({ ok: true, userId: 'u-owner', admin: admin('t1', 'u-owner') });
    expect(await authorizeStemJob('job-1')).toBeNull();
  });
});
