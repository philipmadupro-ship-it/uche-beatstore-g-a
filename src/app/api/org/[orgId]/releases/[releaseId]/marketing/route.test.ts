/**
 * The marketing plan routes (LABEL-65), through the REAL lib/auth/org-access
 * and the real route code against an in-memory database.
 *
 *   L (label): artists C1 Nova, C2 Kilo. Release R1 (Nova's project LP1), R2 (Kilo's LP2), R3 cancelled.
 *   Members: OWN (owner), MKT (marketing function: reads, approves marketing, business reader, NO audio.working),
 *   AR (a_and_r: release.write, NOT a business reader), PM (project_manager: release.write + business reader), FIN (finance: reads, business reader, cannot write),
 *   PRO (producer function: catalog.write, no business reader, cannot write), ART (role artist scoped to C1),
 *   AR2 (a_and_r scoped to C2). L2: owner X, release RX.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const MKT = u(2);
const AR = u(3);
const FIN = u(4);
const PRO = u(5);
const ART = u(6);
const AR2 = u(7);
const X = u(8);
const PM = u(9);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const R3 = '70000000-0000-4000-8000-000000000003';
const RX = '70000000-0000-4000-8000-000000000004';
const DEMO = '50000000-0000-4000-8000-000000000001';

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
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'insert', 'update', 'delete', 'upsert']) q[m] = () => q;
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

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missing = new Set();
  db = {
    unique: { marketing_plans: [['release_id']], marketing_platform_steps: [['plan_id', 'platform', 'step']] },
    rpc: auditRpcMemory(),
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null, settings: {} },
        { id: L2, kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(MKT, 'member', ['marketing']),
        member(AR, 'member', ['a_and_r']),
        member(PM, 'member', ['project_manager']),
        member(FIN, 'member', ['finance']),
        member(PRO, 'member', ['producer']),
        member(ART, 'artist', [], 'artists'),
        member(AR2, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: ART, contact_id: C1 }, { org_id: L, user_id: AR2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      releases: [release(R1, L, LP1, C1), release(R2, L, LP2, C2), release(R3, L, LP1, C1, { state: 'cancelled' }), release(RX, L2, XP1, CX)],
      tracks: [{ id: DEMO, org_id: L, user_id: null, type: 'song', title: 'Working demo', audio_url: 'r2://private/orgs/x/demo.wav' }],
      marketing_plans: [],
      marketing_plan_items: [],
      marketing_platform_steps: [],
      marketing_budget_lines: [],
      marketing_asset_requests: [],
      notifications: [],
      activity_events: [],
      org_entitlements: [],
    },
  };
  mem = memoryAdmin(db);
});

const loaders = import.meta.glob('./**/route.ts') as Record<string, () => Promise<unknown>>;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(as: string | null, method: string, path: string, params: Record<string, string>, body?: unknown, org = L, release = R1) {
  current = as;
  const load = loaders[`./${path}route.ts`];
  const mod = (await load()) as unknown as Record<string, Handler>;
  const url = `https://app.test/api/org/${org}/releases/${release}/marketing/${path}`;
  const req = new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
  return mod[method](req, { params: Promise.resolve({ orgId: org, releaseId: release, ...params }) });
}
const get = (as: string | null, org = L, release = R1) => call(as, 'GET', '', {}, undefined, org, release);
const addItem = (as: string | null, body: unknown = { phase: 'teaser', title: 'Snippet on socials', due_on: '2026-12-01' }, release = R1) => call(as, 'POST', 'items/', {}, body, L, release);

