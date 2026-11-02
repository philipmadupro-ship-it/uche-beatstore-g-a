/**
 * PUT/GET /api/org/[orgId]/settings/marketing-plan (LABEL-65): owner only, one
 * audited function, a repeat writes nothing, migration 183 missing is 503.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const L = '10000000-0000-4000-8000-000000000001';
const PROD = '10000000-0000-4000-8000-000000000009';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const ADMIN = u(2);
const MKT = u(3);

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let missing = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: 'o@test.dev', last_sign_in_at: new Date().toISOString() } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (!(missing && table === 'marketing_plans')) return mem.client.from(table);
      const res = { data: null, error: { message: "Could not find the table 'public.marketing_plans' in the schema cache", code: 'PGRST205' } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return q;
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missing = false;
  db = {
    rpc: auditRpcMemory(),
    tables: {
      organizations: [
        { id: L, name: 'Label', slug: 'label', kind: 'label', deleted_at: null, settings: { legal_gate: 'off' } },
        { id: PROD, name: 'Studio', slug: 'studio', kind: 'producer', deleted_at: null, settings: {} },
      ],
      org_members: [
        { org_id: L, user_id: OWN, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: L, user_id: ADMIN, role: 'admin', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: L, user_id: MKT, role: 'member', functions: ['marketing'], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: PROD, user_id: OWN, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
      ],
      marketing_plans: [],
      org_entitlements: [],
      activity_events: [],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(as: string | null, method: 'GET' | 'PUT', body?: unknown, org = L) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/settings/marketing-plan`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  return mod[method](req, { params: Promise.resolve({ orgId: org }) });
}

describe('the plan requirement switch', () => {
  it('reads off by default', async () => {
    expect(await (await call(OWN, 'GET')).json()).toEqual({ schemaReady: true, required: false });
  });
  it('is the owner’s alone: an admin, a marketing member and a stranger do not get it', async () => {
    for (const who of [ADMIN, MKT]) {
      expect((await call(who, 'PUT', { required: true })).status, who).toBe(403);
      expect((await call(who, 'GET')).status, who).toBe(403);
    }
    expect((await call(null, 'PUT', { required: true })).status).toBe(401);
    expect(db.tables.organizations[0].settings).toEqual({ legal_gate: 'off' });
  });
  it('turns on keeping the other settings, records one internal audit event with only booleans, and a repeat writes nothing', async () => {
    const on = await call(OWN, 'PUT', { required: true });
    expect(await on.json()).toEqual({ required: true, changed: true });
    expect(db.tables.organizations[0].settings).toEqual({ legal_gate: 'off', marketing_plan_required: true });
    expect(await (await call(OWN, 'GET')).json()).toEqual({ schemaReady: true, required: true });
    expect(db.tables.activity_events).toHaveLength(1);
    expect(db.tables.activity_events[0]).toMatchObject({ verb: 'marketing_plan.requirement_changed', audit: true, visibility: 'internal', payload: { from: false, to: true } });
    expect(await (await call(OWN, 'PUT', { required: true })).json()).toEqual({ required: true, changed: false });
    expect(db.tables.activity_events).toHaveLength(1);
    expect(await (await call(OWN, 'PUT', { required: false })).json()).toEqual({ required: false, changed: true });
    expect(db.tables.activity_events[1].payload).toEqual({ from: true, to: false });
  });
  it('validates the body and does not apply to the producer’s own org', async () => {
    expect((await call(OWN, 'PUT', { required: 'yes' })).status).toBe(400);
    expect((await call(OWN, 'PUT', { required: true, x: 1 })).status).toBe(400);
    expect((await call(OWN, 'PUT', { required: true }, PROD)).status).toBe(404);
  });
  it('is 404 without the marketing module: not licensed, or switched off by the owner', async () => {
    db.tables.org_entitlements.push({ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null, setup_done: true });
    expect((await call(OWN, 'GET')).status).toBe(404);
    expect((await call(OWN, 'PUT', { required: true })).status).toBe(404);
    expect(db.tables.activity_events).toHaveLength(0);
    db.tables.org_entitlements.length = 0;
    db.tables.organizations[0].settings = { departments_off: ['marketing'] };
    expect((await call(OWN, 'PUT', { required: true })).status).toBe(404);
    db.tables.organizations[0].settings = {};
    expect((await call(OWN, 'PUT', { required: true })).status).toBe(200);
  });
  it('answers 503 naming 183 when the tables are missing, and writes nothing', async () => {
    missing = true;
    const res = await call(OWN, 'PUT', { required: true });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/183/);
    expect(db.tables.activity_events).toHaveLength(0);
    expect(await (await call(OWN, 'GET')).json()).toEqual({ schemaReady: false, required: false });
  });
});
