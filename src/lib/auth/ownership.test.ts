import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the auth gating state machine.
 *
 * `requireRowOwnership` is the linchpin of every owner-gated route — if it
 * silently passes when it shouldn't, every mutation route is broken. The
 * test mocks both the cookie client (for session lookup) and the admin
 * client (for the row read), then walks through every branch:
 *
 *   - no session                → 401
 *   - admin select errors       → 500
 *   - row not found             → 404
 *   - row has user_id != caller → 403
 *   - row has user_id === caller → ok
 *   - row.user_id IS NULL       → 403 (legacy rows must be migrated explicitly)
 */

// --- Mocks ----------------------------------------------------------------
// We replace the two dependencies before importing the SUT so the module's
// internal references pick up our test doubles.

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

// supabase-js is dynamically required inside createServiceClient; mock it
// at the package boundary.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

// Stub env vars the service-role client expects at construction time.
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  mockGetUser.mockReset();
  mockMaybeSingle.mockReset();
});

async function runOwnership() {
  // Import inside the test so mocks apply.
  const { requireRowOwnership } = await import('./ownership');
  return requireRowOwnership('tracks', 'row-123');
}

describe('requireRowOwnership', () => {
  it('returns 401 when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const r = await runOwnership();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.res.status).toBe(401);
      const body = await r.res.json();
      expect(body.error).toMatch(/auth/i);
    }
  });

  it('returns 500 when the row lookup errors', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const r = await runOwnership();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.res.status).toBe(500);
      const body = await r.res.json();
      expect(body.error).toBe('db down');
    }
  });

  it('returns 404 when the row does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await runOwnership();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(404);
  });

  it('returns 403 when row.user_id differs from caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    mockMaybeSingle.mockResolvedValue({ data: { user_id: 'u-2' }, error: null });
    const r = await runOwnership();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.res.status).toBe(403);
      const body = await r.res.json();
      expect(body.error).toMatch(/forbidden/i);
    }
  });

  it('grants access when row.user_id matches caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    mockMaybeSingle.mockResolvedValue({ data: { user_id: 'u-1' }, error: null });
    const r = await runOwnership();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.userId).toBe('u-1');
      expect(r.admin).toBeDefined();
    }
  });

  it('rejects legacy null-owner rows', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    mockMaybeSingle.mockResolvedValue({ data: { user_id: null }, error: null });
    const r = await runOwnership();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });
});

describe('requireUser', () => {
  it('returns 401 when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { requireUser } = await import('./ownership');
    const r = await requireUser();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it('returns admin + userId for an authenticated caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    const { requireUser } = await import('./ownership');
    const r = await requireUser();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.userId).toBe('u-1');
      expect(r.admin).toBeDefined();
    }
  });
});