describe('who reads a plan', () => {
  it('a marketing member reads an empty plan and may write it', async () => {
    const res = await get(MKT);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({ schemaReady: true, plan: null, required: false });
    expect(b.me).toMatchObject({ canWrite: true, canWriteBudget: true, canSetRequired: false });
  });
  it('is 404 for another org, another artist, a signed-out caller is 401, a missing release is 404', async () => {
    expect((await get(X, L, R1)).status).toBe(404);
    expect((await get(AR2, L, R1)).status).toBe(404);
    expect((await get(null)).status).toBe(401);
    expect((await get(OWN, L, '70000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await get(OWN, L2, RX)).status).toBe(404);
  });
  it('is 404 in an org not licensed for marketing, for the owner too', async () => {
    db.tables.org_entitlements.push({ org_id: L, modules: ['contracts', 'finance'], max_seats: null, max_artists: null, setup_done: true });
    expect((await get(OWN)).status).toBe(404);
    expect((await addItem(OWN)).status).toBe(404);
  });
  it('answers schemaReady:false without migration 183 and 503 naming it for a write', async () => {
    missing = new Set(['marketing_plans']);
    expect(await (await get(OWN)).json()).toEqual({ schemaReady: false });
    const w = await addItem(OWN);
    expect(w.status).toBe(503);
    expect((await w.json()).error).toMatch(/183/);
  });
});

describe('who writes the timeline', () => {
  it('release.write and the marketing approval write; a reader or a producer or the artist does not', async () => {
    expect((await addItem(AR)).status).toBe(201);
    expect((await addItem(MKT, { phase: 'release', title: 'Drop day', due_on: '2026-12-05' })).status).toBe(201);
    for (const who of [FIN, PRO, ART]) expect((await addItem(who)).status, who).toBe(403);
    expect(db.tables.marketing_plans).toHaveLength(1);
    expect(db.tables.marketing_plan_items).toHaveLength(2);
  });
  it('is 404, not 403, for a member outside the artist scope, and nothing is created', async () => {
    expect((await addItem(AR2)).status).toBe(404);
    expect(db.tables.marketing_plans).toHaveLength(0);
  });
  it('validates the body and refuses a cancelled release', async () => {
    expect((await addItem(MKT, { phase: 'launch', title: 'x', due_on: '2026-12-05' })).status).toBe(400);
    expect((await addItem(MKT, { phase: 'teaser', title: 'x', due_on: '2026-02-31' })).status).toBe(400);
    expect((await addItem(MKT, { phase: 'teaser', title: '  ', due_on: '2026-12-05' })).status).toBe(400);
    expect((await addItem(MKT, undefined, R3)).status).toBe(409);
  });
  it('makes one plan however many writes, and shows the timeline in date order', async () => {
    await addItem(MKT, { phase: 'post', title: 'Wrap-up', due_on: '2026-12-20' });
    await addItem(MKT, { phase: 'teaser', title: 'Snippet', due_on: '2026-11-20' });
    expect(db.tables.marketing_plans).toHaveLength(1);
    const b = await (await get(MKT)).json();
    expect(b.items.map((i: { title: string }) => i.title)).toEqual(['Snippet', 'Wrap-up']);
    expect(b.gate.missing).toEqual(['release']);
  });
  it('edits, completes and removes a milestone; a milestone of another plan is 404', async () => {
    const made = await (await addItem(MKT)).json();
    const id = made.item.id as string;
    const p = await call(MKT, 'PATCH', 'items/[itemId]/', { itemId: id }, { done: true, title: 'Snippet v2' });
    expect(p.status).toBe(200);
    expect((await p.json()).item).toMatchObject({ title: 'Snippet v2' });
    expect((await call(MKT, 'PATCH', 'items/[itemId]/', { itemId: id }, {})).status).toBe(400);
    expect((await call(MKT, 'PATCH', 'items/[itemId]/', { itemId: 'nope' }, { done: true })).status).toBe(404);
    expect((await call(FIN, 'DELETE', 'items/[itemId]/', { itemId: id })).status).toBe(403);
    expect((await call(MKT, 'DELETE', 'items/[itemId]/', { itemId: id })).status).toBe(200);
    expect(db.tables.marketing_plan_items).toHaveLength(0);
    // The plan exists only on R1; a PATCH on R2 (no plan) is 404 and makes none.
    expect((await call(AR2, 'PATCH', 'items/[itemId]/', { itemId: id }, { done: true }, L, R2)).status).toBe(404);
    expect(db.tables.marketing_plans).toHaveLength(1);
  });
  it('ticks and unticks the platform checklist idempotently', async () => {
    const tick = (done: boolean) => call(MKT, 'PUT', 'platform/', {}, { platform: 'spotify', step: 'pitch', done });
    expect((await tick(true)).status).toBe(200);
    expect((await tick(true)).status).toBe(200);
    expect(db.tables.marketing_platform_steps).toHaveLength(1);
    const b = await (await get(MKT)).json();
    expect(b.checklist[0].steps[0]).toMatchObject({ step: 'pitch', done: true });
    expect((await tick(false)).status).toBe(200);
    expect(db.tables.marketing_platform_steps).toHaveLength(0);
    expect((await call(MKT, 'PUT', 'platform/', {}, { platform: 'myspace', step: 'pitch', done: true })).status).toBe(400);
    expect((await call(FIN, 'PUT', 'platform/', {}, { platform: 'spotify', step: 'pitch', done: true })).status).toBe(403);
  });
});

describe('the budget is business data', () => {
  const line = { label: 'Playlist pitching', amount_minor: '150000', currency: 'USD' };
  const addLine = (as: string, body: unknown = line) => call(as, 'POST', 'budget/', {}, body);

  it('is written by a business reader who may write the plan, in integer minor units', async () => {
    expect((await addLine(MKT)).status).toBe(201);
    expect((await addLine(PM, { ...line, label: 'Ads', amount_minor: '123456789012345', status: 'committed' })).status).toBe(201);
    const b = await (await get(MKT)).json();
    expect(b.budget.lines.map((l: { amountMinor: string }) => l.amountMinor)).toEqual(['150000', '123456789012345']);
    expect(b.budget.totals).toEqual([{ currency: 'USD', planned: '150000', committed: '123456789012345', spent: '0', total: '123456789162345' }]);
  });
  it('is refused to a reader who is not a business reader, to the artist, and to a business reader who cannot write the plan', async () => {
    // AR may write the plan but is not a business reader; FIN is the reverse; PRO and ART are neither.
    for (const who of [PRO, ART, FIN, AR]) expect((await addLine(who)).status, who).toBe(403);
    expect(db.tables.marketing_budget_lines).toHaveLength(0);
  });
  it('is ABSENT from the payload for the artist and for a reader without the business side, and present for the others', async () => {
    await addLine(MKT);
    for (const who of [ART, PRO]) {
      const b = await (await get(who)).json();
      expect('budget' in b, who).toBe(false);
      expect(JSON.stringify(b), who).not.toMatch(/Playlist pitching|150000|amount/);
    }
    for (const who of [OWN, MKT, PM, FIN]) expect((await (await get(who)).json()).budget.lines, who).toHaveLength(1);
    expect('budget' in (await (await get(AR)).json())).toBe(false);
  });
  it('rejects floats, negatives, unknown currencies and a half-changed amount', async () => {
    for (const bad of [{ ...line, amount_minor: '12.5' }, { ...line, amount_minor: '-5' }, { ...line, currency: 'XXX' }, { ...line, currency: 'usd' }, { ...line, amount_minor: '99999999999999999999' }, { ...line, extra: 1 }]) {
      expect((await addLine(MKT, bad)).status).toBe(400);
    }
    const made = await (await addLine(MKT)).json();
    const id = made.line.id as string;
    expect((await call(MKT, 'PATCH', 'budget/[lineId]/', { lineId: id }, { amount_minor: '5' })).status).toBe(400);
    const ok = await call(MKT, 'PATCH', 'budget/[lineId]/', { lineId: id }, { amount_minor: '5000', currency: 'JPY', status: 'spent' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).line).toMatchObject({ amountMinor: '5000', currency: 'JPY', status: 'spent' });
    expect((await call(ART, 'PATCH', 'budget/[lineId]/', { lineId: id }, { status: 'planned' })).status).toBe(403);
    expect((await call(PRO, 'DELETE', 'budget/[lineId]/', { lineId: id })).status).toBe(403);
    expect((await call(MKT, 'DELETE', 'budget/[lineId]/', { lineId: id })).status).toBe(200);
  });
});

describe('events: ids and field names, never words or amounts', () => {
  it('records marketing_plan.* events with no title, note or amount in any payload', async () => {
    await addItem(MKT, { phase: 'teaser', title: 'SECRETTITLE', due_on: '2026-12-01' });
    await call(MKT, 'POST', 'budget/', {}, { label: 'SECRETLABEL', amount_minor: '777123', currency: 'USD', note: 'SECRETNOTE' });
    await call(MKT, 'POST', 'assets/', {}, { kind: 'photos', note: 'SECRETASK' });
    const events = db.tables.activity_events.filter((e) => String(e.verb).startsWith('marketing_plan.'));
    expect(events.map((e) => e.verb).sort()).toEqual(['marketing_plan.asset_requested', 'marketing_plan.budget_changed', 'marketing_plan.created', 'marketing_plan.item_changed']);
    expect(JSON.stringify(events)).not.toMatch(/SECRET|777123/);
    expect(events.every((e) => e.release_id === R1 && e.artist_id === C1)).toBe(true);
    expect(events.find((e) => e.verb === 'marketing_plan.budget_changed')?.visibility ?? 'internal').toBe('internal');
  });
});

describe('asks to the artist', () => {
  it('tells the one roster artist account, never the asker, and records that it did', async () => {
    const res = await call(MKT, 'POST', 'assets/', {}, { kind: 'photos', note: 'Press shots' });
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.delivery).toBe('notified');
    expect(b.request).toMatchObject({ kind: 'photos', status: 'open', notified: true });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ user_id: ART, org_id: L, kind: 'asset_requested', read: false });
    expect(JSON.stringify(db.tables.notifications[0])).not.toMatch(/@|token|password/i);
    // The payload of the plan never says who was reached.
    expect(JSON.stringify(await (await get(MKT)).json())).not.toContain(ART);
  });
  it('with no account standing for the artist it is recorded, nobody is notified, and the answer says so', async () => {
    db.tables.member_artist_scopes = [];
    const res = await call(MKT, 'POST', 'assets/', {}, { kind: 'bio' });
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.delivery).toBe('nobody_reachable');
    expect(b.request.notified).toBe(false);
    expect(db.tables.notifications).toHaveLength(0);
    expect(db.tables.marketing_asset_requests).toHaveLength(1);
  });
  it('is not sent to label staff scoped to the artist, and a party linked account proves nothing', async () => {
    db.tables.member_artist_scopes = [{ org_id: L, user_id: AR2, contact_id: C1 }];
    db.tables.parties = [{ id: 'p1', org_id: L, user_id: FIN, contact_id: C1 }];
    const b = await (await call(MKT, 'POST', 'assets/', {}, { kind: 'video' })).json();
    expect(b.delivery).toBe('nobody_reachable');
    expect(db.tables.notifications).toHaveLength(0);
  });
  it('asking yourself notifies nobody: the artist cannot ask (no write access)', async () => {
    expect((await call(ART, 'POST', 'assets/', {}, { kind: 'photos' })).status).toBe(403);
  });
  it('marks a request received, cancelled or open again, without notifying', async () => {
    const made = await (await call(MKT, 'POST', 'assets/', {}, { kind: 'photos' })).json();
    const id = made.request.id as string;
    const notified = db.tables.notifications.length;
    const done = await call(MKT, 'PATCH', 'assets/[requestId]/', { requestId: id }, { status: 'fulfilled' });
    expect((await done.json()).request).toMatchObject({ status: 'fulfilled' });
    expect((await call(MKT, 'PATCH', 'assets/[requestId]/', { requestId: id }, { status: 'bogus' })).status).toBe(400);
    expect((await call(FIN, 'PATCH', 'assets/[requestId]/', { requestId: id }, { status: 'cancelled' })).status).toBe(403);
    expect(db.tables.notifications).toHaveLength(notified);
  });
});

describe('D4: the plan never carries or reaches working music', () => {
  it('the marketing function holds no working-audio capability, and the plan payload names no recording', async () => {
    const { capabilitiesFor } = await import('@/lib/labelos/capabilities');
    const caps = capabilitiesFor('label', 'member', ['marketing']);
    expect(caps.has('audio.working')).toBe(false);
    expect(caps.has('audio.finished')).toBe(true);
    await addItem(MKT);
    await call(MKT, 'POST', 'assets/', {}, { kind: 'photos' });
    const body = JSON.stringify(await (await get(MKT)).json());
    expect(body).not.toMatch(/r2:\/\/|audio|preview|\.wav|src|track/i);
    expect(body).not.toContain(DEMO);
  });
});
