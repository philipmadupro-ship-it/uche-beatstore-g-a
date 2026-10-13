/**
 * The hard-delete cron (LABEL-39, D10): the secret guard, which orgs it
 * touches, the order (objects, then rows), what a failure leaves behind, and
 * that running it twice is harmless. The cascade itself — that deleting the
 * organization row leaves no row of the org and none of anyone else's — is
 * proven on a real database in supabase/local/checks/labelos_org_hard_delete.sql.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const A = '10000000-0000-4000-8000-00000000000a'; // deleted 31 days ago: due
const B = '10000000-0000-4000-8000-00000000000b'; // deleted 3 days ago: still in grace
const C = '10000000-0000-4000-8000-00000000000c'; // live
const D = '10000000-0000-4000-8000-00000000000d'; // deleted 90 days ago: due, objects stuck
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let configured = true;
const deleteOrgObjects = vi.fn<(orgId: string) => Promise<number>>();

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => configured }));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => mem.client }));
vi.mock('@/lib/storage/org-objects', () => ({ deleteOrgObjects: (id: string) => deleteOrgObjects(id) }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const request = (secret?: string) =>
  new NextRequest('http://localhost/api/cron/purge-deleted-orgs', { headers: secret ? { authorization: `Bearer ${secret}` } : undefined });

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  configured = true;
  db = {
    tables: {
      organizations: [
        { id: A, name: 'A', slug: 'a', kind: 'label', deleted_at: daysAgo(31) },
        { id: B, name: 'B', slug: 'b', kind: 'label', deleted_at: daysAgo(3) },
        { id: C, name: 'C', slug: 'c', kind: 'label', deleted_at: null },
        { id: D, name: 'D', slug: 'd', kind: 'label', deleted_at: daysAgo(90) },
      ],
    },
  };
  mem = memoryAdmin(db);
  deleteOrgObjects.mockReset();
  deleteOrgObjects.mockResolvedValue(7);
});

const { GET } = await import('./route');
const ids = () => db.tables.organizations.map((o) => o.id);

describe('GET /api/cron/purge-deleted-orgs', () => {
  it('rejects a request without the secret, and a server without one', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('wrong'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request('cron-secret'))).status).toBe(500);
    expect(deleteOrgObjects).not.toHaveBeenCalled();
    expect(ids()).toHaveLength(4);
  });

  it('skips quietly without Supabase', async () => {
    configured = false;
    expect(await (await GET(request('cron-secret'))).json()).toEqual({ skipped: 'Supabase not configured' });
    expect(ids()).toHaveLength(4);
  });

  it('purges the orgs past their grace period, oldest first, and no one else', async () => {
    const res = await GET(request('cron-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ due: 2, purged: 2, kept: [] });
    expect(deleteOrgObjects.mock.calls.map((c) => c[0])).toEqual([D, A]);
    expect(ids()).toEqual([B, C]);
  });

  it('deletes the objects of an org before its row', async () => {
    deleteOrgObjects.mockImplementation(async (id: string) => {
      expect(ids()).toContain(id);
      return 1;
    });
    await GET(request('cron-secret'));
    expect(ids()).not.toContain(A);
  });

  it('keeps an org whose objects could not be deleted, reports it, and carries on with the rest', async () => {
    deleteOrgObjects.mockImplementation(async (id: string) => {
      if (id === D) throw new Error('AccessDenied');
      return 2;
    });
    const body = await (await GET(request('cron-secret'))).json();
    expect(body.purged).toBe(1);
    expect(body.kept).toEqual([{ orgId: D, reason: expect.stringContaining('AccessDenied') }]);
    expect(ids()).toEqual([B, C, D]);
  });

  it('is idempotent: the second run finds nothing', async () => {
    await GET(request('cron-secret'));
    deleteOrgObjects.mockClear();
    expect(await (await GET(request('cron-secret'))).json()).toMatchObject({ due: 0, purged: 0 });
    expect(deleteOrgObjects).not.toHaveBeenCalled();
    expect(ids()).toEqual([B, C]);
  });

  it('purges at most five orgs a run', async () => {
    for (let i = 0; i < 8; i += 1) db.tables.organizations.push({ id: `x${i}`, name: 'x', slug: `x${i}`, kind: 'label', deleted_at: daysAgo(100 + i) });
    expect((await (await GET(request('cron-secret'))).json()).purged).toBe(5);
    expect(ids().filter((id) => String(id).startsWith('x'))).toHaveLength(3);
  });

  it('is a no-op where the Label OS tables do not exist yet', async () => {
    mem = { ...mem, client: { from: () => { throw new Error('relation "public.organizations" does not exist'); }, rpc: mem.client.rpc } } as typeof mem;
    expect(await (await GET(request('cron-secret'))).json()).toEqual({ skipped: 'Label OS migrations are not applied' });
  });
});
