/**
 * The bell under an org (LABEL-23): a member reads and clears ONLY their own
 * notifications of THIS org. Real lib/auth/org-access against an in-memory
 * database that evaluates filters, so a leak (another member's row, another
 * org's, the producer's own) is a failing assertion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = u(1);
const PEER = u(2);
const BOTH = u(3); // a member of L and L2
const STRANGER = u(4);
const n = (k: number) => `80000000-0000-4000-8000-${String(k).padStart(12, '0')}`;

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, org = L) => ({ org_id: org, user_id: user, role: 'member', functions: ['a_and_r'], scope: 'org', cap_grants: [], cap_revokes: [] });
const note = (id: string, user: string, org: string | null, title: string, read = false, at = '2026-10-01T10:00:00Z') => ({
  id, user_id: user, org_id: org, kind: org ? 'task_assigned' : 'purchase', title, body: null, data: null, read, created_at: at,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [member(ME), member(PEER), member(BOTH), member(BOTH, L2)],
      notifications: [
        note(n(1), ME, L, 'mine in L', false, '2026-10-01T10:00:00Z'),
        note(n(2), ME, L, 'mine in L, read', true, '2026-10-01T11:00:00Z'),
        note(n(3), PEER, L, 'peer in L'),
        note(n(4), BOTH, L2, 'both in L2'),
        note(n(5), BOTH, L, 'both in L'),
        note(n(6), ME, null, 'a producer purchase'),
      ],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) => Promise<Response>;
async function call(method: 'GET' | 'PATCH', as: string | null, org: string, query = '', body?: unknown) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/notifications${query}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return mod[method](req, { params: Promise.resolve({ orgId: org }) });
}
const read = (id: string) => db.tables.notifications.find((r) => r.id === id)!.read;

describe('GET', () => {
  it('returns my notifications of this org, newest first, with the true unread count', async () => {
    const res = await call('GET', ME, L);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications.map((x: { title: string }) => x.title)).toEqual(['mine in L, read', 'mine in L']);
    expect(body.unread).toBe(1);
    expect(body.hasMore).toBe(false);
    // Another member's row, another org's and the producer's own notification never appear.
    expect(JSON.stringify(body)).not.toMatch(/peer in L|both in|producer purchase/);
    expect(Object.keys(body.notifications[0]).sort()).toEqual(['body', 'created_at', 'data', 'id', 'kind', 'read', 'title']);
  });

  it('a member of two orgs sees each org\'s own under the active org', async () => {
    expect((await (await call('GET', BOTH, L)).json()).notifications.map((x: { title: string }) => x.title)).toEqual(['both in L']);
    expect((await (await call('GET', BOTH, L2)).json()).notifications.map((x: { title: string }) => x.title)).toEqual(['both in L2']);
  });

  it('refuses a non-member, a member of another org and a signed-out caller', async () => {
    expect((await call('GET', STRANGER, L)).status).toBe(403);
    expect((await call('GET', ME, L2)).status).toBe(403);
    expect((await call('GET', null, L)).status).toBe(401);
  });

  it('a removed member reads nothing at all', async () => {
    db.tables.org_members = db.tables.org_members.filter((m) => !(m.user_id === ME && m.org_id === L));
    expect((await call('GET', ME, L)).status).toBe(403);
  });

  it('says when the list is only a page', async () => {
    for (let k = 0; k < 25; k += 1) db.tables.notifications.push(note(n(100 + k), ME, L, `bulk ${k}`, false, `2026-10-02T10:${String(k).padStart(2, '0')}:00Z`));
    const body = await (await call('GET', ME, L)).json();
    expect(body.notifications).toHaveLength(20);
    expect(body.hasMore).toBe(true);
    expect(body.unread).toBe(26);
  });
});

describe('PATCH', () => {
  it('?action=read marks only the ids named, of mine, in this org', async () => {
    const res = await call('PATCH', ME, L, '?action=read', { ids: [n(1), n(3), n(4), n(6)] });
    expect(res.status).toBe(200);
    expect(read(n(1))).toBe(true);
    // Someone else's row, another org's row and the producer's own are untouched, whatever the ids.
    expect([read(n(3)), read(n(4)), read(n(5)), read(n(6))]).toEqual([false, false, false, false]);
  });

  it('?action=read_all clears my unread rows of this org — not the producer bell, not another org', async () => {
    expect((await call('PATCH', BOTH, L, '?action=read_all')).status).toBe(200);
    expect(read(n(5))).toBe(true);
    expect([read(n(4)), read(n(1)), read(n(3)), read(n(6))]).toEqual([false, false, false, false]);
  });

  it('refuses a non-member without touching a row, and rejects an unknown action or a junk body', async () => {
    expect((await call('PATCH', STRANGER, L, '?action=read_all')).status).toBe(403);
    expect((await call('PATCH', null, L, '?action=read_all')).status).toBe(401);
    expect((await call('PATCH', ME, L, '?action=wipe')).status).toBe(400);
    expect((await call('PATCH', ME, L, '?action=read', { ids: 'nope' })).status).toBe(400);
    expect((await call('PATCH', ME, L, '?action=read', { ids: ['not-a-uuid'] })).status).toBe(200); // nothing valid to do
    expect(db.tables.notifications.filter((r) => r.read === true).map((r) => r.id)).toEqual([n(2)]);
  });
});
