/**
 * PUT/GET /api/org/[orgId]/settings/creative-gate (LABEL-68): owner only, one audited function, a repeat writes nothing,
 * migration 194 missing is 503, and the switch exists only where the artistic department does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';
import { parseReadinessSettings } from '@/lib/contracts';

const L = '10000000-0000-4000-8000-000000000001';
const PROD = '10000000-0000-4000-8000-000000000009';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const ADMIN = u(2);
const AD = u(3);

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let missingFunction = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: 'o@test.dev', last_sign_in_at: new Date().toISOString() } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mem.client.from(table),
    rpc: (name: string, args: Record<string, unknown>) =>
      missingFunction && name === 'labelos_audit_creative_gate'
        ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.labelos_audit_creative_gate in the schema cache' } })
        : mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missingFunction = false;
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
        { org_id: L, user_id: AD, role: 'member', functions: ['artistic_director'], scope: 'org', cap_grants: [], cap_revokes: [] },
        { org_id: PROD, user_id: OWN, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] },
      ],
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
  const req = new NextRequest(`https://app.test/api/org/${org}/settings/creative-gate`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  return mod[method](req, { params: Promise.resolve({ orgId: org }) });
}

describe('the creative approval switch', () => {
  it('reads off by default', async () => {
    expect(await (await call(OWN, 'GET')).json()).toEqual({ enabled: false, available: true });
  });

  it('is the owner’s alone: an admin, the artistic director and a stranger do not get it', async () => {
    for (const who of [ADMIN, AD]) {
      expect((await call(who, 'PUT', { enabled: true })).status, who).toBe(403);
      expect((await call(who, 'GET')).status, who).toBe(403);
    }
    expect((await call(null, 'PUT', { enabled: true })).status).toBe(401);
    expect(db.tables.organizations[0].settings).toEqual({ legal_gate: 'off' });
  });

  it('turns on as the string "on", keeps the other settings, records one internal audit event, and a repeat writes nothing', async () => {
    expect(await (await call(OWN, 'PUT', { enabled: true })).json()).toEqual({ enabled: true, changed: true });
    expect(db.tables.organizations[0].settings).toEqual({ legal_gate: 'off', creative_gate: 'on' });
    expect(parseReadinessSettings(db.tables.organizations[0].settings).creative_gate).toBe('on');
    expect(await (await call(OWN, 'GET')).json()).toEqual({ enabled: true, available: true });
    expect(db.tables.activity_events).toHaveLength(1);
    expect(db.tables.activity_events[0]).toMatchObject({ verb: 'creative_gate.changed', audit: true, visibility: 'internal', payload: { from: 'off', to: 'on' } });
    expect(await (await call(OWN, 'PUT', { enabled: true })).json()).toEqual({ enabled: true, changed: false });
    expect(db.tables.activity_events).toHaveLength(1);
    expect(await (await call(OWN, 'PUT', { enabled: false })).json()).toEqual({ enabled: false, changed: true });
    expect(db.tables.organizations[0].settings).toEqual({ legal_gate: 'off', creative_gate: 'off' });
    expect(db.tables.activity_events[1].payload).toEqual({ from: 'on', to: 'off' });
  });

  it('validates the body and does not apply to the producer’s own org', async () => {
    expect((await call(OWN, 'PUT', { enabled: 'yes' })).status).toBe(400);
    expect((await call(OWN, 'PUT', { enabled: true, x: 1 })).status).toBe(400);
    expect((await call(OWN, 'PUT', {})).status).toBe(400);
    expect((await call(OWN, 'PUT', { enabled: true }, PROD)).status).toBe(404);
  });

  it('is 404 without the artistic department: not licensed, or switched off by the owner', async () => {
    db.tables.org_entitlements.push({ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null, setup_done: true });
    expect((await call(OWN, 'GET')).status).toBe(404);
    expect((await call(OWN, 'PUT', { enabled: true })).status).toBe(404);
    expect(db.tables.activity_events).toHaveLength(0);
    db.tables.org_entitlements.length = 0;
    db.tables.organizations[0].settings = { departments_off: ['artistic'] };
    expect((await call(OWN, 'PUT', { enabled: true })).status).toBe(404);
    db.tables.organizations[0].settings = {};
    expect((await call(OWN, 'PUT', { enabled: true })).status).toBe(200);
  });

  it('answers 503 naming 194 when the function is missing, and writes nothing', async () => {
    missingFunction = true;
    const res = await call(OWN, 'PUT', { enabled: true });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/194/);
    expect(db.tables.activity_events).toHaveLength(0);
    expect(db.tables.organizations[0].settings).toEqual({ legal_gate: 'off' });
  });
});
