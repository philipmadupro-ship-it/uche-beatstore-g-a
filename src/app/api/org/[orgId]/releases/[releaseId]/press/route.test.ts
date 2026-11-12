/**
 * The press-kit member routes (LABEL-66), through the REAL lib/auth/org-access
 * and the real route code against an in-memory database.
 *
 *   L (label): artists C1 Nova, C2 Kilo; press contacts P1 (main role), P2 (extra role); C3 a buyer.
 *   Release R1 (Nova, project LP1), R2 (Kilo, LP2), R3 cancelled. Files: A1 photo (ok), A2 restricted artwork,
 *   A3 photo of ANOTHER project, A4 lyrics, A5 photo that is not a raster image.
 *   Members: OWN (owner), PRM (pr function: pr.read + pr.write), MKT (marketing: no pr), FIN (finance),
 *   ART (role artist scoped to C1, given nothing more), PRS (pr function scoped to C2). L2: owner X.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const PRM = u(2);
const MKT = u(3);
const FIN = u(4);
const ART = u(5);
const PRS = u(6);
const X = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const C3 = '30000000-0000-4000-8000-0000000000c3';
const CX = '30000000-0000-4000-8000-0000000000c4';
const P1 = '30000000-0000-4000-8000-0000000000d1';
const P2 = '30000000-0000-4000-8000-0000000000d2';
const PX = '30000000-0000-4000-8000-0000000000d3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const R3 = '70000000-0000-4000-8000-000000000003';
const RX = '70000000-0000-4000-8000-000000000004';
const A1 = '60000000-0000-4000-8000-0000000000a1';
const A2 = '60000000-0000-4000-8000-0000000000a2';
const A3 = '60000000-0000-4000-8000-0000000000a3';
const A4 = '60000000-0000-4000-8000-0000000000a4';
const A5 = '60000000-0000-4000-8000-0000000000a5';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
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
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'insert', 'update', 'delete', 'upsert', 'or']) q[m] = () => q;
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
const release = (id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: org, project_id: project, contact_id: contact, title: 'Night Shift', type: 'single', state: 'draft', ...extra,
});
const asset = (id: string, project: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: L, project_id: project, kind: 'photo', sensitivity: 'normal', label: `File ${id.slice(-2)}`, file_name: 'a.png', mime: 'image/png', url: 'r2://private/x', created_at: '2026-10-01T00:00:00Z', ...extra,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missing = new Set();
  db = {
    unique: { press_kits: [['release_id']], press_outreach: [['release_id', 'contact_id']], press_kit_photos: [['kit_id', 'asset_id']], press_kit_shares: [['token_hash']] },
    rpc: auditRpcMemory(),
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null, settings: {} },
        { id: L2, kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(PRM, 'member', ['pr']),
        member(MKT, 'member', ['marketing']),
        member(FIN, 'member', ['finance']),
        member(ART, 'artist', [], 'artists'),
        member(PRS, 'member', ['pr'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: ART, contact_id: C1 }, { org_id: L, user_id: PRS, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: C3, org_id: L, user_id: null, name: 'Buyer Bo', category: 'buyer', email: 'bo@example.com' },
        { id: P1, org_id: L, user_id: null, name: 'Pat Press', category: 'press', label: 'The Quiet Review', email: 'pat@example.com' },
        { id: P2, org_id: L, user_id: null, name: 'Sam Second', category: 'artist', secondary_category: 'press' },
        { id: PX, org_id: L2, user_id: null, name: 'Xena Press', category: 'press' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      releases: [release(R1, L, LP1, C1), release(R2, L, LP2, C2), release(R3, L, LP1, C1, { state: 'cancelled' }), release(RX, L2, XP1, CX)],
      project_assets: [
        asset(A1, LP1),
        asset(A2, LP1, { kind: 'artwork', sensitivity: 'restricted' }),
        asset(A3, LP2),
        asset(A4, LP1, { kind: 'lyrics' }),
        asset(A5, LP1, { mime: 'image/svg+xml' }),
      ],
      press_kits: [],
      press_kit_links: [],
      press_kit_photos: [],
      press_kit_shares: [],
      press_outreach: [],
      notifications: [],
      activity_events: [],
      org_entitlements: [],
    },
  };
  mem = memoryAdmin(db);
});

const loaders = import.meta.glob('./**/route.ts') as Record<string, () => Promise<unknown>>;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(as: string | null, method: string, path: string, params: Record<string, string>, body?: unknown, org = L, rel = R1) {
  current = as;
  const load = loaders[`./${path}route.ts`];
  const mod = (await load()) as unknown as Record<string, Handler>;
  const url = `https://app.test/api/org/${org}/releases/${rel}/press/${path}`;
  const req = new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
  return mod[method](req, { params: Promise.resolve({ orgId: org, releaseId: rel, ...params }) });
}
const get = (as: string | null, org = L, rel = R1) => call(as, 'GET', '', {}, undefined, org, rel);
const put = (as: string | null, body: unknown, rel = R1) => call(as, 'PUT', '', {}, body, L, rel);
const addLink = (as: string | null, body: unknown = { label: 'Instagram', url: 'https://instagram.com/nova' }, rel = R1) => call(as, 'POST', 'links/', {}, body, L, rel);
const addPhoto = (as: string | null, body: unknown, rel = R1) => call(as, 'POST', 'photos/', {}, body, L, rel);
const addShare = (as: string | null, body: unknown = { label: 'Pitchfork' }, rel = R1) => call(as, 'POST', 'shares/', {}, body, L, rel);
const addOutreach = (as: string | null, body: unknown, rel = R1) => call(as, 'POST', 'outreach/', {}, body, L, rel);

