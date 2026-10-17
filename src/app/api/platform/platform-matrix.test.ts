/**
 * The platform console (LABEL-47) through the REAL lib/auth/platform-access,
 * org-access and the routes, against an in-memory database.
 *
 *   L1, L2: label orgs, each with an owner, an admin, a member and a roster
 *   artist; A: an artist org; P: the producer's own org. EXT: an external
 *   member of an L1 project. PROD: the producer (owns P, not an operator).
 *   OP: the platform operator (a platform_admins row), in no org at all.
 *
 * Proven: every console handler is 404 for every one of them but OP —
 * signed out, org owners of both orgs, admins, members, roster artists, an
 * external member, the producer — and writes nothing; OP lists, creates,
 * licenses and invites; and every handler under /api/platform is in this
 * matrix and goes through an audited write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const id = (p: string, n: number) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const L1 = id('10000000', 1);
const L2 = id('10000000', 2);
const A = id('10000000', 3);
const P = id('10000000', 4);
const PROJ = id('40000000', 1);
const u = (n: number) => id('20000000', n);
const OP = u(1);
const PROD = u(2);
const EXT = u(3);
const STRANGER = u(4);
const PEOPLE: Record<string, string> = {
  'L1 owner': u(10), 'L1 admin': u(11), 'L1 member': u(12), 'L1 artist': u(13),
  'L2 owner': u(20), 'L2 admin': u(21), 'L2 member': u(22), 'L2 artist': u(23),
  'A owner': u(30), external: EXT, producer: PROD, stranger: STRANGER,
};

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
const emails: { to: string; role: string }[] = [];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '127.0.0.1' }));
vi.mock('@/lib/labelos/invitation-email', () => ({
  inviterDisplayName: async () => 'The operator',
  sendInvitationEmail: async (o: { to: string; role: string }) => {
    emails.push({ to: o.to, role: o.role });
    return { sent: true, id: 'e1' };
  },
}));

const member = (org: string, user: string, role: string, functions: string[] = []) => ({
  org_id: org, user_id: user, role, functions, scope: role === 'artist' ? 'artists' : 'org', cap_grants: [], cap_revokes: [],
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  emails.length = 0;
  db = {
    tables: {
      platform_admins: [{ user_id: OP }],
      organizations: [
        { id: L1, name: 'Label One', slug: 'label-one', kind: 'label', deleted_at: null, created_at: '2026-10-01' },
        { id: L2, name: 'Label Two', slug: 'label-two', kind: 'label', deleted_at: null, created_at: '2026-10-02' },
        { id: A, name: 'Solo', slug: 'solo', kind: 'artist', deleted_at: null, created_at: '2026-10-03' },
        { id: P, name: 'Studio', slug: 'studio', kind: 'producer', deleted_at: null, created_at: '2026-09-01' },
      ],
      org_members: [
        member(L1, PEOPLE['L1 owner'], 'owner'), member(L1, PEOPLE['L1 admin'], 'admin'),
        member(L1, PEOPLE['L1 member'], 'member', ['a_and_r']), member(L1, PEOPLE['L1 artist'], 'artist'),
        member(L2, PEOPLE['L2 owner'], 'owner'), member(L2, PEOPLE['L2 admin'], 'admin'),
        member(L2, PEOPLE['L2 member'], 'member', ['legal']), member(L2, PEOPLE['L2 artist'], 'artist'),
        member(A, PEOPLE['A owner'], 'owner'), member(P, PROD, 'owner'),
      ],
      project_members: [{ org_id: L1, project_id: PROJ, user_id: EXT, role: 'editor', allow_downloads: true, expires_at: null }],
      contacts: [{ id: id('30000000', 1), org_id: L1, user_id: null, category: 'artist', secondary_category: null }],
      org_entitlements: [],
      org_invitations: [],
      activity_events: [],
    },
    rpc: {
      labelos_platform_create_licensee: (a, t) => {
        if (!t.platform_admins.some((r) => r.user_id === a.p_actor)) return { data: { error: 'not_operator' }, error: null };
        if (t.organizations.some((o) => o.slug === a.p_slug)) return { data: { error: 'slug_taken' }, error: null };
        const org = { id: id('10000000', 90 + t.organizations.length), name: a.p_name, slug: a.p_slug, kind: a.p_kind, deleted_at: null, created_at: '2026-10-17' };
        t.organizations.push(org);
        t.org_entitlements.push({ org_id: org.id, modules: a.p_modules, max_seats: a.p_max_seats, max_artists: a.p_max_artists, setup_done: false, granted_by: a.p_actor });
        t.activity_events.push({ org_id: org.id, actor_id: a.p_actor, verb: 'org.created', audit: false }, { org_id: org.id, actor_id: a.p_actor, verb: 'org.entitlements_changed', audit: true, payload: a.p_payload });
        return { data: { org }, error: null };
      },
      labelos_platform_set_entitlements: (a, t) => {
        if (!t.platform_admins.some((r) => r.user_id === a.p_actor)) return { data: { error: 'not_operator' }, error: null };
        const org = t.organizations.find((o) => o.id === a.p_org && (o.kind === 'artist' || o.kind === 'label') && !o.deleted_at);
        if (!org) return { data: { error: 'not_found' }, error: null };
        t.org_entitlements = t.org_entitlements.filter((e) => e.org_id !== a.p_org);
        const row = { org_id: a.p_org, modules: a.p_modules, max_seats: a.p_max_seats, max_artists: a.p_max_artists, setup_done: true };
        t.org_entitlements.push(row);
        t.activity_events.push({ org_id: a.p_org, actor_id: a.p_actor, verb: 'org.entitlements_changed', audit: true, payload: a.p_payload });
        return { data: { entitlements: row }, error: null };
      },
      labelos_audit_invitation_create: (a, t) => {
        const inv = { id: id('50000000', t.org_invitations.length + 1), org_id: a.p_org, email: a.p_email, role: a.p_role, invited_by: a.p_actor, project_id: null, accepted_at: null, revoked_at: null, expires_at: a.p_expires_at };
        t.org_invitations.push(inv);
        t.activity_events.push({ org_id: a.p_org, actor_id: a.p_actor, verb: 'invitation.created', audit: true });
        return { data: { invitation: inv }, error: null };
      },
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(as: string | null, file: string, method: string, url: string, params: Record<string, string>, body?: unknown) {
  current = as;
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, Handler>;
  const req = new NextRequest(`https://app.test${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return mod[method](req, { params: Promise.resolve(params) });
}

const CREATE = { name: 'New Label', slug: 'new-label', face: 'label', modules: ['contracts', 'export'], max_seats: 3, max_artists: 2, owner_email: 'Boss@New.Test' };
const MATRIX = [
  { name: 'GET licensees', file: './licensees/route', method: 'GET', url: '/api/platform/licensees', params: {} },
  { name: 'POST licensees', file: './licensees/route', method: 'POST', url: '/api/platform/licensees', params: {}, body: CREATE },
  { name: 'PATCH licence', file: './licensees/[orgId]/route', method: 'PATCH', url: `/api/platform/licensees/${L1}`, params: { orgId: L1 }, body: { modules: [], max_seats: 1, max_artists: null } },
  { name: 'POST owner invitation', file: './licensees/[orgId]/invitations/route', method: 'POST', url: `/api/platform/licensees/${L1}/invitations`, params: { orgId: L1 }, body: { email: 'x@y.test' } },
] as const;

describe('the console does not exist for anyone but an operator', () => {
  const callers: [string, string | null][] = [['signed out', null], ...Object.entries(PEOPLE)];
  for (const route of MATRIX) {
    it(`${route.name}: 404 and no write for every org role in both orgs, external members, the producer and strangers`, async () => {
      for (const [who, user] of callers) {
        const before = JSON.stringify(db.tables);
        const res = await call(user, route.file, route.method, route.url, route.params, 'body' in route ? route.body : undefined);
        expect(res.status, who).toBe(404);
        expect(await res.json(), who).toEqual({ error: 'Not found' });
        expect(JSON.stringify(db.tables), `${who} wrote nothing`).toBe(before);
      }
      expect(emails).toEqual([]);
    });
  }

  it('an operator row removed takes effect on the next request', async () => {
    expect((await call(OP, './licensees/route', 'GET', '/api/platform/licensees', {})).status).toBe(200);
    db.tables.platform_admins = [];
    expect((await call(OP, './licensees/route', 'GET', '/api/platform/licensees', {})).status).toBe(404);
  });
});

describe('the operator', () => {
  it('lists licensees (never the producer’s own org) with their licence and counts', async () => {
    const res = await call(OP, './licensees/route', 'GET', '/api/platform/licensees', {});
    const body = (await res.json()) as { licensees: { id: string; face: string; licensed: boolean; seatsUsed: number; artists: number }[] };
    expect(body.licensees.map((l) => l.id)).toEqual([A, L2, L1]);
    expect(body.licensees.find((l) => l.id === L1)).toMatchObject({ face: 'label', licensed: false, seatsUsed: 3, artists: 1 });
    expect(body.licensees.find((l) => l.id === A)!.face).toBe('independent');
    expect(JSON.stringify(body)).not.toMatch(/local\.test/);
  });

  it('creates a licensee with a face and a licence, and invites its owner by the ordinary flow', async () => {
    const res = await call(OP, './licensees/route', 'POST', '/api/platform/licensees', {}, CREATE);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { org: { id: string; face: string }; invitation: { sent: boolean } };
    expect(body.org.face).toBe('label');
    expect(body.invitation.sent).toBe(true);
    const org = db.tables.organizations.find((o) => o.id === body.org.id)!;
    expect(org.kind).toBe('label');
    expect(db.tables.org_entitlements.find((e) => e.org_id === org.id)).toMatchObject({ modules: ['contracts', 'export'], max_seats: 3, max_artists: 2, setup_done: false });
    expect(db.tables.org_invitations).toEqual([expect.objectContaining({ org_id: org.id, email: 'boss@new.test', role: 'owner', invited_by: OP })]);
    expect(emails).toEqual([{ to: 'boss@new.test', role: 'owner' }]);
    // Audited in the org it acted on.
    expect(db.tables.activity_events.filter((e) => e.org_id === org.id).map((e) => e.verb)).toEqual(['org.created', 'org.entitlements_changed', 'invitation.created']);
    const payload = db.tables.activity_events.find((e) => e.verb === 'org.entitlements_changed')!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ source: 'platform', modules: ['contracts', 'export'], created: true, face: 'label' });
    expect(JSON.stringify(payload)).not.toContain('@');
  });

  it('an independent face is an artist org with no artist cap', async () => {
    const res = await call(OP, './licensees/route', 'POST', '/api/platform/licensees', {}, { name: 'Solo Two', slug: 'solo-two', face: 'independent', max_artists: 5 });
    expect(res.status).toBe(201);
    const { org } = (await res.json()) as { org: { id: string } };
    expect(db.tables.organizations.find((o) => o.id === org.id)!.kind).toBe('artist');
    expect(db.tables.org_entitlements.find((e) => e.org_id === org.id)).toMatchObject({ max_artists: null });
  });

  it('a taken slug is 409; a bad body is 400', async () => {
    expect((await call(OP, './licensees/route', 'POST', '/api/platform/licensees', {}, { ...CREATE, slug: 'label-one' })).status).toBe(409);
    expect((await call(OP, './licensees/route', 'POST', '/api/platform/licensees', {}, { ...CREATE, face: 'studio' })).status).toBe(400);
    expect((await call(OP, './licensees/route', 'POST', '/api/platform/licensees', {}, { ...CREATE, max_seats: 0 })).status).toBe(400);
  });

  it('sets one licensee’s licence and leaves the other org alone; the producer’s own org is not a licensee', async () => {
    const res = await call(OP, './licensees/[orgId]/route', 'PATCH', `/api/platform/licensees/${L1}`, { orgId: L1 }, { modules: ['export', 'bogus'], max_seats: 4, max_artists: null });
    expect(res.status).toBe(400); // unknown module names are refused by the contract
    const ok = await call(OP, './licensees/[orgId]/route', 'PATCH', `/api/platform/licensees/${L1}`, { orgId: L1 }, { modules: ['export'], max_seats: 4, max_artists: null });
    expect(ok.status).toBe(200);
    expect(db.tables.org_entitlements).toEqual([expect.objectContaining({ org_id: L1, modules: ['export'], max_seats: 4 })]);
    expect(db.tables.activity_events.map((e) => e.org_id)).toEqual([L1]);
    expect((await call(OP, './licensees/[orgId]/route', 'PATCH', `/api/platform/licensees/${P}`, { orgId: P }, { modules: [], max_seats: null, max_artists: null })).status).toBe(404);
    expect((await call(OP, './licensees/[orgId]/route', 'PATCH', '/api/platform/licensees/nope', { orgId: 'nope' }, { modules: [], max_seats: null, max_artists: null })).status).toBe(404);
  });

  it('invites an existing licensee’s owner', async () => {
    const res = await call(OP, './licensees/[orgId]/invitations/route', 'POST', `/api/platform/licensees/${L2}/invitations`, { orgId: L2 }, { email: 'Owner@Two.Test' });
    expect(res.status).toBe(201);
    expect(db.tables.org_invitations).toEqual([expect.objectContaining({ org_id: L2, email: 'owner@two.test', role: 'owner', invited_by: OP })]);
    expect((await call(OP, './licensees/[orgId]/invitations/route', 'POST', `/api/platform/licensees/${P}/invitations`, { orgId: P }, { email: 'a@b.test' })).status).toBe(404);
  });
});

describe('every /api/platform handler is in the matrix and audited', () => {
  const ROOT = join(process.cwd(), 'src/app/api/platform');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : f === 'route.ts' ? [p] : [];
    });
  const handlers = files(ROOT).flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    return [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => ({ file: `./${relative(ROOT, f).replace(/\.ts$/, '')}`, method: m[1], src }));
  });

  it('finds the handlers', () => {
    expect(handlers.length).toBe(MATRIX.length);
  });

  it('each one is exercised above, and gated by requirePlatformAdmin', () => {
    for (const h of handlers) {
      expect(MATRIX.some((m) => m.file === h.file && m.method === h.method), `${h.method} ${h.file}`).toBe(true);
      expect(h.src, h.file).toMatch(/requirePlatformAdmin\(\)/);
    }
  });

  it('each mutating one writes through an audited function', () => {
    for (const h of handlers.filter((x) => x.method !== 'GET')) {
      expect(h.src, `${h.method} ${h.file}`).toMatch(/auditRpc\(|inviteOwner\(/);
    }
  });
});
