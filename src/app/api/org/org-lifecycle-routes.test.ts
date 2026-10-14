/**
 * LABEL-39's owner-only routes, run through the REAL lib/auth/org-access and
 * the real route code against an in-memory database: DELETE /api/org/[orgId]
 * (start the 30-day grace period), GET …/export, POST …/restore. Storage,
 * the rate limiter and the audit write's failure are the only fakes.
 *
 * The cast: OWNER owns org L (a label) and was signed in a minute ago unless
 * a test says otherwise; ADMIN holds every capability but is not an owner;
 * STRANGER is nobody. L2 is another org with its own owner.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const PO = '10000000-0000-4000-8000-000000000003'; // a producer-kind org
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = u(1);
const ADMIN = u(2);
const STRANGER = u(3);
const OWNER2 = u(4);
const P1 = '40000000-0000-4000-8000-0000000000a1';
const S1 = '50000000-0000-4000-8000-000000000001';

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

let current: string | null = null;
let signedInAt: string | null = null;
let auditFails = false;
let rateOk = true;
let storedFails = false;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test`, last_sign_in_at: signedInAt } : null } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => rateOk, clientIp: () => '127.0.0.1', rateLimit: () => true }));
vi.mock('@/lib/storage/org-objects', () => ({
  listOrgObjects: async (orgId: string) => {
    if (storedFails) throw new Error('bucket unreachable');
    return [{ key: `orgs/${orgId}/tracks/a.wav`, size: 3, lastModified: '2026-10-01T00:00:00.000Z' }];
  },
  // LABEL-42: the previews promoted to the public store for the org's releases are listed in the manifest too.
  orgReleaseIds: async (_admin: unknown, orgId: string) => (db.tables.releases ?? []).filter((r) => r.org_id === orgId).map((r) => r.id as string),
  listStoreReleaseObjects: async (ids: readonly string[]) => ids.map((id) => ({ key: `store-releases/${id}/t1`, size: 3, lastModified: '2026-10-02T00:00:00.000Z' })),
}));
vi.mock('@/lib/labelos/activity', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/labelos/activity')>();
  return {
    ...actual,
    recordEvent: async (...args: Parameters<typeof actual.recordEvent>) => {
      if (auditFails) throw new actual.AuditEventError(String(args[2]), 'refused');
      return actual.recordEvent(...args);
    },
  };
});

function seed(): MemoryDb {
  return {
    tables: {
      organizations: [
        { id: L, name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null, settings: {}, created_at: '2026-01-01' },
        { id: L2, name: 'Other Label', slug: 'other-label', kind: 'label', deleted_at: null, settings: {}, created_at: '2026-01-01' },
        { id: PO, name: 'Studio', slug: 'studio', kind: 'producer', deleted_at: null, settings: {}, created_at: '2026-01-01' },
      ],
      org_members: [
        { org_id: L, user_id: OWNER, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: L, user_id: ADMIN, role: 'admin', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: L2, user_id: OWNER2, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: PO, user_id: OWNER, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
      ],
      org_invitations: [{ id: 'i1', org_id: L, email: 'x@local.test', role: 'member', token_hash: 'TOPSECRET', functions: [], expires_at: '2099-01-01', created_at: '2026-01-01' }],
      member_artist_scopes: [],
      contacts: [{ id: 'c1', org_id: L, user_id: null, name: '=cmd|calc', category: 'artist' }],
      projects: [{ id: P1, org_id: L, user_id: null, name: 'EP' }],
      tracks: [{ id: S1, org_id: L, user_id: null, title: 'Midnight', type: 'song', audio_url: `r2://priv/orgs/${L}/tracks/a.wav` }],
      project_tracks: [{ project_id: P1, track_id: S1, position: 0 }],
      project_contacts: [],
      project_assets: [],
      project_comments: [],
      project_members: [],
      track_links: [],
      song_beats: [],
      track_tags: [],
      stems: [],
      song_reviews: [],
      releases: [],
      release_items: [],
      tasks: [],
      activity_events: [],
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = OWNER;
  signedInAt = minutesAgo(1);
  auditFails = false;
  rateOk = true;
  storedFails = false;
  db = seed();
  mem = memoryAdmin(db);
});

const orgRoute = await import('./[orgId]/route');
const exportRoute = await import('./[orgId]/export/route');
const restoreRoute = await import('./[orgId]/restore/route');
const membersRoute = await import('./[orgId]/members/route');

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const del = (orgId: string, body: unknown = { confirmName: 'Night Shift' }) =>
  orgRoute.DELETE(new NextRequest(`https://app.test/api/org/${orgId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx(orgId));
const exp = (orgId: string, query = '') => exportRoute.GET(new NextRequest(`https://app.test/api/org/${orgId}/export${query}`), ctx(orgId));
const restoreInfo = (orgId: string) => restoreRoute.GET(new NextRequest(`https://app.test/api/org/${orgId}/restore`), ctx(orgId));
const restore = (orgId: string) => restoreRoute.POST(new NextRequest(`https://app.test/api/org/${orgId}/restore`, { method: 'POST' }), ctx(orgId));
const orgRow = (id: string) => db.tables.organizations.find((o) => o.id === id)!;
const events = (verb?: string) => db.tables.activity_events.filter((e) => !verb || e.verb === verb);

describe('DELETE /api/org/[orgId] — start the grace period', () => {
  it('signed out is 401', async () => {
    current = null;
    expect((await del(L)).status).toBe(401);
  });

  it.each([['an admin', ADMIN], ['a stranger', STRANGER], ['another org’s owner', OWNER2]])('%s is refused and nothing changes', async (_n, user) => {
    current = user;
    expect((await del(L)).status).toBe(403);
    expect(orgRow(L).deleted_at).toBeNull();
    expect(mem.writes).toEqual([]);
  });

  it('an owner whose sign-in is stale is sent to sign in again, and nothing changes', async () => {
    signedInAt = minutesAgo(45);
    const res = await del(L);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ requiresReauth: true });
    expect(orgRow(L).deleted_at).toBeNull();
    signedInAt = null;
    expect((await del(L)).status).toBe(403);
    expect(mem.writes).toEqual([]);
  });

  it('needs the org’s name typed exactly', async () => {
    for (const confirmName of ['', 'night shift', 'Night', 'Other Label']) {
      expect((await del(L, { confirmName })).status, confirmName).toBe(400);
    }
    expect((await del(L, {})).status).toBe(400);
    expect(orgRow(L).deleted_at).toBeNull();
    expect(mem.writes).toEqual([]);
  });

  it('will not delete the producer’s own org', async () => {
    const res = await del(PO, { confirmName: 'Studio' });
    expect(res.status).toBe(409);
    expect(orgRow(PO).deleted_at).toBeNull();
  });

  it('stamps deleted_at, records the audit event, and returns when it will be purged', async () => {
    const res = await del(L, { confirmName: '  Night   Shift ' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(orgRow(L).deleted_at).toBe(body.deletedAt);
    expect(new Date(body.purgeAfter).getTime() - new Date(body.deletedAt).getTime()).toBe(30 * 86_400_000);
    expect(body.restoreUrl).toBe(`/restore/${L}`);
    expect(events('org.deletion_scheduled')).toHaveLength(1);
    expect(events('org.deletion_scheduled')[0]).toMatchObject({ org_id: L, actor_id: OWNER, audit: true, visibility: 'internal' });
  });

  it('touches no other org, no producer row and no catalogue row: only the org row and one event', async () => {
    await del(L);
    expect(mem.writes.map((w) => `${w.table}:${w.op}`)).toEqual(['organizations:update', 'activity_events:insert']);
    expect(orgRow(L2).deleted_at).toBeNull();
    expect(db.tables.tracks).toHaveLength(1);
    expect(db.tables.projects).toHaveLength(1);
  });

  it('puts the org back when the audit event cannot be written', async () => {
    auditFails = true;
    const res = await del(L);
    expect(res.status).toBe(500);
    expect(orgRow(L).deleted_at).toBeNull();
  });

  it('a second delete of the same org is 404 (it is gone already)', async () => {
    expect((await del(L)).status).toBe(200);
    expect((await del(L)).status).toBe(404);
  });

  it('after it, every org route treats the org as gone — for the owner too', async () => {
    await del(L);
    const members = await membersRoute.GET(new NextRequest(`https://app.test/api/org/${L}/members`), ctx(L));
    expect([403, 404]).toContain(members.status);
    expect((await exp(L)).status).toBe(404);
    // …and the sign-in page for it (orgShellFor) finds no live org.
    const { orgShellFor } = await import('@/lib/auth/org-access');
    expect(await orgShellFor('night-shift')).toBeNull();
    const { myOrganizations } = await import('@/lib/auth/org-access');
    const mine = await myOrganizations();
    expect(mine.ok && mine.orgs.map((o) => o.id)).toEqual([PO]);
    // The owner is told it can be brought back, and until when.
    expect(mine.ok && mine.pendingDeletion.map((p) => p.id)).toEqual([L]);
    expect(mine.ok && new Date(mine.pendingDeletion[0].purgeAfter).getTime()).toBe(new Date(orgRow(L).deleted_at as string).getTime() + 30 * 86_400_000);
  });

  it('only an owner is offered the restore, and only inside the grace period', async () => {
    const { myOrganizations } = await import('@/lib/auth/org-access');
    orgRow(L).deleted_at = daysAgo(3);
    current = ADMIN;
    const admin = await myOrganizations();
    expect(admin.ok && admin.pendingDeletion).toEqual([]);
    current = OWNER;
    orgRow(L).deleted_at = daysAgo(31);
    const late = await myOrganizations();
    expect(late.ok && late.pendingDeletion).toEqual([]);
  });
});

describe('POST /api/org/[orgId]/restore — within the grace period', () => {
  const deleted = (days: number) => {
    orgRow(L).deleted_at = daysAgo(days);
  };

  it('signed out is 401', async () => {
    deleted(3);
    current = null;
    expect((await restore(L)).status).toBe(401);
  });

  it('brings the org back, with an audit event, and says where it lives', async () => {
    deleted(3);
    const res = await restore(L);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ org: { id: L, slug: 'night-shift' }, href: '/o/night-shift' });
    expect(orgRow(L).deleted_at).toBeNull();
    expect(events('org.restored')).toHaveLength(1);
    expect(events('org.restored')[0]).toMatchObject({ actor_id: OWNER, audit: true });
  });

  it('does not need a fresh sign-in: restoring cannot lose anything', async () => {
    deleted(3);
    signedInAt = minutesAgo(60 * 24 * 20);
    expect((await restore(L)).status).toBe(200);
  });

  it.each([['an admin', ADMIN], ['a stranger', STRANGER], ['another org’s owner', OWNER2]])('%s gets 404, as for an org that does not exist', async (_n, user) => {
    deleted(3);
    current = user;
    expect((await restore(L)).status).toBe(404);
    expect(orgRow(L).deleted_at).not.toBeNull();
  });

  it('a live org has nothing to restore', async () => {
    expect((await restore(L)).status).toBe(404);
  });

  it('refuses once the grace period is over', async () => {
    deleted(31);
    expect((await restore(L)).status).toBe(410);
    expect(orgRow(L).deleted_at).not.toBeNull();
  });

  it('puts the deletion back, with its original date, when the audit event cannot be written', async () => {
    deleted(3);
    const stamp = orgRow(L).deleted_at;
    auditFails = true;
    expect((await restore(L)).status).toBe(500);
    expect(orgRow(L).deleted_at).toBe(stamp);
  });

  it('a restored org works again for its members', async () => {
    await del(L);
    expect((await restore(L)).status).toBe(200);
    const members = await membersRoute.GET(new NextRequest(`https://app.test/api/org/${L}/members`), ctx(L));
    expect(members.status).toBe(200);
  });
});

describe('GET /api/org/[orgId]/restore — what the restore page shows', () => {
  it('tells the owner the name, the date it will be purged and the days left', async () => {
    orgRow(L).deleted_at = daysAgo(3);
    const res = await restoreInfo(L);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ org: { id: L, name: 'Night Shift', slug: 'night-shift' }, daysLeft: 27, canRestore: true });
    expect(new Date(body.purgeAfter).getTime()).toBe(new Date(orgRow(L).deleted_at as string).getTime() + 30 * 86_400_000);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mem.writes).toEqual([]);
  });

  it('says it can no longer be restored once the grace period is over', async () => {
    orgRow(L).deleted_at = daysAgo(40);
    expect(await (await restoreInfo(L)).json()).toMatchObject({ canRestore: false, daysLeft: 0 });
  });

  it.each([['an admin', ADMIN], ['a stranger', STRANGER], ['another org’s owner', OWNER2]])('%s learns nothing: 404', async (_n, user) => {
    orgRow(L).deleted_at = daysAgo(3);
    current = user;
    const res = await restoreInfo(L);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Night Shift');
  });

  it('a live org is 404, and signed out is 401', async () => {
    expect((await restoreInfo(L)).status).toBe(404);
    orgRow(L).deleted_at = daysAgo(3);
    current = null;
    expect((await restoreInfo(L)).status).toBe(401);
  });

  it('a malformed id is 404', async () => {
    expect((await restoreInfo('not-a-uuid')).status).toBe(404);
  });
});

describe('the owner’s shortcut from /o/<slug>', () => {
  it('finds a soft-deleted org only for its owner', async () => {
    const { ownedDeletedOrgFor } = await import('@/lib/auth/org-access');
    expect(await ownedDeletedOrgFor('night-shift')).toBeNull(); // live
    orgRow(L).deleted_at = daysAgo(3);
    expect(await ownedDeletedOrgFor('night-shift')).toEqual({ id: L });
    current = ADMIN;
    expect(await ownedDeletedOrgFor('night-shift')).toBeNull();
    current = STRANGER;
    expect(await ownedDeletedOrgFor('night-shift')).toBeNull();
    current = null;
    expect(await ownedDeletedOrgFor('night-shift')).toBeNull();
    current = OWNER;
    expect(await ownedDeletedOrgFor('Not A Slug!')).toBeNull();
  });
});

describe('GET /api/org/[orgId]/export', () => {
  it('signed out is 401', async () => {
    current = null;
    expect((await exp(L)).status).toBe(401);
  });

  it.each([['an admin', ADMIN], ['a stranger', STRANGER], ['another org’s owner', OWNER2]])('%s is refused', async (_n, user) => {
    current = user;
    const res = await exp(L);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('Night Shift');
    expect(events('org.exported')).toHaveLength(0);
  });

  it('needs a fresh sign-in', async () => {
    signedInAt = minutesAgo(30);
    const res = await exp(L);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ requiresReauth: true });
    expect(events('org.exported')).toHaveLength(0);
  });

  it('returns the org’s data as JSON with its manifest, and audits the export', async () => {
    const res = await exp(L);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="night-shift-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.tables.tracks.map((t: { id: string }) => t.id)).toEqual([S1]);
    expect(body.tables.organizations.map((o: { id: string }) => o.id)).toEqual([L]);
    expect(body.manifest.tables.tracks).toBe(1);
    expect(body.manifest.references.map((r: { key: string }) => r.key)).toEqual([`orgs/${L}/tracks/a.wav`]);
    expect(body.manifest.stored).toEqual([{ key: `orgs/${L}/tracks/a.wav`, size: 3, lastModified: '2026-10-01T00:00:00.000Z' }]);
    expect(events('org.exported')).toHaveLength(1);
    expect(events('org.exported')[0]).toMatchObject({ org_id: L, actor_id: OWNER, audit: true, payload: { format: 'json' } });
  });

  it('names the previews promoted to the public store for the org’s releases in the manifest (LABEL-42), and none of another org’s', async () => {
    db.tables.releases = [{ id: 'r-mine', org_id: L }, { id: 'r-theirs', org_id: L2 }];
    const body = await (await exp(L)).json();
    expect(body.manifest.stored.map((o: { key: string }) => o.key)).toEqual([`orgs/${L}/tracks/a.wav`, 'store-releases/r-mine/t1']);
  });

  it('holds no secret and nothing of another org', async () => {
    const text = await (await exp(L)).text();
    expect(text).not.toContain('TOPSECRET');
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain(L2);
    expect(text).not.toContain('Other Label');
  });

  it('CSV is a zip: a file per table, a manifest, and spreadsheet formulas defused', async () => {
    const res = await exp(L, '?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('.zip');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['manifest.json', 'tracks.csv', 'contacts.csv', 'organizations.csv', 'activity_events.csv']));
    expect(strFromU8(files['tracks.csv'])).toContain('Midnight');
    expect(strFromU8(files['contacts.csv'])).toContain("'=cmd|calc");
    expect(JSON.parse(strFromU8(files['manifest.json'])).orgId).toBe(L);
    expect(events('org.exported')[0].payload).toMatchObject({ format: 'csv' });
  });

  it('says so in the manifest when the object store could not be listed, and still exports', async () => {
    storedFails = true;
    const body = await (await exp(L)).json();
    expect(body.manifest.stored).toBeNull();
    expect(body.manifest.storedError).toContain('unreachable');
    expect(body.tables.tracks).toHaveLength(1);
  });

  it('refuses a format it does not know', async () => {
    expect((await exp(L, '?format=xml')).status).toBe(400);
    expect(events('org.exported')).toHaveLength(0);
  });

  it('is rate-limited', async () => {
    rateOk = false;
    expect((await exp(L)).status).toBe(429);
    expect(events('org.exported')).toHaveLength(0);
  });

  it('releases no data when the export cannot be audited', async () => {
    auditFails = true;
    const res = await exp(L);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('Midnight');
  });

  it('is read-only apart from its one audit event', async () => {
    await exp(L);
    expect(mem.writes.map((w) => `${w.table}:${w.op}`)).toEqual(['activity_events:insert']);
  });

  it('a soft-deleted org cannot be exported', async () => {
    orgRow(L).deleted_at = daysAgo(1);
    expect((await exp(L)).status).toBe(404);
  });
});
