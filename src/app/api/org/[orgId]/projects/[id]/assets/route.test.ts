/**
 * Org project files (LABEL-15): `/api/org/[orgId]/projects/[id]/assets`,
 * `/presign`, `/[assetId]` and `/[assetId]/download`, run through the REAL
 * lib/auth/org-access, lib/labelos/org-assets and lib/labelos/activity
 * against an in-memory database. Storage is faked.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project
 *     (project_contacts C1) with an artwork, a session and a contract
 *     (restricted). LP2: Kilo's Inbox. Members: owner, A&R, marketing,
 *     legal, finance (no catalogue), A&R scoped to C2, the roster artist C1.
 *   L2: project XP1 with an artwork; owner X.
 *   The producer: project PP1 (org_id NULL, user_id OWN) with one file.
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
const LEG = u(4);
const FIN = u(5);
const AR_C2 = u(6);
const ART = u(7);
const X = u(8);
const STRANGER = u(9);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const PP1 = '40000000-0000-4000-8000-0000000000e1';
const A_ART = '60000000-0000-4000-8000-000000000001';
const A_SES = '60000000-0000-4000-8000-000000000002';
const A_CON = '60000000-0000-4000-8000-000000000003';
const X_ART = '60000000-0000-4000-8000-000000000004';
const P_FILE = '60000000-0000-4000-8000-000000000005';

const key = (org: string, project: string, id: string, ext: string) => `orgs/${org}/assets/${project}/${id}.${ext}`;
const ref = (org: string, project: string, id: string, ext: string) => `r2://priv/${key(org, project, id, ext)}`;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let failWritesTo: string | null = null;

const storage = vi.hoisted(() => ({
  stored: [] as { key: string; mime: string; bytes: number }[],
  presigned: [] as string[],
  deleted: [] as string[],
  streamed: [] as string[],
  sizes: new Map<string, number>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q = mem.client.from(table);
      if (failWritesTo !== table) return q;
      const err = async () => ({ data: null, error: { message: `${table} is down` } });
      const broken = { ...q, then: (ok: (v: unknown) => unknown) => err().then(ok), single: err, maybeSingle: err, select: () => broken };
      return { ...q, insert: () => broken, upsert: () => broken };
    },
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/project-assets', () => ({
  projectAssetBuckets: () => ['priv'],
  storeProjectAsset: async (buffer: Buffer, k: string, mime: string) => {
    storage.stored.push({ key: k, mime, bytes: buffer.length });
    return `r2://priv/${k}`;
  },
  presignProjectAssetPut: async (k: string) => {
    storage.presigned.push(k);
    return { uploadUrl: `https://r2.example/${k}?sig`, url: `r2://priv/${k}` };
  },
  projectAssetSize: async (r: string) => storage.sizes.get(r) ?? null,
  deleteProjectAssetObject: async (r: string) => { storage.deleted.push(r); },
  streamProjectAsset: async (_req: unknown, r: string, opts: { fileName: string }) => {
    storage.streamed.push(r);
    return new Response('bytes', { status: 200, headers: { 'content-disposition': `attachment; filename="${opts.fileName}"` } });
  },
}));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}

function asset(id: string, project: string, org: string | null, kind: string, sensitivity: string, ext: string, extra: Record<string, unknown> = {}) {
  return {
    id, project_id: project, org_id: org, user_id: org ? null : OWN, created_by: org ? OWN : null, kind, sensitivity,
    label: `${kind} file`, file_name: `${kind}.${ext}`, url: org ? ref(org, project, id.slice(-12), ext) : `r2://priv/project-assets/${project}/abcdefgh.${ext}`,
    mime: 'application/pdf', size_bytes: 10, position: 0, in_portal: false, portal_at: null, created_at: '2026-10-01', ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failWritesTo = null;
  storage.stored.length = 0;
  storage.presigned.length = 0;
  storage.deleted.length = 0;
  storage.streamed.length = 0;
  storage.sizes.clear();
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(LEG, 'member', ['legal']),
        member(FIN, 'member', ['finance']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(ART, 'artist', [], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
        { id: PP1, org_id: null, user_id: OWN, name: 'Producer project', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1 }],
      project_tracks: [],
      project_assets: [
        asset(A_ART, LP1, L, 'artwork', 'normal', 'png', { position: 0 }),
        asset(A_SES, LP1, L, 'session', 'normal', 'als', { position: 1 }),
        asset(A_CON, LP1, L, 'contract', 'restricted', 'pdf', { position: 2 }),
        asset(X_ART, XP1, L2, 'artwork', 'normal', 'png'),
        asset(P_FILE, PP1, null, 'lyrics', 'normal', 'pdf'),
      ],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Ctx = { params: Promise<{ orgId: string; id: string; assetId: string }> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response>;
const base = (org: string, project: string) => `https://app.test/api/org/${org}/projects/${project}/assets`;

async function list(as: string | null, org: string, project: string) {
  current = as;
  const { GET } = await import('./route');
  return (GET as Handler)(new NextRequest(base(org, project)), { params: Promise.resolve({ orgId: org, id: project, assetId: '' }) });
}
async function download(as: string | null, org: string, project: string, assetId: string, range?: string) {
  current = as;
  const { GET } = await import('./[assetId]/download/route');
  const headers = range ? { range } : undefined;
  return (GET as Handler)(new NextRequest(`${base(org, project)}/${assetId}/download`, { headers }), {
    params: Promise.resolve({ orgId: org, id: project, assetId }),
  });
}
async function upload(as: string, org: string, project: string, name: string, fields: Record<string, string> = {}, bytes = 10) {
  current = as;
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], name));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const { POST } = await import('./route');
  return (POST as Handler)(new NextRequest(base(org, project), { method: 'POST', body: form }), {
    params: Promise.resolve({ orgId: org, id: project, assetId: '' }),
  });
}
async function register(as: string, org: string, project: string, body: Record<string, unknown>) {
  current = as;
  const { POST } = await import('./route');
  return (POST as Handler)(
    new NextRequest(base(org, project), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ orgId: org, id: project, assetId: '' }) },
  );
}
async function presign(as: string, org: string, project: string, body: Record<string, unknown>) {
  current = as;
  const { POST } = await import('./presign/route');
  return (POST as Handler)(
    new NextRequest(`${base(org, project)}/presign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ orgId: org, id: project, assetId: '' }) },
  );
}
async function item(method: 'PATCH' | 'DELETE', as: string, org: string, project: string, assetId: string, body?: Record<string, unknown>) {
  current = as;
  const mod = (await import('./[assetId]/route')) as unknown as Record<string, Handler>;
  const init = body ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method };
  return mod[method](new NextRequest(`${base(org, project)}/${assetId}`, init), { params: Promise.resolve({ orgId: org, id: project, assetId }) });
}

const kinds = async (res: Response) => ((await res.json()) as { assets: { kind: string }[] }).assets.map((a) => a.kind);
const row = (id: string) => db.tables.project_assets.find((r) => r.id === id);

describe('GET: the files a member may open (sensitivity × role, 06 §2.4)', () => {
  it('owner: all three; A&R: no contract; marketing: artwork only; legal: no session; roster artist: no contract', async () => {
    expect(await kinds(await list(OWN, L, LP1))).toEqual(['artwork', 'session', 'contract']);
    expect(await kinds(await list(AR, L, LP1))).toEqual(['artwork', 'session']);
    expect(await kinds(await list(MKT, L, LP1))).toEqual(['artwork']);
    expect(await kinds(await list(LEG, L, LP1))).toEqual(['artwork', 'contract']);
    expect(await kinds(await list(ART, L, LP1))).toEqual(['artwork', 'session']);
  });

  it('says what the member may add', async () => {
    expect((await (await list(AR, L, LP1)).json()).permissions).toEqual({ write: true, restricted: false, working: true });
    expect((await (await list(LEG, L, LP1)).json()).permissions).toEqual({ write: false, restricted: true, working: false });
    expect((await (await list(MKT, L, LP1)).json()).permissions).toEqual({ write: false, restricted: false, working: false });
  });

  it('never sends a stored reference or the uploader', async () => {
    const body = JSON.stringify(await (await list(OWN, L, LP1)).json());
    expect(body).not.toMatch(/r2:\/\/|orgs\/|created_by/);
    expect(body).toContain(`/api/org/${L}/projects/${LP1}/assets/${A_CON}/download`);
  });

  it('no catalogue → 403; outside the scope, another org, a producer project, a stranger → 404; signed out → 401', async () => {
    expect((await list(FIN, L, LP1)).status).toBe(403);
    expect((await list(AR_C2, L, LP1)).status).toBe(404);
    expect((await list(X, L, LP1)).status).toBe(404);
    expect((await list(X, L2, LP1)).status).toBe(404);
    expect((await list(OWN, L, PP1)).status).toBe(404);
    expect((await list(STRANGER, L, LP1)).status).toBe(404);
    expect((await list(null, L, LP1)).status).toBe(401);
  });

  it('the scoped A&R sees their own artist’s project (empty)', async () => {
    const res = await list(AR_C2, L, LP2);
    expect(res.status).toBe(200);
    expect(await kinds(res)).toEqual([]);
  });
});

describe('download', () => {
  it('a restricted download without contracts.read → 403, nothing streamed, nothing logged', async () => {
    for (const who of [AR, MKT, ART]) expect((await download(who, L, LP1, A_CON)).status, who).toBe(403);
    expect(storage.streamed).toEqual([]);
    expect(db.tables.activity_events).toEqual([]);
  });

  it('working material without audio.working → 403 (marketing, legal on a session)', async () => {
    expect((await download(MKT, L, LP1, A_SES)).status).toBe(403);
    expect((await download(LEG, L, LP1, A_SES)).status).toBe(403);
  });

  it('legal downloads the contract, and the audit event is written first', async () => {
    const res = await download(LEG, L, LP1, A_CON);
    expect(res.status).toBe(200);
    expect(storage.streamed).toEqual([row(A_CON)!.url]);
    expect(db.tables.activity_events).toHaveLength(1);
    expect(db.tables.activity_events[0]).toMatchObject({
      org_id: L, actor_id: LEG, verb: 'file.restricted_downloaded', subject_type: 'asset', subject_id: A_CON,
      project_id: LP1, audit: true, visibility: 'internal', payload: { kind: 'contract', inline: false },
    });
  });

  it('later Range chunks of the same download are not audited again', async () => {
    expect((await download(LEG, L, LP1, A_CON, 'bytes=0-')).status).toBe(200);
    expect((await download(LEG, L, LP1, A_CON, 'bytes=65536-')).status).toBe(200);
    expect((await download(LEG, L, LP1, A_CON, 'bytes=131072-')).status).toBe(200);
    expect(db.tables.activity_events).toHaveLength(1);
    expect(storage.streamed).toHaveLength(3);
  });

  it('if the audit event cannot be written, nothing is downloaded', async () => {
    failWritesTo = 'activity_events';
    const res = await download(OWN, L, LP1, A_CON);
    expect(res.status).toBe(500);
    expect(storage.streamed).toEqual([]);
  });

  it('a normal download streams without an audit event', async () => {
    expect((await download(MKT, L, LP1, A_ART)).status).toBe(200);
    expect((await download(AR, L, LP1, A_SES)).status).toBe(200);
    expect(db.tables.activity_events).toEqual([]);
  });

  it('the wrong project, another org’s file, a producer file, out of scope → 404', async () => {
    expect((await download(OWN, L, LP2, A_ART)).status).toBe(404);
    expect((await download(OWN, L, LP1, X_ART)).status).toBe(404);
    expect((await download(X, L2, XP1, A_ART)).status).toBe(404);
    expect((await download(OWN, L, PP1, P_FILE)).status).toBe(404);
    expect((await download(AR_C2, L, LP1, A_CON)).status).toBe(404);
  });

  it('a stored reference that is not this org project’s key is treated as missing', async () => {
    row(A_ART)!.url = 'r2://priv/project-assets/' + LP1 + '/abcdefgh.png';
    expect((await download(OWN, L, LP1, A_ART)).status).toBe(404);
    row(A_ART)!.url = `r2://public/${key(L, LP1, 'abcdefgh', 'png')}`;
    expect((await download(OWN, L, LP1, A_ART)).status).toBe(404);
    expect(storage.streamed).toEqual([]);
  });
});

describe('POST: adding a file', () => {
  it('A&R adds artwork: ownerless org row, uploader in created_by, stored under orgs/<org>/assets/<project>/, event recorded', async () => {
    const res = await upload(AR, L, LP1, 'cover.png');
    expect(res.status).toBe(201);
    const { asset } = await res.json();
    expect(asset).toMatchObject({ kind: 'artwork', sensitivity: 'normal', label: 'cover', in_portal: false });
    expect(JSON.stringify(asset)).not.toMatch(/r2:\/\//);
    expect(storage.stored).toHaveLength(1);
    expect(storage.stored[0].key).toMatch(new RegExp(`^orgs/${L}/assets/${LP1}/[A-Za-z0-9_-]{16}\\.png$`));
    expect(storage.stored[0].mime).toBe('image/png');
    expect(row(asset.id)).toMatchObject({ user_id: null, created_by: AR, org_id: L, project_id: LP1, position: 3, in_portal: false });
    expect(db.tables.activity_events).toEqual([
      expect.objectContaining({ verb: 'file.uploaded', actor_id: AR, subject_id: asset.id, project_id: LP1, audit: false, visibility: 'artist' }),
    ]);
  });

  it('a contract is restricted whatever is asked; A&R may not add one (nothing stored), legal may', async () => {
    expect((await upload(AR, L, LP1, 'Nova recording agreement.pdf')).status).toBe(403);
    expect((await upload(AR, L, LP1, 'deal.pdf', { kind: 'contract', sensitivity: 'normal' })).status).toBe(403);
    expect(storage.stored).toEqual([]);
    const res = await upload(LEG, L, LP1, 'deal.pdf', { kind: 'contract', sensitivity: 'normal' });
    expect(res.status).toBe(201);
    const { asset } = await res.json();
    expect(asset).toMatchObject({ kind: 'contract', sensitivity: 'restricted' });
    expect(db.tables.activity_events.at(-1)).toMatchObject({ verb: 'file.uploaded', visibility: 'internal' });
  });

  it('legal cannot add a normal file (catalogue read-only); marketing and finance cannot add anything', async () => {
    expect((await upload(LEG, L, LP1, 'cover.png')).status).toBe(403);
    expect((await upload(MKT, L, LP1, 'press photo.jpg')).status).toBe(403);
    expect((await upload(FIN, L, LP1, 'cover.png')).status).toBe(403);
    expect(storage.stored).toEqual([]);
  });

  it('accepts DAW sessions and video; still refuses scripts', async () => {
    expect((await upload(AR, L, LP1, 'Midnight.als')).status).toBe(201);
    expect((await upload(AR, L, LP1, 'teaser.webm')).status).toBe(201);
    expect((await upload(OWN, L, LP1, 'x.html')).status).toBe(415);
    expect((await upload(OWN, L, LP1, 'x.svg')).status).toBe(415);
    expect(db.tables.project_assets.filter((r) => r.org_id === L).map((r) => r.kind)).toEqual(
      expect.arrayContaining(['session', 'video']),
    );
  });

  it('outside the scope or another org → 404, nothing stored', async () => {
    expect((await upload(AR_C2, L, LP1, 'cover.png')).status).toBe(404);
    expect((await upload(X, L, LP1, 'cover.png')).status).toBe(404);
    expect((await upload(OWN, L, PP1, 'cover.png')).status).toBe(404);
    expect(storage.stored).toEqual([]);
  });

  it('registers a presigned upload only with this org project’s own key', async () => {
    const good = ref(L, LP1, 'abcdefgh12', 'pdf');
    storage.sizes.set(good, 5_000_000);
    const res = await register(LEG, L, LP1, { url: good, file_name: 'Split sheet.pdf' });
    expect(res.status).toBe(201);
    expect((await res.json()).asset).toMatchObject({ kind: 'split_sheet', sensitivity: 'restricted', size_bytes: 5_000_000 });

    for (const bad of [
      ref(L, LP2, 'abcdefgh12', 'pdf'),
      ref(L2, LP1, 'abcdefgh12', 'pdf'),
      `r2://priv/project-assets/${LP1}/abcdefgh12.pdf`,
      `r2://priv/orgs/${L}/tracks/abcdefgh12.wav`,
      `r2://public/${key(L, LP1, 'abcdefgh12', 'pdf')}`,
    ]) {
      expect((await register(OWN, L, LP1, { url: bad, file_name: 'a.pdf' })).status, bad).toBe(400);
    }
    expect((await register(OWN, L, LP1, { url: good, file_name: 'a.pdf', in_portal: true })).status).toBe(400);
    // The same object registered twice would give two rows one file.
    expect((await register(OWN, L, LP1, { url: good, file_name: 'Split sheet.pdf' })).status).toBe(409);
    expect(storage.deleted).toEqual([]);
  });

  it('a refused presigned upload is removed from storage', async () => {
    const deal = ref(L, LP1, 'dealdeal12', 'pdf');
    storage.sizes.set(deal, 10);
    expect((await register(AR, L, LP1, { url: deal, file_name: 'Nova contract.pdf' })).status).toBe(403);
    expect(storage.deleted).toEqual([deal]);
  });

  it('legal adds a scanned document as restricted; the same file as normal is refused', async () => {
    expect((await upload(LEG, L, LP1, 'scan.pdf')).status).toBe(403);
    const res = await upload(LEG, L, LP1, 'scan.pdf', { sensitivity: 'restricted' });
    expect(res.status).toBe(403); // a document is working material, which legal cannot open
    expect((await upload(LEG, L, LP1, 'scan.pdf', { kind: 'contract' })).status).toBe(201);
  });

  it('an unfinished presigned upload is 409; a refused type is deleted', async () => {
    expect((await register(OWN, L, LP1, { url: ref(L, LP1, 'zzzzzzzz12', 'pdf'), file_name: 'a.pdf' })).status).toBe(409);
    const html = ref(L, LP1, 'yyyyyyyy12', 'pdf');
    storage.sizes.set(html, 10);
    expect((await register(OWN, L, LP1, { url: html, file_name: 'a.html' })).status).toBe(415);
    expect(storage.deleted).toEqual([html]);
  });
});

describe('presign', () => {
  it('mints a key under the org project; marketing and finance cannot; legal can', async () => {
    const res = await presign(AR, L, LP1, { file_name: 'Midnight session.zip', size_bytes: 50_000_000 });
    expect(res.status).toBe(200);
    expect(storage.presigned[0]).toMatch(new RegExp(`^orgs/${L}/assets/${LP1}/[A-Za-z0-9_-]{16}\\.zip$`));
    expect((await presign(LEG, L, LP1, { file_name: 'deal.pdf', size_bytes: 10 })).status).toBe(200);
    expect((await presign(MKT, L, LP1, { file_name: 'a.pdf', size_bytes: 10 })).status).toBe(403);
    expect((await presign(FIN, L, LP1, { file_name: 'a.pdf', size_bytes: 10 })).status).toBe(403);
    expect((await presign(AR_C2, L, LP1, { file_name: 'a.pdf', size_bytes: 10 })).status).toBe(404);
    expect((await presign(OWN, L, LP1, { file_name: 'a.svg', size_bytes: 10 })).status).toBe(415);
  });
});

describe('PATCH / DELETE', () => {
  it('A&R renames the artwork', async () => {
    const res = await item('PATCH', AR, L, LP1, A_ART, { label: 'Front cover' });
    expect(res.status).toBe(200);
    expect(row(A_ART)).toMatchObject({ label: 'Front cover', sensitivity: 'normal' });
    expect(db.tables.activity_events).toEqual([
      expect.objectContaining({
        verb: 'file.updated',
        actor_id: AR,
        subject_id: A_ART,
        project_id: LP1,
        audit: false,
        visibility: 'artist',
        payload: { fields: ['label'], kind: 'artwork', sensitivity: 'normal' },
      }),
    ]);
  });

  it('a change to a restricted file is recorded business-internal, and a refused one is not recorded at all', async () => {
    expect((await item('PATCH', AR, L, LP1, A_CON, { label: 'x' })).status).toBe(403);
    expect(db.tables.activity_events).toEqual([]);
    await item('PATCH', OWN, L, LP1, A_CON, { label: 'Signed' });
    expect(db.tables.activity_events).toEqual([expect.objectContaining({ verb: 'file.updated', subject_id: A_CON, visibility: 'internal' })]);
  });

  it('A&R cannot touch the contract (403), nor restrict a file they could then not open', async () => {
    expect((await item('PATCH', AR, L, LP1, A_CON, { label: 'x' })).status).toBe(403);
    expect((await item('PATCH', AR, L, LP1, A_ART, { sensitivity: 'restricted' })).status).toBe(403);
    expect((await item('PATCH', AR, L, LP1, A_ART, { kind: 'contract' })).status).toBe(403);
    expect(row(A_CON)!.label).toBe('contract file');
    expect(row(A_ART)!.sensitivity).toBe('normal');
  });

  it('a contract stays restricted; changing its kind keeps the restriction unless lifted by someone who may', async () => {
    await item('PATCH', OWN, L, LP1, A_CON, { sensitivity: 'normal' });
    expect(row(A_CON)!.sensitivity).toBe('restricted');
    expect((await item('PATCH', OWN, L, LP1, A_CON, { kind: 'document' })).status).toBe(200);
    expect(row(A_CON)).toMatchObject({ kind: 'document', sensitivity: 'restricted' });
    // Legal may not move it into working material they cannot open.
    expect((await item('PATCH', LEG, L, LP1, A_CON, { label: 'y' })).status).toBe(403);
  });

  it('marketing cannot edit; scope and other orgs are 404; a bad body is 400', async () => {
    expect((await item('PATCH', MKT, L, LP1, A_ART, { label: 'x' })).status).toBe(403);
    expect((await item('PATCH', AR_C2, L, LP1, A_ART, { label: 'x' })).status).toBe(404);
    expect((await item('PATCH', OWN, L, LP1, X_ART, { label: 'x' })).status).toBe(404);
    expect((await item('PATCH', OWN, L, LP1, A_ART, { in_portal: true })).status).toBe(400);
    expect((await item('PATCH', OWN, L, LP1, A_ART, {})).status).toBe(400);
  });

  it('A&R deletes the session (row, then object); not the contract; marketing nothing', async () => {
    const url = row(A_SES)!.url;
    expect((await item('DELETE', AR, L, LP1, A_SES)).status).toBe(200);
    expect(row(A_SES)).toBeUndefined();
    expect(storage.deleted).toEqual([url]);
    expect(db.tables.activity_events).toEqual([
      expect.objectContaining({ verb: 'file.deleted', actor_id: AR, subject_id: A_SES, project_id: LP1, audit: false, visibility: 'artist' }),
    ]);
    expect((await item('DELETE', AR, L, LP1, A_CON)).status).toBe(403);
    expect((await item('DELETE', MKT, L, LP1, A_ART)).status).toBe(403);
    expect((await item('DELETE', OWN, L, PP1, P_FILE)).status).toBe(404);
    expect(row(A_CON)).toBeDefined();
    expect(row(P_FILE)).toBeDefined();
  });
});
