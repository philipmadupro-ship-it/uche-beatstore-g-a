/**
 * GET / PATCH /api/org/[orgId]/settings (LABEL-51): owner only, one audited
 * database function for the change, departments only within the licence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { fakeAdmin, eqs, type Answer, type Chain } from '@/lib/labelos/mocks/fake-admin';

const ORG = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';

let isOwner = true;
let stored: Record<string, unknown> = {};
let entitlement: { modules: string[]; max_seats: number | null; max_artists: number | null; setup_done: boolean } | null = null;
let rpcAnswer: Answer | null = null;
let admin: ReturnType<typeof fakeAdmin>;

vi.mock('@/lib/auth/org-access', () => ({
  requireOrgOwner: async (orgId: string, opts: { state: string; freshSignIn: boolean }) => {
    expect(orgId).toBe(ORG);
    expect(opts).toEqual({ state: 'live', freshSignIn: false });
    if (!isOwner) return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    return { ok: true, userId: ME, email: 'o@x.test', admin: admin.client, org: { id: ORG, name: 'Label', slug: 'label', kind: 'label', deleted_at: null } };
  },
}));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function answer(chain: Chain): Answer {
  if (chain.table === 'organizations') {
    expect(eqs(chain).id).toBe(ORG);
    return { data: { settings: stored }, error: null };
  }
  if (chain.table === 'org_entitlements') return { data: entitlement, error: null };
  throw new Error(`unexpected table ${chain.table}`);
}

const { GET, PATCH } = await import('./route');
const get = () => GET(new NextRequest(`http://x/api/org/${ORG}/settings`), { params: Promise.resolve({ orgId: ORG }) });
const patch = (body: unknown) =>
  PATCH(new NextRequest(`http://x/api/org/${ORG}/settings`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ orgId: ORG }) });

beforeEach(() => {
  isOwner = true;
  stored = {};
  entitlement = null;
  rpcAnswer = null;
  admin = fakeAdmin({
    answer,
    rpc: (name, args) => rpcAnswer ?? { data: { settings: { ...stored, ...(args.p_patch as object) } }, error: null },
  });
});

describe('GET', () => {
  it('is owner only', async () => {
    isOwner = false;
    expect((await get()).status).toBe(403);
  });
  it('reads total settings, the licence and what can be switched', async () => {
    entitlement = { modules: ['finance', 'export'], max_seats: null, max_artists: null, setup_done: true };
    stored = { legal_gate: 'off', departments_off: ['finance'] };
    const body = await (await get()).json();
    expect(body.settings).toMatchObject({ legal_gate: 'off', marketing_gate: 'on', departments_off: ['finance'] });
    expect(body.licensed.sort()).toEqual(['export', 'finance']);
    expect(body.switchable).toEqual(['finance']);
  });
});

describe('PATCH', () => {
  it('only the owner writes: a non-owner is 403 and nothing is called', async () => {
    isOwner = false;
    const res = await patch({ legal_gate: 'off' });
    expect(res.status).toBe(403);
    expect(admin.rpcs).toEqual([]);
  });

  it('turns the legal gate off through the audit function, naming the key and values', async () => {
    const res = await patch({ legal_gate: 'off' });
    expect(res.status).toBe(200);
    expect(admin.rpcs).toEqual([
      {
        name: 'labelos_audit_org_settings',
        args: {
          p_org: ORG,
          p_actor: ME,
          p_patch: { legal_gate: 'off' },
          p_payload: { keys: ['legal_gate'], changes: { legal_gate: { from: 'on', to: 'off' } } },
        },
      },
    ]);
    const body = await res.json();
    expect(body.changed).toEqual(['legal_gate']);
    expect(body.settings.legal_gate).toBe('off');
  });

  it('writes only the keys that differ, and nothing at all for a no-op', async () => {
    stored = { marketing_gate: 'off' };
    const res = await patch({ marketing_gate: 'off', require_signed_master_split: false });
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toEqual([]);
    expect(admin.rpcs).toEqual([]);
  });

  it('refuses a body that names nothing, an unknown key or a bad value (400)', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: 'x' })).status).toBe(400);
    expect((await patch({ legal_gate: 'maybe' })).status).toBe(400);
    expect((await patch({ attention_release_days: 0 })).status).toBe(400);
    expect((await patch({ departments_off: ['export'] })).status).toBe(400);
    expect(admin.rpcs).toEqual([]);
  });

  it('switches a licensed department off but never one the licence lacks (422)', async () => {
    entitlement = { modules: ['finance', 'export'], max_seats: null, max_artists: null, setup_done: true };
    expect((await patch({ departments_off: ['pr'] })).status).toBe(422);
    expect(admin.rpcs).toEqual([]);
    const ok = await patch({ departments_off: ['finance'] });
    expect(ok.status).toBe(200);
    expect(admin.rpcs[0].args.p_patch).toEqual({ departments_off: ['finance'] });
  });

  it('answers 403 when the database says the actor is not the owner (role changed mid-request)', async () => {
    rpcAnswer = { data: { error: 'not_owner' }, error: null };
    expect((await patch({ legal_gate: 'off' })).status).toBe(403);
  });

  it('answers 503 naming the migration when 172 is not applied, never a 500', async () => {
    rpcAnswer = { data: null, error: { message: 'Could not find the function public.labelos_audit_org_settings', code: 'PGRST202' } };
    const res = await patch({ legal_gate: 'off' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/172/);
  });

  it('a failed audit write is a 500 and the settings are not reported as saved', async () => {
    rpcAnswer = { data: null, error: { message: 'audit payload is too large', code: '22023' } };
    expect((await patch({ legal_gate: 'off' })).status).toBe(500);
  });
});
