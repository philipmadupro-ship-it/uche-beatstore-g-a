/**
 * Org releases (LABEL-16): `/api/org/[orgId]/releases`, `/[releaseId]`,
 * `/[releaseId]/items` and `/[releaseId]/items/[itemId]`, run through the
 * REAL lib/auth/org-access, lib/labelos/releases, lib/labelos/identifiers
 * and lib/labelos/activity against an in-memory database. The two tracklist
 * functions of migration 144 are played by `rpc` below (the SQL ones are
 * proven in supabase/local/checks/144_labelos_releases.sql).
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project
 *     (project_contacts C1) with song S1 — its master M1, version V1, demo D1
 *     — a beat B1, an artwork A1 and a contract A2. LP2: Kilo's Inbox with
 *     song S2 and an artwork A3. Releases R1 (LP1, Nova: S1/S1, S1/M1) and
 *     R2 (LP2, Kilo: S2). Members: owner, A&R (release.write), marketing
 *     (read-only), finance (no catalogue), A&R scoped to C2, roster artist C1.
 *   L2: artist CX, project XP1, song XS1, release RX. Owner X.
 *   The producer: project PP1 and song PS1 (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const FIN = u(4);
const AR_C2 = u(5);
const ART = u(6);
const X = u(7);
const STRANGER = u(8);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const PP1 = '40000000-0000-4000-8000-0000000000e1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const M1 = t(2);
const V1 = t(3);
const D1 = t(4);
const B1 = t(5);
const S2 = t(6);
const XS1 = t(7);
const PS1 = t(8);
const A1 = '60000000-0000-4000-8000-000000000001';
const A2 = '60000000-0000-4000-8000-000000000002';
const A3 = '60000000-0000-4000-8000-000000000003';
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const RX = '70000000-0000-4000-8000-000000000003';
const I1 = '80000000-0000-4000-8000-000000000001';
const I2 = '80000000-0000-4000-8000-000000000002';
const I3 = '80000000-0000-4000-8000-000000000003';
const IX = '80000000-0000-4000-8000-000000000004';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
/** Tables PostgREST answers as missing (an unapplied migration). */
let missing = new Set<string>();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (!missing.has(table)) return mem.client.from(table);
      const res = { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST205' } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'insert', 'update', 'delete']) q[m] = () => q;
      q.maybeSingle = async () => res;
      q.single = async () => res;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return q;
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function track(id: string, org: string | null, type: string, title: string) {
  return { id, org_id: org, user_id: org ? null : OWN, type, title, song_stage: type === 'song' && org ? 'inbox' : null };
}
function release(id: string, org: string, project: string, contact: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: org, project_id: project, contact_id: contact, title, type: 'single', upc: null, label_name: null, c_line: null,
    p_line: null, primary_genre: null, target_date: null, release_date: null, artwork_asset_id: null, state: 'draft',
    delivered_at: null, delivered_to: null, imported_released: false, store_listed: false, store_listed_at: null,
    created_by: OWN, created_at: `2026-10-0${id.slice(-1)}`, updated_at: '2026-10-01', ...extra,
  };
}
function item(id: string, rel: string, org: string, position: number, song: string, master: string) {
  return { id, release_id: rel, org_id: org, position, song_track_id: song, master_track_id: master, version_title: null, explicit: false };
}

type Row = Record<string, unknown>;
const err = (message: string, code: string) => ({ data: null, error: { message, code } });

