/**
 * The advances ledger, the finance dashboard and the period close routes (LABEL-64), through the
 * REAL lib/auth/org-access, the stores and the routes against an in-memory database. The SQL
 * rules (what freezes an advance, the lock a close shares with imports) are proved on Postgres in
 * supabase/local/checks/182_labelos_finance_advances_close.sql; this proves the routes authorise,
 * scope, validate, and map the database's answers.
 *
 *   L (label): OWN owner · ADM admin · FIN finance function (whole org, no finance.approve) ·
 *   FSC finance scoped to Ara · MKT marketing (no finance) · R1 roster artist of Ara · EXT an
 *   external project member. L2: a stranger's org.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1), ADM = u(2), FIN = u(3), FSC = u(4), MKT = u(5), R1 = u(6), EXT = u(7), STR = u(8);
const ARA = '30000000-0000-4000-8000-0000000000a1';
const BO = '30000000-0000-4000-8000-0000000000a2';
const PARA = '60000000-0000-4000-8000-000000000001';
const PBO = '60000000-0000-4000-8000-000000000002';
const YARA = '70000000-0000-4000-8000-000000000001';
const YBO = '70000000-0000-4000-8000-000000000002';
const A_ARA = '80000000-0000-4000-8000-000000000001'; // Ara's advance, recouped from
const A_ARA2 = '80000000-0000-4000-8000-000000000002'; // Ara's untouched advance
const A_BO = '80000000-0000-4000-8000-000000000003';
const PER_OPEN = '90000000-0000-4000-8000-000000000001';
const PER_CLOSED = '90000000-0000-4000-8000-000000000002';
const PROJ = '40000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let rpcCalls: { name: string; args: Record<string, unknown> }[];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const advance = (id: string, payee: string, artist: string, kind: string, amount: number) => ({
  id, org_id: L, payee_id: payee, artist_contact_id: artist, kind, amount_minor: amount, currency: 'USD', paid_on: null, note: null, voided_at: null, created_at: `2026-10-0${id.slice(-1)}`,
});

function stub(name: string, answer: (args: Record<string, unknown>) => unknown) {
  return (args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: answer(args), error: null };
  };
}
let answers: Record<string, unknown>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  rpcCalls = [];
  answers = {};
  const rpc = (name: string, fallback: unknown) => stub(name, () => answers[name] ?? fallback);
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'), member(ADM, 'admin'), member(FIN, 'member', ['finance']), member(FSC, 'member', ['finance'], 'artists'), member(MKT, 'member', ['marketing']),
        member(R1, 'artist', [], 'artists'), member(STR, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: FSC, contact_id: ARA }, { org_id: L, user_id: R1, contact_id: ARA }],
      project_members: [{ org_id: L, project_id: PROJ, user_id: EXT, role: 'editor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
      contacts: [{ id: ARA, org_id: L, user_id: null, name: 'Ara', category: 'artist' }, { id: BO, org_id: L, user_id: null, name: 'Bo', category: 'artist' }],
      projects: [{ id: PROJ, org_id: L, user_id: null, name: 'EP', inbox_for_contact_id: null, created_at: '2026-10-01' }],
      parties: [{ id: PARA, org_id: L, display_name: 'Ara', contact_id: ARA, user_id: null }, { id: PBO, org_id: L, display_name: 'Bo', contact_id: BO, user_id: null }],
      payees: [
        { id: YARA, org_id: L, party_id: PARA, artist_contact_id: ARA, currency: 'USD', status: 'active', created_at: '2026-10-01' },
        { id: YBO, org_id: L, party_id: PBO, artist_contact_id: BO, currency: 'USD', status: 'active', created_at: '2026-10-01' },
      ],
      advances: [advance(A_ARA, YARA, ARA, 'recoupable', 5000), advance(A_ARA2, YARA, ARA, 'non_recoupable', 700), advance(A_BO, YBO, BO, 'recoupable', 9000)],
      earnings_recoupments: [{ id: 'r1', org_id: L, advance_id: A_ARA, payee_id: YARA, amount_minor: 1200 }],
      earnings_allocations: [{ id: 'al1', org_id: L, payee_id: YARA, payable_minor: 4000, import_id: 'i1', line_id: 'ln1' }, { id: 'al2', org_id: L, payee_id: YBO, payable_minor: 800, import_id: 'i1', line_id: 'ln2' }],
      earnings_imports: [{ id: 'i1', org_id: L, period_id: PER_OPEN, status: 'imported' }],
      earnings_lines: [
        { id: 'ln1', org_id: L, import_id: 'i1', upc: null, song_track_id: 's1', gross_minor: 8000, currency: 'USD' },
        { id: 'ln2', org_id: L, import_id: 'i1', upc: null, song_track_id: 's2', gross_minor: 1600, currency: 'USD' },
      ],
      statements: [{ id: 'st1', org_id: L, payee_id: YARA, period_id: PER_OPEN, status: 'issued', net_minor: 2800 }],
      statement_lines: [],
      payments: [{ id: 'pay1', org_id: L, payee_id: YARA, statement_id: 'st1', amount_minor: 1000, voided_at: null }],
      releases: [
        { id: 'rel-ara', org_id: L, title: 'Ara EP', state: 'draft', upc: null, release_date: null, contact_id: ARA },
        { id: 'rel-bo', org_id: L, title: 'Bo EP', state: 'draft', upc: null, release_date: null, contact_id: BO },
      ],
      release_items: [{ id: 'it1', org_id: L, release_id: 'rel-ara', song_track_id: 's1' }, { id: 'it2', org_id: L, release_id: 'rel-bo', song_track_id: 's2' }],
      marketing_plans: [],
      finance_periods: [
        { id: PER_OPEN, org_id: L, label: 'Q3', starts_on: '2026-07-01', ends_on: '2026-09-30', status: 'open', closed_at: null },
        { id: PER_CLOSED, org_id: L, label: 'Q2', starts_on: '2026-04-01', ends_on: '2026-06-30', status: 'closed', closed_at: '2026-07-05' },
      ],
      activity_events: [],
      user_profiles: [],
    },
    rpc: {
      labelos_audit_advance_create: rpc('create', { id: 'new-adv' }),
      labelos_audit_advance_update: rpc('update', { updated: true, fields: ['note'] }),
      labelos_audit_advance_void: rpc('void', { voided: true }),
      labelos_audit_period_close: rpc('close', { closed: true }),
      labelos_audit_period_reopen: rpc('reopen', { reopened: true }),
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const MODULES: Record<string, () => Promise<unknown>> = {
  advances: () => import('./advances/route'),
  advance: () => import('./advances/[advanceId]/route'),
  void: () => import('./advances/[advanceId]/void/route'),
  dashboard: () => import('./dashboard/route'),
  close: () => import('./periods/[periodId]/close/route'),
  reopen: () => import('./periods/[periodId]/reopen/route'),
};

async function call(which: keyof typeof MODULES, method: string, as: string | null, org: string, extra: Record<string, string> = {}, body?: unknown) {
  current = as;
  const mod = (await MODULES[which]()) as Record<string, Handler>;
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/org/${org}/finance/x`, init), { params: Promise.resolve({ orgId: org, ...extra }) });
}

describe('GET /finance/advances', () => {
  it('finance readers read the ledger with what is recouped and what is fixed', async () => {
    for (const who of [OWN, FIN]) {
      const res = await call('advances', 'GET', who, L);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.advances.map((a: { id: string }) => a.id).sort()).toEqual([A_ARA, A_ARA2, A_BO].sort());
      const touched = body.advances.find((a: { id: string }) => a.id === A_ARA);
      expect(touched).toMatchObject({ amountMinor: '5000', recoupedMinor: '1200', remainingMinor: '3800', status: 'partly_recouped', canEditTerms: false, canVoid: false });
      const fresh = body.advances.find((a: { id: string }) => a.id === A_ARA2);
      expect(fresh).toMatchObject({ canEditTerms: true, canVoid: true, status: 'non_recoupable' });
      expect(body.totals[0]).toMatchObject({ currency: 'USD', recoupableMinor: '14000', nonRecoupableMinor: '700', recoupedMinor: '1200', unrecoupedMinor: '12800' });
    }
  });

  it('a member scoped to Ara never sees Bo’s advances, payee or totals', async () => {
    const body = await (await call('advances', 'GET', FSC, L)).json();
    expect(body.advances.map((a: { id: string }) => a.id).sort()).toEqual([A_ARA, A_ARA2].sort());
    expect(body.payees.map((p: { id: string }) => p.id)).toEqual([YARA]);
    expect(body.totals[0].recoupableMinor).toBe('5000');
    expect(JSON.stringify(body)).not.toContain('9000');
  });

  it('refuses a roster artist, a marketing member, an external member and a stranger', async () => {
    expect((await call('advances', 'GET', R1, L)).status).toBeGreaterThanOrEqual(403);
    expect((await call('advances', 'GET', MKT, L)).status).toBeGreaterThanOrEqual(403);
    expect((await call('advances', 'GET', EXT, L)).status).toBeGreaterThanOrEqual(403);
    expect((await call('advances', 'GET', STR, L)).status).toBeGreaterThanOrEqual(403);
    expect((await call('advances', 'GET', null, L)).status).toBe(401);
  });
});

describe('POST /finance/advances', () => {
  const ok = { payee_id: YARA, kind: 'recoupable', amount_minor: '2500', paid_on: '2026-10-10', note: 'signing' };

  it('records an advance through the audited function with the payee’s own currency decided in SQL', async () => {
    const res = await call('advances', 'POST', FIN, L, {}, ok);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'new-adv' });
    expect(rpcCalls).toEqual([{ name: 'create', args: expect.objectContaining({ p_payee: YARA, p_kind: 'recoupable', p_amount: '2500', p_paid_on: '2026-10-10', p_note: 'signing', p_actor: FIN, p_org: L }) }]);
  });

  it('validates the body: no zero, no float, no unknown field', async () => {
    for (const bad of [{ ...ok, amount_minor: '0' }, { ...ok, amount_minor: '12.5' }, { ...ok, kind: 'gift' }, { ...ok, currency: 'EUR' }, { ...ok, paid_on: '2026-02-30' }]) {
      expect((await call('advances', 'POST', FIN, L, {}, bad)).status).toBe(400);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it('a scoped member cannot advance to another artist’s payee, and the answer does not say it exists', async () => {
    const res = await call('advances', 'POST', FSC, L, {}, { ...ok, payee_id: YBO });
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
    expect((await call('advances', 'POST', FSC, L, {}, ok)).status).toBe(201);
  });

  it('needs finance.write', async () => {
    expect((await call('advances', 'POST', MKT, L, {}, ok)).status).toBeGreaterThanOrEqual(403);
    expect((await call('advances', 'POST', R1, L, {}, ok)).status).toBeGreaterThanOrEqual(403);
  });

  it('maps an inactive payee to 409', async () => {
    answers.create = { error: 'payee_inactive' };
    expect((await call('advances', 'POST', FIN, L, {}, ok)).status).toBe(409);
  });
});

describe('PATCH and void of an advance', () => {
  it('changes the note of any live advance; sends only the keys given', async () => {
    const res = await call('advance', 'PATCH', FIN, L, { advanceId: A_ARA }, { note: 'renegotiated' });
    expect(res.status).toBe(200);
    expect(rpcCalls[0].args.p_patch).toEqual({ note: 'renegotiated' });
  });

  it('maps a referenced advance to 409 advance_referenced for terms and for void', async () => {
    answers.update = { error: 'advance_referenced' };
    const res = await call('advance', 'PATCH', FIN, L, { advanceId: A_ARA }, { amount_minor: '9000' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('advance_referenced');
    answers.void = { error: 'advance_referenced' };
    expect((await call('void', 'POST', FIN, L, { advanceId: A_ARA })).status).toBe(409);
  });

  it('refuses an empty patch and a malformed id', async () => {
    expect((await call('advance', 'PATCH', FIN, L, { advanceId: A_ARA }, {})).status).toBe(400);
    expect((await call('advance', 'PATCH', FIN, L, { advanceId: 'nope' }, { note: 'x' })).status).toBe(404);
  });

  it('a scoped member reaches only their artist’s advances (404 for Bo’s)', async () => {
    expect((await call('advance', 'PATCH', FSC, L, { advanceId: A_BO }, { note: 'x' })).status).toBe(404);
    expect((await call('void', 'POST', FSC, L, { advanceId: A_BO })).status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
    expect((await call('void', 'POST', FSC, L, { advanceId: A_ARA2 })).status).toBe(200);
  });

  it('voiding writes through the audited function', async () => {
    expect((await call('void', 'POST', OWN, L, { advanceId: A_ARA2 })).status).toBe(200);
    expect(rpcCalls[0]).toMatchObject({ name: 'void', args: { p_advance: A_ARA2, p_actor: OWN } });
  });
});

describe('GET /finance/dashboard', () => {
  it('shows every payee position and release to the whole-organization reader', async () => {
    const body = await (await call('dashboard', 'GET', FIN, L)).json();
    expect(body.schemaReady).toBe(true);
    expect(body.scoped).toBe(false);
    const ara = body.positions.find((p: { payeeId: string }) => p.payeeId === YARA);
    expect(ara).toMatchObject({ recoupableAdvancedMinor: '5000', nonRecoupableAdvancedMinor: '700', unrecoupedMinor: '3800', earnedMinor: '4000', recoupedMinor: '1200', issuedMinor: '2800', paidMinor: '1000', owedMinor: '1800' });
    expect(body.releases.map((r: { releaseId: string }) => r.releaseId).sort()).toEqual(['rel-ara', 'rel-bo']);
    expect(body.summary.currencies[0].advances.unrecouped).toBe('12800');
    expect(body.periods).toHaveLength(2);
  });

  it('a scoped member gets only their artist: no other payee, release, period or total', async () => {
    const body = await (await call('dashboard', 'GET', FSC, L)).json();
    expect(body.scoped).toBe(true);
    expect(body.positions.map((p: { payeeId: string }) => p.payeeId)).toEqual([YARA]);
    expect(body.releases.map((r: { releaseId: string }) => r.releaseId)).toEqual(['rel-ara']);
    expect(body.periods).toBeNull();
    expect(body.unattributed).toEqual([]);
    expect(body.summary.currencies[0].advances.recoupable).toBe('5000');
    expect(JSON.stringify(body)).not.toContain('9000');
    expect(JSON.stringify(body)).not.toContain('1600');
  });

  it('is refused to a roster artist, marketing, external members and strangers', async () => {
    for (const who of [R1, MKT, EXT, STR]) expect((await call('dashboard', 'GET', who, L)).status).toBeGreaterThanOrEqual(403);
  });

  it('offers close only to finance.approve and reopen only to an owner', async () => {
    const asAdmin = await (await call('dashboard', 'GET', ADM, L)).json();
    expect(asAdmin.periods.find((p: { id: string }) => p.id === PER_OPEN)).toMatchObject({ canClose: true, canReopen: false });
    expect(asAdmin.periods.find((p: { id: string }) => p.id === PER_CLOSED)).toMatchObject({ canReopen: false });
    const asOwner = await (await call('dashboard', 'GET', OWN, L)).json();
    expect(asOwner.periods.find((p: { id: string }) => p.id === PER_CLOSED)).toMatchObject({ canReopen: true });
    const asFin = await (await call('dashboard', 'GET', FIN, L)).json();
    expect(asFin.periods.find((p: { id: string }) => p.id === PER_OPEN).canClose).toBe(false);
  });
});

describe('closing and reopening a period', () => {
  it('finance.approve closes through the audited function', async () => {
    expect((await call('close', 'POST', OWN, L, { periodId: PER_OPEN })).status).toBe(200);
    expect(rpcCalls[0]).toMatchObject({ name: 'close', args: { p_period: PER_OPEN, p_actor: OWN } });
  });

  it('a finance member without finance.approve, and a scoped member, cannot close', async () => {
    expect((await call('close', 'POST', FIN, L, { periodId: PER_OPEN })).status).toBe(403);
    expect((await call('close', 'POST', FSC, L, { periodId: PER_OPEN })).status).toBeGreaterThanOrEqual(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('answers 409 while draft statements remain', async () => {
    answers.close = { error: 'drafts_open' };
    const res = await call('close', 'POST', OWN, L, { periodId: PER_OPEN });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('drafts_open');
  });

  it('only the owner reopens: an admin is 403 before anything is called', async () => {
    expect((await call('reopen', 'POST', ADM, L, { periodId: PER_CLOSED })).status).toBe(403);
    expect((await call('reopen', 'POST', FIN, L, { periodId: PER_CLOSED })).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
    expect((await call('reopen', 'POST', OWN, L, { periodId: PER_CLOSED })).status).toBe(200);
    expect(rpcCalls[0]).toMatchObject({ name: 'reopen', args: { p_period: PER_CLOSED, p_actor: OWN } });
  });

  it('a period of another organization is 404', async () => {
    expect((await call('close', 'POST', STR, L2, { periodId: PER_OPEN })).status).toBe(404);
    expect((await call('reopen', 'POST', STR, L2, { periodId: PER_CLOSED })).status).toBeGreaterThanOrEqual(403);
  });
});
