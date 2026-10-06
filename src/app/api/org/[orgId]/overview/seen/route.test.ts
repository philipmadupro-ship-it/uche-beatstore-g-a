/**
 * POST /api/org/[orgId]/overview/seen (LABEL-20): the member marks the
 * Overview digest seen through an instant. Only the SESSION's own
 * user_profiles row moves, only forward, never past now.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const NO_CAT = u(3);
const STRANGER = u(4);

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mem.client.from(t) }) }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], revokes: string[] = []) => ({
  org_id: L, user_id: user, role, functions, scope: 'org', cap_grants: [], cap_revokes: revokes,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }],
      org_members: [member(OWN, 'owner'), member(AR, 'member', ['a_and_r']), member(NO_CAT, 'member', ['marketing'], ['catalog.read'])],
      user_profiles: [
        { user_id: OWN, display_name: 'Olive', last_seen_overview_at: '2026-10-01T00:00:00.000Z' },
        { user_id: AR, display_name: 'Ana', last_seen_overview_at: '2026-10-02T00:00:00.000Z' },
      ],
    },
    unique: { user_profiles: [['user_id']] },
  };
  mem = memoryAdmin(db);
});

async function seen(body: unknown, org = L) {
  const { POST } = await import('./route');
  return POST(
    new NextRequest(`http://x/api/org/${org}/overview/seen`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ orgId: org }) },
  );
}
const stored = (user: string) => db.tables.user_profiles.find((r) => r.user_id === user)?.last_seen_overview_at;

describe('POST /api/org/[orgId]/overview/seen', () => {
  const through = new Date(Date.now() - 60_000).toISOString();

  it('moves the caller’s own mark forward, and nobody else’s', async () => {
    current = OWN;
    const res = await seen({ through });
    expect(res.status).toBe(200);
    expect((await res.json()).lastSeenAt).toBe(through);
    expect(stored(OWN)).toBe(through);
    expect(stored(AR)).toBe('2026-10-02T00:00:00.000Z');
  });

  it('cannot be aimed at another user: a user_id in the body is refused', async () => {
    current = OWN;
    expect((await seen({ through, user_id: AR })).status).toBe(400);
    expect(stored(AR)).toBe('2026-10-02T00:00:00.000Z');
  });

  it('never moves the mark back, and never past now', async () => {
    current = AR;
    await seen({ through: '2026-09-01T00:00:00.000Z' });
    expect(stored(AR)).toBe('2026-10-02T00:00:00.000Z');
    const res = await seen({ through: '2999-01-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(Date.parse(stored(AR) as string)).toBeLessThanOrEqual(Date.now());
  });

  it('creates the profile row for a member who has none', async () => {
    db.tables.user_profiles = [];
    current = OWN;
    expect((await seen({ through })).status).toBe(200);
    expect(db.tables.user_profiles).toEqual([expect.objectContaining({ user_id: OWN, last_seen_overview_at: through })]);
  });

  it('rejects a missing or malformed instant', async () => {
    current = OWN;
    expect((await seen({})).status).toBe(400);
    expect((await seen({ through: 'now' })).status).toBe(400);
  });

  it('401 without a session, 403 for a stranger and for a member without catalog.read', async () => {
    current = null;
    expect((await seen({ through })).status).toBe(401);
    current = STRANGER;
    expect((await seen({ through })).status).toBe(403);
    current = NO_CAT;
    expect((await seen({ through })).status).toBe(403);
    expect(db.tables.user_profiles).toHaveLength(2);
  });
});
