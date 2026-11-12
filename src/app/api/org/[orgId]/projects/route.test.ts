/**
 * GET /api/org/[orgId]/projects (LABEL-50), through the REAL lib/auth/org-access
 * against an in-memory database: two label orgs. The list is names and ids of
 * the org's own projects, for members who may invite outsiders to one and who
 * see the whole org; an artist's Inbox is not offered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const OWN = '20000000-0000-4000-8000-000000000001';
const SCOPED = '20000000-0000-4000-8000-000000000002';
const MKT = '20000000-0000-4000-8000-000000000003';
const X = '20000000-0000-4000-8000-000000000004';
const C1 = '30000000-0000-4000-8000-0000000000c1';

let current: string | null = null;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (org: string, user: string, role: string, functions: string[] = [], scope = 'org') => ({
  org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  const db: MemoryDb = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null },
        { id: L2, kind: 'label', deleted_at: null },
      ],
      org_members: [
        member(L, OWN, 'owner'),
        member(L, SCOPED, 'admin', [], 'artists'),
        member(L, MKT, 'member', ['marketing']),
        member(L2, X, 'owner'),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SCOPED, contact_id: C1 }],
      projects: [
        { id: 'p-b', org_id: L, user_id: null, name: 'Beta', inbox_for_contact_id: null },
        { id: 'p-a', org_id: L, user_id: null, name: 'Alpha', inbox_for_contact_id: null },
        { id: 'p-inbox', org_id: L, user_id: null, name: 'Inbox', inbox_for_contact_id: C1 },
        { id: 'p-other', org_id: L2, user_id: null, name: 'Elsewhere', inbox_for_contact_id: null },
      ],
      activity_events: [],
    },
    unique: {},
    rpc: {},
  };
  mem = memoryAdmin(db);
});

async function list(as: string | null, org = L) {
  current = as;
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://app.test/api/org/${org}/projects`), { params: Promise.resolve({ orgId: org }) });
  return { status: res.status, json: (await res.json()) as { projects?: { id: string; name: string }[] } };
}

describe('GET /api/org/[orgId]/projects', () => {
  it('lists the org\'s own projects by name, without an artist\'s Inbox or another org\'s', async () => {
    const r = await list(OWN);
    expect(r.status).toBe(200);
    expect(r.json.projects).toEqual([{ id: 'p-a', name: 'Alpha' }, { id: 'p-b', name: 'Beta' }]);
  });

  it('needs share.external: a marketing member is refused', async () => {
    expect([403, 404]).toContain((await list(MKT)).status);
  });

  it('is not a way around artist scope: an admin limited to some artists is refused', async () => {
    expect((await list(SCOPED)).status).toBe(403);
  });

  it('answers a stranger, another org\'s owner and a signed-out caller the same as any org route', async () => {
    expect([403, 404]).toContain((await list(X)).status);
    expect(await list(null).then((r) => r.status)).toBe(401);
  });
});