describe('who reads a kit', () => {
  it('a pr member reads an empty kit and may write it; the owner too', async () => {
    for (const who of [PRM, OWN]) {
      const res = await get(who);
      expect(res.status).toBe(200);
      const b = await res.json();
      expect(b).toMatchObject({ schemaReady: true, kit: null, links: [], photos: [], shares: [], me: { canWrite: true, canUseOutreach: true } });
      expect(b.outreach.contacts.map((c: { name: string }) => c.name).sort()).toEqual(['Pat Press', 'Sam Second']);
    }
  });
  it('is 403 without pr.read (marketing, finance), and for the artist role even with the release in scope', async () => {
    for (const who of [MKT, FIN, ART]) expect((await get(who)).status, who).toBe(403);
  });
  it('is 404 for another org, another artist, a missing release; a signed-out caller is 401', async () => {
    expect((await get(X, L, R1)).status).toBe(404);
    expect((await get(PRS, L, R1)).status).toBe(404);
    expect((await get(null)).status).toBe(401);
    expect((await get(OWN, L, '70000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await get(OWN, L2, RX)).status).toBe(404);
  });
  it('is 404 in an org not licensed for pr, for the owner too', async () => {
    db.tables.org_entitlements.push({ org_id: L, modules: ['contracts', 'finance'], max_seats: null, max_artists: null, setup_done: true });
    expect((await get(OWN)).status).toBe(404);
    expect((await put(OWN, { headline: 'x' })).status).toBe(404);
  });
  it('is 404 when the owner switched the pr department off', async () => {
    db.tables.organizations[0].settings = { departments_off: ['pr'] };
    expect((await get(OWN)).status).toBe(404);
  });
  it('a scoped pr member reads their own artist’s kit but has no tracker', async () => {
    const res = await get(PRS, L, R2);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.me).toMatchObject({ canUseOutreach: false });
    expect(b.outreach).toBeUndefined();
    expect((await addOutreach(PRS, { contact_id: P1 }, R2)).status).toBe(403);
  });
  it('answers schemaReady:false without migration 184 and 503 naming it for a write', async () => {
    missing = new Set(['press_kits']);
    expect(await (await get(OWN)).json()).toEqual({ schemaReady: false });
    const w = await put(OWN, { headline: 'x' });
    expect(w.status).toBe(503);
    expect((await w.json()).error).toMatch(/184/);
  });
});

describe('writing the kit', () => {
  it('the first valid write makes the kit and records created + updated with field names only', async () => {
    const res = await put(PRM, { headline: 'Nova returns', bio: 'A very private biography.', embargo_at: '2030-01-01T10:00:00.000Z', pre_embargo_note: 'Soon' });
    expect(res.status).toBe(200);
    expect(db.tables.press_kits).toHaveLength(1);
    const events = db.tables.activity_events.filter((e) => String(e.verb).startsWith('press_kit.'));
    expect(events.map((e) => e.verb)).toEqual(['press_kit.created', 'press_kit.updated']);
    expect(events[1].payload).toEqual({ op: 'details', fields: ['headline', 'bio', 'pre_embargo_note', 'embargo_at'] });
    expect(JSON.stringify(events)).not.toMatch(/biography|Nova returns|Soon|2030/);
    const read = await (await get(PRM)).json();
    expect(read.kit).toMatchObject({ headline: 'Nova returns', embargoAt: '2030-01-01T10:00:00.000Z' });
  });
  it('a refused body leaves no kit and no event behind', async () => {
    for (const body of [{}, { bio: 5 }, { headline: 'x'.repeat(141) }, { embargo_at: 'tomorrow' }, { unknown: 1 }]) {
      expect((await put(PRM, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(db.tables.press_kits).toHaveLength(0);
    expect(db.tables.activity_events).toHaveLength(0);
  });
  it('null clears a field', async () => {
    await put(PRM, { headline: 'A' });
    await put(PRM, { headline: null });
    expect((await (await get(PRM)).json()).kit.headline).toBeNull();
  });
  it('only pr.write writes: pr.read alone, other functions, the artist role and other orgs cannot', async () => {
    db.tables.org_members.push(member(u(40), 'member', ['pr']));
    db.tables.org_members.at(-1)!.cap_revokes = ['pr.write'];
    for (const who of [u(40), MKT, FIN, ART]) expect((await put(who, { headline: 'x' })).status, who).toBe(403);
    expect((await put(X, { headline: 'x' })).status).toBe(404);
    expect(db.tables.press_kits).toHaveLength(0);
  });
  it('a cancelled release has no kit to change', async () => {
    expect((await put(PRM, { headline: 'x' }, R3)).status).toBe(409);
  });
});

describe('links', () => {
  it('accepts https, refuses everything else, removes', async () => {
    const ok = await addLink(PRM);
    expect(ok.status).toBe(201);
    const id = (await ok.json()).link.id;
    for (const url of ['http://example.com', 'javascript:alert(1)', 'https://u:p@example.com', 'https://a b.com', '//x.com']) {
      expect((await addLink(PRM, { label: 'x', url })).status, url).toBe(400);
    }
    const del = await call(PRM, 'DELETE', 'links/[linkId]/', { linkId: id });
    expect(del.status).toBe(200);
    expect(db.tables.press_kit_links).toHaveLength(0);
    expect((await call(PRM, 'DELETE', 'links/[linkId]/', { linkId: id })).status).toBe(404);
    expect((await call(PRM, 'DELETE', 'links/[linkId]/', { linkId: 'nope' })).status).toBe(404);
  });
  it('at most ten', async () => {
    for (let i = 0; i < 10; i += 1) expect((await addLink(PRM, { label: `L${i}`, url: `https://e.com/${i}` })).status).toBe(201);
    expect((await addLink(PRM, { label: 'one more', url: 'https://e.com/x' })).status).toBe(409);
  });
});

describe('photos', () => {
  it('takes an unrestricted raster photo of the release’s own project', async () => {
    const res = await addPhoto(PRM, { asset_id: A1, pre_embargo: true });
    expect(res.status).toBe(201);
    expect(db.tables.press_kit_photos).toHaveLength(1);
    const read = await (await get(PRM)).json();
    expect(read.photos).toEqual([expect.objectContaining({ preEmbargo: true })]);
    expect(read.photoChoices.map((c: { id: string }) => c.id)).toEqual([A1]);
  });
  it('refuses a restricted file, another project’s file, a non-visual file, an SVG, another org’s file', async () => {
    for (const id of [A2, A3, A4, A5, '60000000-0000-4000-8000-0000000000ff']) expect((await addPhoto(PRM, { asset_id: id })).status, id).toBe(400);
    expect(db.tables.press_kit_photos).toHaveLength(0);
  });
  it('a duplicate is 409; the mark and caption change; remove', async () => {
    const id = (await (await addPhoto(PRM, { asset_id: A1 })).json()).photo.id;
    expect((await addPhoto(PRM, { asset_id: A1 })).status).toBe(409);
    const patch = await call(PRM, 'PATCH', 'photos/[photoId]/', { photoId: id }, { pre_embargo: true, caption: 'Cover shoot' });
    expect(patch.status).toBe(200);
    expect(db.tables.press_kit_photos[0]).toMatchObject({ pre_embargo: true, caption: 'Cover shoot' });
    const payload = db.tables.activity_events.at(-1)!.payload as { fields: string[] };
    expect({ ...payload, fields: [...payload.fields].sort() }).toEqual({ op: 'photo_updated', photoId: id, fields: ['caption', 'pre_embargo'] });
    expect((await call(PRM, 'DELETE', 'photos/[photoId]/', { photoId: id })).status).toBe(200);
  });
});

describe('share links', () => {
  it('returns the token once and stores only its hash', async () => {
    const res = await addShare(PRM, { label: 'Pitchfork', expires_at: '2099-01-01T00:00:00.000Z' });
    expect(res.status).toBe(201);
    const b = await res.json();
    const token = String(b.path).replace('/press/', '');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(db.tables)).not.toContain(token);
    expect(db.tables.press_kit_shares[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    const events = db.tables.activity_events.filter((e) => e.verb === 'press_kit.shared');
    expect(events[0].payload).toEqual({ shareId: b.share.id, expires: true });
    // The owner view lists the link without its token or hash.
    const read = await (await get(PRM)).json();
    expect(JSON.stringify(read)).not.toContain(token);
    expect(JSON.stringify(read)).not.toContain('token_hash');
    expect(read.shares[0]).toMatchObject({ label: 'Pitchfork', state: 'live', views: 0 });
  });
  it('refuses an expiry in the past and a blank label', async () => {
    expect((await addShare(PRM, { label: 'x', expires_at: '2001-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await addShare(PRM, { label: '  ' })).status).toBe(400);
  });
  it('revokes once; a second revoke and an unknown id are 404', async () => {
    const id = (await (await addShare(PRM)).json()).share.id;
    expect((await call(PRM, 'DELETE', 'shares/[shareId]/', { shareId: id })).status).toBe(200);
    expect((await call(PRM, 'DELETE', 'shares/[shareId]/', { shareId: id })).status).toBe(404);
    expect((await (await get(PRM)).json()).shares[0].state).toBe('revoked');
  });
  it('makes and revokes a link through the audit functions (199): the event is audit class and the change rolls back with it', async () => {
    const id = (await (await addShare(PRM)).json()).share.id;
    expect(db.tables.activity_events.filter((e) => e.verb === 'press_kit.shared')[0]).toMatchObject({ audit: true, visibility: 'internal' });
    expect((await call(PRM, 'DELETE', 'shares/[shareId]/', { shareId: id })).status).toBe(200);
    expect(db.tables.activity_events.filter((e) => e.verb === 'press_kit.share_revoked')[0]).toMatchObject({ audit: true, payload: { shareId: id } });
  });
  it('a link whose audit event cannot be written is not made, and a revoke whose event cannot be written does not stand', async () => {
    const id = (await (await addShare(PRM)).json()).share.id;
    db.rpc = auditRpcMemory({ failAudit: () => true });
    expect((await addShare(PRM, { label: 'Second' })).status).toBe(500);
    expect(db.tables.press_kit_shares).toHaveLength(1);
    expect((await call(PRM, 'DELETE', 'shares/[shareId]/', { shareId: id })).status).toBe(500);
    expect(db.tables.press_kit_shares[0].revoked_at).toBeNull();
  });
  it('without migration 199 the old path still works, undone if its event cannot be written', async () => {
    db.rpc = {};
    const made = await addShare(PRM);
    expect(made.status).toBe(201);
    const id = (await made.json()).share.id;
    expect(db.tables.activity_events.filter((e) => e.verb === 'press_kit.shared')[0]).toMatchObject({ audit: true });
    expect((await call(PRM, 'DELETE', 'shares/[shareId]/', { shareId: id })).status).toBe(200);
    expect(db.tables.press_kit_shares[0].revoked_at).toBeTruthy();
  });
  it('only pr.write makes a link', async () => {
    expect((await addShare(MKT)).status).toBe(403);
    expect((await addShare(X)).status).toBe(404);
  });
});

describe('outreach', () => {
  it('adds a press contact (main or extra role) once', async () => {
    expect((await addOutreach(PRM, { contact_id: P1 })).status).toBe(201);
    expect((await addOutreach(PRM, { contact_id: P2, sent: true })).status).toBe(201);
    expect((await addOutreach(PRM, { contact_id: P1 })).status).toBe(409);
    expect(db.tables.press_outreach[1].sent_at).toBeTruthy();
    expect(JSON.stringify(db.tables.activity_events)).not.toMatch(/Pat|pat@example/);
  });
  it('refuses a contact who is not press, another org’s press contact and an unknown id', async () => {
    for (const id of [C1, C3, PX, '30000000-0000-4000-8000-0000000000ff']) expect((await addOutreach(PRM, { contact_id: id })).status, id).toBe(400);
  });
  it('moves along the tracker, stamping once, and clearing a step clears the later ones', async () => {
    const id = (await (await addOutreach(PRM, { contact_id: P1 })).json()).outreach.id;
    const patch = (b: unknown) => call(PRM, 'PATCH', 'outreach/[outreachId]/', { outreachId: id }, b);
    expect((await (await patch({ sent: true })).json()).outreach.stage).toBe('sent');
    const sentAt = db.tables.press_outreach[0].sent_at;
    expect((await (await patch({ replied: true })).json()).outreach.stage).toBe('replied');
    expect(db.tables.press_outreach[0].sent_at).toBe(sentAt);
    expect((await (await patch({ opened: false })).json()).outreach.stage).toBe('sent');
    expect(db.tables.press_outreach[0].replied_at).toBeNull();
    expect((await (await patch({ sent: false })).json()).outreach.stage).toBe('planned');
    expect((await patch({})).status).toBe(400);
  });
  it('coverage is https only and the event never carries it', async () => {
    const id = (await (await addOutreach(PRM, { contact_id: P1 })).json()).outreach.id;
    const patch = (b: unknown) => call(PRM, 'PATCH', 'outreach/[outreachId]/', { outreachId: id }, b);
    for (const url of ['http://e.com/a', 'javascript:alert(1)', 'ftp://e.com']) expect((await patch({ coverage_url: url })).status, url).toBe(400);
    expect((await patch({ coverage_url: 'https://e.com/review' })).status).toBe(200);
    expect(db.tables.press_outreach[0].coverage_url).toBe('https://e.com/review');
    expect(JSON.stringify(db.tables.activity_events)).not.toContain('e.com');
    expect((await patch({ coverage_url: null })).status).toBe(200);
    expect(db.tables.press_outreach[0].coverage_url).toBeNull();
  });
  it('removes; a stranger and a read-only member cannot touch it', async () => {
    const id = (await (await addOutreach(PRM, { contact_id: P1 })).json()).outreach.id;
    expect((await call(MKT, 'DELETE', 'outreach/[outreachId]/', { outreachId: id })).status).toBe(403);
    expect((await call(X, 'DELETE', 'outreach/[outreachId]/', { outreachId: id })).status).toBe(404);
    expect((await call(PRM, 'DELETE', 'outreach/[outreachId]/', { outreachId: id })).status).toBe(200);
    expect(db.tables.press_outreach).toHaveLength(0);
  });
  it('the tracker lists names and outlets, never an email address', async () => {
    await addOutreach(PRM, { contact_id: P1 });
    const body = JSON.stringify(await (await get(PRM)).json());
    expect(body).toContain('Pat Press');
    expect(body).toContain('The Quiet Review');
    expect(body).not.toContain('pat@example.com');
  });
});