/** Migration 144's two functions, over the same tables. */
const RPC: MemoryDb['rpc'] = {
  labelos_release_items_reorder: (args, tables) => {
    const rel = (tables.releases ?? []).find((r) => r.id === args.p_release && r.org_id === args.p_org);
    if (!rel) return err(`release ${String(args.p_release)} not found`, 'P0002');
    const items = (tables.release_items ?? []).filter((i) => i.release_id === rel.id);
    const ids = args.p_items as string[];
    if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some((id) => !items.some((i) => i.id === id))) {
      return err('order must list every item of the release exactly once', '22023');
    }
    ids.forEach((id, n) => { items.find((i) => i.id === id)!.position = n + 1; });
    return { data: null, error: null };
  },
  labelos_release_item_remove: (args, tables) => {
    const rel = (tables.releases ?? []).find((r) => r.id === args.p_release && r.org_id === args.p_org);
    if (!rel) return { data: false, error: null };
    const gone = (tables.release_items ?? []).find((i) => i.id === args.p_item && i.release_id === rel.id);
    if (!gone) return { data: false, error: null };
    tables.release_items = tables.release_items.filter((i) => i !== gone);
    for (const i of tables.release_items) {
      if (i.release_id === rel.id && (i.position as number) > (gone.position as number)) i.position = (i.position as number) - 1;
    }
    return { data: true, error: null };
  },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missing = new Set();
  db = {
    rpc: RPC,
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(FIN, 'member', ['finance']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(ART, 'artist', [], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
        { id: PP1, org_id: null, user_id: OWN, name: 'Producer project', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        ...[S1, M1, V1, D1, B1].map((id, n) => ({ project_id: LP1, track_id: id, position: n })),
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Nova single'),
        track(M1, L, 'song', 'Nova single (master)'),
        track(V1, L, 'song', 'Nova single (radio)'),
        track(D1, L, 'song', 'Nova single (demo)'),
        track(B1, L, 'beat', 'Nova beat'),
        track(S2, L, 'song', 'Kilo single'),
        track(XS1, L2, 'song', 'Xen single'),
        track(PS1, null, 'song', 'Producer song'),
      ],
      track_links: [
        { from_track_id: S1, to_track_id: M1, relation: 'master', user_id: null },
        { from_track_id: S1, to_track_id: V1, relation: 'version', user_id: null },
        { from_track_id: S1, to_track_id: D1, relation: 'demo', user_id: null },
      ],
      project_assets: [
        { id: A1, project_id: LP1, org_id: L, kind: 'artwork', sensitivity: 'normal' },
        { id: A2, project_id: LP1, org_id: L, kind: 'contract', sensitivity: 'restricted' },
        { id: A3, project_id: LP2, org_id: L, kind: 'artwork', sensitivity: 'normal' },
      ],
      releases: [release(R1, L, LP1, C1, 'Nova EP'), release(R2, L, LP2, C2, 'Kilo single'), release(RX, L2, XP1, CX, 'Xen single')],
      release_items: [item(I1, R1, L, 1, S1, S1), item(I2, R1, L, 2, S1, M1), item(I3, R2, L, 1, S2, S2), item(IX, RX, L2, 1, XS1, XS1)],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'https://app.test/api/org';
const json = (method: string, body?: unknown) =>
  body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };

async function call(path: string, mod: Record<string, Handler>, method: string, as: string | null, params: Record<string, string>, body?: unknown) {
  current = as;
  return mod[method](new NextRequest(`${BASE}/${path}`, json(method, body)), { params: Promise.resolve(params) });
}
const collection = async (method: 'GET' | 'POST', as: string | null, org: string, body?: unknown) =>
  call(`${org}/releases`, (await import('./route')) as unknown as Record<string, Handler>, method, as, { orgId: org }, body);
const one = async (method: 'GET' | 'PATCH' | 'DELETE', as: string | null, org: string, rel: string, body?: unknown) =>
  call(`${org}/releases/${rel}`, (await import('./[releaseId]/route')) as unknown as Record<string, Handler>, method, as, { orgId: org, releaseId: rel }, body);
const items = async (method: 'POST' | 'PATCH', as: string | null, org: string, rel: string, body?: unknown) =>
  call(`${org}/releases/${rel}/items`, (await import('./[releaseId]/items/route')) as unknown as Record<string, Handler>, method, as, { orgId: org, releaseId: rel }, body);
const anItem = async (method: 'PATCH' | 'DELETE', as: string | null, org: string, rel: string, itemId: string, body?: unknown) =>
  call(`${org}/releases/${rel}/items/${itemId}`, (await import('./[releaseId]/items/[itemId]/route')) as unknown as Record<string, Handler>, method, as, { orgId: org, releaseId: rel, itemId }, body);

const titles = async (res: Response) => ((await res.json()) as { releases: { title: string }[] }).releases.map((r) => r.title).sort();
const tracklist = (rel: string) =>
  db.tables.release_items
    .filter((i) => i.release_id === rel)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((i) => `${i.position}:${i.id === I1 ? 'I1' : i.id === I2 ? 'I2' : i.id === I3 ? 'I3' : (i.master_track_id as string).slice(-1)}`);

describe('GET /releases: catalog.read + the release project in scope (144)', () => {
  it('whole-org members see the org\'s releases and never another org\'s', async () => {
    expect(await titles(await collection('GET', OWN, L))).toEqual(['Kilo single', 'Nova EP']);
    expect(await titles(await collection('GET', AR, L))).toEqual(['Kilo single', 'Nova EP']);
    expect(await titles(await collection('GET', MKT, L))).toEqual(['Kilo single', 'Nova EP']);
    expect(await titles(await collection('GET', X, L2))).toEqual(['Xen single']);
  });

  it('a scoped member sees the releases of their artists\' projects only (an Inbox counts)', async () => {
    expect(await titles(await collection('GET', AR_C2, L))).toEqual(['Kilo single']);
    expect(await titles(await collection('GET', ART, L))).toEqual(['Nova EP']);
    db.tables.member_artist_scopes = db.tables.member_artist_scopes.filter((s) => s.user_id !== AR_C2);
    expect(await titles(await collection('GET', AR_C2, L))).toEqual([]);
  });

  it('no catalogue → 403; a non-member or another org\'s member → 403; signed out → 401', async () => {
    expect((await collection('GET', FIN, L)).status).toBe(403);
    expect((await collection('GET', STRANGER, L)).status).toBe(403);
    expect((await collection('GET', X, L)).status).toBe(403);
    expect((await collection('GET', null, L)).status).toBe(401);
  });

  it('sends the view, never a stored column it does not name', async () => {
    db.tables.releases[0].internal_note = 'secret';
    const body = JSON.stringify(await (await collection('GET', OWN, L)).json());
    expect(body).not.toMatch(/internal_note|secret|org_id/);
  });
});

describe('POST /releases: release.write', () => {
  it('creates a release and, with no project named, its project linked to the artist', async () => {
    const res = await collection('POST', AR, L, { title: 'Nova Album', type: 'album', contact_id: C1, upc: '0 36000 29145 2', target_date: '2026-12-04' });
    expect(res.status).toBe(201);
    const { release: view } = await res.json();
    expect(view).toMatchObject({ title: 'Nova Album', type: 'album', contactId: C1, upc: '036000291452', targetDate: '2026-12-04', state: 'draft' });
    const project = db.tables.projects.find((p) => p.id === view.projectId)!;
    expect(project).toMatchObject({ org_id: L, user_id: null, name: 'Nova Album' });
    // The link is an org row: no owner, so no producer route (all filter on user_id) can list it.
    expect(db.tables.project_contacts.find((pc) => pc.project_id === view.projectId)).toMatchObject({ contact_id: C1, user_id: null });
    const row = db.tables.releases.find((r) => r.id === view.id)!;
    expect(row).toMatchObject({ org_id: L, created_by: AR });
    expect(row).not.toHaveProperty('user_id');
    expect(db.tables.activity_events.map((e) => e.verb).sort()).toEqual(['project.created', 'release.created']);
    // The artist's scoped members see it at once; another artist's do not.
    expect(await titles(await collection('GET', ART, L))).toEqual(['Nova Album', 'Nova EP']);
    expect(await titles(await collection('GET', AR_C2, L))).toEqual(['Kilo single']);
  });

  it('on a named project of the org, with that project\'s artwork', async () => {
    const res = await collection('POST', OWN, L, { title: 'Nova Deluxe', contact_id: C1, project_id: LP1, artwork_asset_id: A1 });
    expect(res.status).toBe(201);
    expect((await res.json()).release).toMatchObject({ projectId: LP1, artworkAssetId: A1 });
    expect(db.tables.projects).toHaveLength(4);
  });

  it('marketing and finance cannot create one (403)', async () => {
    expect((await collection('POST', MKT, L, { title: 'x', contact_id: C1 })).status).toBe(403);
    expect((await collection('POST', FIN, L, { title: 'x', contact_id: C1 })).status).toBe(403);
    expect(db.tables.releases).toHaveLength(3);
  });

  it('an invalid UPC is a 400 that names the field', async () => {
    const res = await collection('POST', AR, L, { title: 'x', contact_id: C1, upc: '036000291453' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/^upc: /);
    expect(body.issues[0].path).toBe('upc');
    expect(db.tables.releases).toHaveLength(3);
    expect(db.tables.projects).toHaveLength(4);
  });

  it('an artist or project outside the member\'s scope, another org\'s, or the producer\'s → 404', async () => {
    expect((await collection('POST', AR_C2, L, { title: 'x', contact_id: C1 })).status).toBe(404);
    expect((await collection('POST', AR, L, { title: 'x', contact_id: CX })).status).toBe(404);
    expect((await collection('POST', AR, L, { title: 'x', contact_id: C1, project_id: XP1 })).status).toBe(404);
    expect((await collection('POST', AR, L, { title: 'x', contact_id: C1, project_id: PP1 })).status).toBe(404);
    expect((await collection('POST', AR_C2, L, { title: 'x', contact_id: C2, project_id: LP1 })).status).toBe(404);
    expect(db.tables.releases).toHaveLength(3);
  });

  it('artwork must be an artwork / photo file of the release\'s own project (400, field named)', async () => {
    for (const body of [
      { title: 'x', contact_id: C1, project_id: LP1, artwork_asset_id: A3 },
      { title: 'x', contact_id: C1, project_id: LP1, artwork_asset_id: A2 },
      { title: 'x', contact_id: C1, artwork_asset_id: A1 },
    ]) {
      const res = await collection('POST', AR, L, body);
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe('artwork_asset_id');
    }
    expect(db.tables.releases).toHaveLength(3);
  });

  it('refuses fields it does not take: org_id, user_id, state, store_listed', async () => {
    for (const extra of [{ org_id: L2 }, { user_id: AR }, { state: 'delivered' }, { store_listed: true }]) {
      expect((await collection('POST', AR, L, { title: 'x', contact_id: C1, ...extra })).status).toBe(400);
    }
  });
});

describe('GET / PATCH / DELETE /releases/[id]', () => {
  it('reads the release and its tracklist in order', async () => {
    db.tables.release_items.reverse();
    const res = await one('GET', MKT, L, R1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.release).toMatchObject({ id: R1, title: 'Nova EP' });
    expect(body.items.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([[I1, 1], [I2, 2]]);
  });

  it('scope and org are 404, never 403; no catalogue is 403', async () => {
    expect((await one('GET', AR_C2, L, R1)).status).toBe(404);
    expect((await one('GET', OWN, L, RX)).status).toBe(404);
    expect((await one('GET', X, L2, R1)).status).toBe(404);
    expect((await one('GET', OWN, L2, RX)).status).toBe(404);
    expect((await one('GET', OWN, L, 'not-a-uuid')).status).toBe(404);
    expect((await one('GET', FIN, L, R1)).status).toBe(403);
  });

  it('A&R edits fields; an invalid UPC is a 400 naming upc; marketing cannot', async () => {
    const ok = await one('PATCH', AR, L, R1, { title: 'Nova EP (Deluxe)', label_name: 'L Records', upc: '4006381333931' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).release).toMatchObject({ title: 'Nova EP (Deluxe)', labelName: 'L Records', upc: '4006381333931' });
    const bad = await one('PATCH', AR, L, R1, { upc: '4006381333932' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe('upc');
    expect((await one('PATCH', MKT, L, R1, { title: 'x' })).status).toBe(403);
    expect(db.tables.releases[0].title).toBe('Nova EP (Deluxe)');
  });

  it('cancel and back to draft, but never delivered here; project and artist are fixed', async () => {
    expect((await one('PATCH', AR, L, R1, { state: 'cancelled' })).status).toBe(200);
    expect((await one('PATCH', AR, L, R1, { state: 'draft' })).status).toBe(200);
    expect((await one('PATCH', AR, L, R1, { state: 'delivered' })).status).toBe(400);
    expect((await one('PATCH', AR, L, R1, { project_id: LP2 })).status).toBe(400);
    expect((await one('PATCH', AR, L, R1, { contact_id: C2 })).status).toBe(400);
    expect((await one('PATCH', AR, L, R1, {})).status).toBe(400);
  });

  it('artwork from another project is a 400', async () => {
    const res = await one('PATCH', AR, L, R1, { artwork_asset_id: A3 });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('artwork_asset_id');
    expect((await one('PATCH', AR, L, R1, { artwork_asset_id: A1 })).status).toBe(200);
    expect((await one('PATCH', AR, L, R1, { artwork_asset_id: null })).status).toBe(200);
  });

  it('delete takes the tracklist; a release that went out is not deleted', async () => {
    expect((await one('DELETE', MKT, L, R2)).status).toBe(403);
    expect((await one('DELETE', AR, L, R2)).status).toBe(200);
    expect(db.tables.releases.map((r) => r.id)).toEqual([R1, RX]);
    db.tables.releases[0].state = 'delivered';
    expect((await one('DELETE', AR, L, R1)).status).toBe(409);
    expect((await one('DELETE', AR, L, RX)).status).toBe(404);
  });
});

describe('tracklist: add, reorder, edit, remove', () => {
  it('appends a song at n + 1, as itself or with a master / version linked from it', async () => {
    const res = await items('POST', AR, L, R1, { song_track_id: S1, master_track_id: V1, version_title: 'Radio Edit', explicit: true });
    expect(res.status).toBe(201);
    expect((await res.json()).item).toMatchObject({ position: 3, songTrackId: S1, masterTrackId: V1, versionTitle: 'Radio Edit', explicit: true });
    expect((await items('POST', OWN, L, R1, { song_track_id: S2 })).status).toBe(201);
    expect(tracklist(R1)).toEqual(['1:I1', '2:I2', '3:3', '4:6']);
  });

  it('only a song goes on a release, and only as itself or its master / instrumental / version (400, field named)', async () => {
    const beat = await items('POST', AR, L, R1, { song_track_id: B1 });
    expect(beat.status).toBe(400);
    expect((await beat.json()).field).toBe('song_track_id');
    const demo = await items('POST', AR, L, R1, { song_track_id: S1, master_track_id: D1 });
    expect(demo.status).toBe(400);
    expect((await demo.json()).field).toBe('master_track_id');
    const unlinked = await items('POST', AR, L, R1, { song_track_id: S1, master_track_id: S2 });
    expect(unlinked.status).toBe(400);
    expect(tracklist(R1)).toEqual(['1:I1', '2:I2']);
  });

  it('a producer song, another org\'s song, or one outside the scope is 404', async () => {
    expect((await items('POST', AR, L, R1, { song_track_id: PS1 })).status).toBe(404);
    expect((await items('POST', AR, L, R1, { song_track_id: XS1 })).status).toBe(404);
    // Kilo's A&R may write Kilo's release, but Nova's song (only in LP1) is out of their sight.
    expect((await items('POST', AR_C2, L, R2, { song_track_id: S1 })).status).toBe(404);
    expect((await items('POST', AR_C2, L, R2, { song_track_id: S2 })).status).toBe(201);
  });

  it('marketing (read-only) and a member outside the release\'s scope cannot touch it', async () => {
    expect((await items('POST', MKT, L, R1, { song_track_id: S1 })).status).toBe(403);
    expect((await items('POST', AR_C2, L, R1, { song_track_id: S2 })).status).toBe(404);
    expect((await items('PATCH', MKT, L, R1, { order: [I2, I1] })).status).toBe(403);
    expect((await anItem('DELETE', MKT, L, R1, I1)).status).toBe(403);
    expect(tracklist(R1)).toEqual(['1:I1', '2:I2']);
  });

  it('reorders when every item is named once; anything else is a 400', async () => {
    const ok = await items('PATCH', AR, L, R1, { order: [I2, I1] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).items.map((i: { id: string }) => i.id)).toEqual([I2, I1]);
    expect(tracklist(R1)).toEqual(['1:I2', '2:I1']);
    for (const order of [[I1], [I1, I1], [I1, I2, I3], [I1, IX]]) {
      const bad = await items('PATCH', AR, L, R1, { order });
      expect(bad.status).toBe(400);
    }
    expect(tracklist(R1)).toEqual(['1:I2', '2:I1']);
  });

  it('positions stay contiguous after a delete', async () => {
    await items('POST', AR, L, R1, { song_track_id: S1, master_track_id: V1 });
    await items('POST', AR, L, R1, { song_track_id: S2 });
    expect(tracklist(R1)).toEqual(['1:I1', '2:I2', '3:3', '4:6']);
    const res = await anItem('DELETE', AR, L, R1, I2);
    expect(res.status).toBe(200);
    expect((await res.json()).items.map((i: { position: number }) => i.position)).toEqual([1, 2, 3]);
    expect(tracklist(R1)).toEqual(['1:I1', '2:3', '3:6']);
    expect((await anItem('DELETE', AR, L, R1, I1)).status).toBe(200);
    expect(tracklist(R1)).toEqual(['1:3', '2:6']);
  });

  it('an item of another release or org, an unknown id or a malformed one is 404', async () => {
    expect((await anItem('DELETE', AR, L, R1, I3)).status).toBe(404);
    expect((await anItem('DELETE', AR, L, R1, IX)).status).toBe(404);
    expect((await anItem('DELETE', AR, L, R1, '80000000-0000-4000-8000-000000000099')).status).toBe(404);
    expect((await anItem('DELETE', AR, L, R1, 'nope')).status).toBe(404);
    expect((await anItem('PATCH', AR, L, R1, I3, { explicit: true })).status).toBe(404);
    expect(tracklist(R1)).toEqual(['1:I1', '2:I2']);
  });

  it('edits an item: a new master is checked like an added one', async () => {
    const ok = await anItem('PATCH', AR, L, R1, I1, { master_track_id: V1, version_title: 'Radio Edit' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).item).toMatchObject({ masterTrackId: V1, versionTitle: 'Radio Edit', position: 1 });
    const bad = await anItem('PATCH', AR, L, R1, I1, { master_track_id: D1 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe('master_track_id');
    expect((await anItem('PATCH', AR, L, R1, I1, { song_track_id: S2 })).status).toBe(400);
  });
});

describe('a tracklist changes only while the release is a draft', () => {
  it('delivered or cancelled: add, reorder, edit and remove are 409', async () => {
    for (const state of ['delivered', 'cancelled']) {
      db.tables.releases[0].state = state;
      expect((await items('POST', AR, L, R1, { song_track_id: S1, master_track_id: V1 })).status).toBe(409);
      expect((await items('PATCH', AR, L, R1, { order: [I2, I1] })).status).toBe(409);
      expect((await anItem('PATCH', AR, L, R1, I1, { explicit: true })).status).toBe(409);
      expect((await anItem('DELETE', AR, L, R1, I1)).status).toBe(409);
    }
    expect(tracklist(R1)).toEqual(['1:I1', '2:I2']);
    db.tables.releases[0].state = 'draft';
    expect((await anItem('PATCH', AR, L, R1, I1, { explicit: true })).status).toBe(200);
  });
});

describe('before migration 144 (no release tables)', () => {
  it('the list says schemaReady: false; a create and every per-release route answer 503 naming 144', async () => {
    missing = new Set(['releases', 'release_items']);
    const list = await collection('GET', OWN, L);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ releases: [], schemaReady: false });
    const created = await collection('POST', AR, L, { title: 'x', contact_id: C1 });
    expect(created.status).toBe(503);
    expect((await created.json()).migration).toBe('144');
    expect(db.tables.projects).toHaveLength(4);
    for (const res of [
      await one('GET', OWN, L, R1),
      await one('PATCH', AR, L, R1, { title: 'x' }),
      await one('DELETE', AR, L, R1),
      await items('POST', AR, L, R1, { song_track_id: S1 }),
      await items('PATCH', AR, L, R1, { order: [I1, I2] }),
      await anItem('DELETE', AR, L, R1, I1),
    ]) {
      expect(res.status).toBe(503);
    }
  });
});

describe('write errors as the member sees them', () => {
  it('a position race is a 409 to retry, never a 400 echoing the release id', async () => {
    const { writeError } = await import('./access');
    const race = writeError({ code: '23514', message: `release_items: the positions of release ${R1} must be 1..n with no gap` }, 'x');
    expect(race.res.status).toBe(409);
    expect(JSON.stringify(await race.res.json())).not.toContain(R1);
    expect(writeError({ code: '23505', message: 'duplicate key' }, 'x').res.status).toBe(409);
    expect(writeError({ code: '23514', message: 'releases_upc_format' }, 'x').res.status).toBe(400);
    expect(writeError({ code: 'XX000', message: 'boom' }, 'Could not').res.status).toBe(500);
  });
});

describe('the producer is untouched', () => {
  it('no route reads or writes a producer row', async () => {
    await collection('POST', AR, L, { title: 'Nova Album', contact_id: C1 });
    await items('POST', AR, L, R1, { song_track_id: S1, master_track_id: V1 });
    await anItem('DELETE', AR, L, R1, I1);
    const touched = mem.writes.flatMap((w) => w.rows as Row[]);
    expect(touched.some((r) => r.user_id === OWN && r.org_id === null)).toBe(false);
    expect(db.tables.projects.find((p) => p.id === PP1)).toMatchObject({ org_id: null, user_id: OWN });
    expect(db.tables.tracks.find((tr) => tr.id === PS1)).toMatchObject({ org_id: null });
  });
});
