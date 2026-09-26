/**
 * A creator_profiles row is what makes an account "the producer". Buyers share
 * the same Supabase auth, so the profile write must never create a second row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockUpsert = vi.fn();
let existingRow: { user_id: string } | null = null;
let rowCount = 0;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockGetUser() } }),
}));
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  createServiceClient: () => ({
    from: () => ({
      select: (_c: string, opts?: { head?: boolean }) =>
        opts?.head
          ? Promise.resolve({ count: rowCount, error: null })
          : { eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) },
      upsert: (row: unknown) => {
        mockUpsert(row);
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
    }),
  }),
}));
vi.mock('@/lib/local-store', () => ({ getAll: () => [], insert: vi.fn(), update: vi.fn() }));

import { updateCreatorProfile } from './profile';

beforeEach(() => {
  vi.clearAllMocks();
  existingRow = null;
  rowCount = 0;
});

describe('updateCreatorProfile', () => {
  it('refuses to create a profile for a buyer once a producer exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'buyer-1' } } });
    rowCount = 1;
    const res = await updateCreatorProfile({ display_name: 'me' });
    expect(res.error).toBe('Producer account required');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('lets the existing producer update their own row', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'producer-1' } } });
    existingRow = { user_id: 'producer-1' };
    rowCount = 1;
    const res = await updateCreatorProfile({ display_name: 'U2C' });
    expect(res.error).toBeUndefined();
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'producer-1', display_name: 'U2C' }));
  });

  it('bootstraps the first producer on a fresh install', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'producer-1' } } });
    const res = await updateCreatorProfile({ display_name: 'U2C' });
    expect(res.error).toBeUndefined();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
