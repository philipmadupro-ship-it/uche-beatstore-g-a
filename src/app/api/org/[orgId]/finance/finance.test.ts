/**
 * /api/org/[orgId]/finance/payees and /statements (LABEL-61), through the REAL
 * lib/auth/org-access, finance-store and activity against an in-memory
 * database. The row-level rules themselves are proved on Postgres in
 * supabase/local/checks/179_labelos_finance.sql; this proves the routes apply
 * the same rules for the service role, which bypasses RLS.
 *
 *   L (label): OWN owner · FIN finance function (whole org) · FSC finance scoped
 *   to Ara · MKT marketing (no finance.read) · R1 roster artist of Ara · R2
 *   roster artist of Bo, whose ACCOUNT is linked to Ara's party · EXT external
 *   project member. L2: a stranger's org.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1), FIN = u(2), FSC = u(3), MKT = u(4), R1 = u(5), R2 = u(6), EXT = u(7), STR = u(8);
const ARA = '30000000-0000-4000-8000-0000000000a1';
const BO = '30000000-0000-4000-8000-0000000000a2';
const PARA = '60000000-0000-4000-8000-000000000001';
const PBO = '60000000-0000-4000-8000-000000000002';
const PNONE = '60000000-0000-4000-8000-000000000003';
const POTHER = '60000000-0000-4000-8000-000000000004';
const YARA = '70000000-0000-4000-8000-000000000001';
const YBO = '70000000-0000-4000-8000-000000000002';
const PROJ = '40000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const payee = (id: string, party: string, artist: string | null, over: Record<string, unknown> = {}) => ({
  id, org_id: L, party_id: party, artist_contact_id: artist, currency: 'USD', status: 'active', payment_reference: 'on file', created_at: '2026-10-01', ...over,
});
const statement = (id: string, payeeId: string, artist: string | null, status: string, net: number) => ({
  id, org_id: L, payee_id: payeeId, period_id: 'per-1', artist_contact_id: artist, currency: 'USD', net_minor: net, status,
  approved_at: status === 'draft' ? null : '2026-10-02', issued_at: status === 'issued' ? '2026-10-03' : null, created_at: '2026-10-01',
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'), member(FIN, 'member', ['finance']), member(FSC, 'member', ['finance'], 'artists'), member(MKT, 'member', ['marketing']),
        member(R1, 'artist', [], 'artists'), member(R2, 'artist', [], 'artists'), member(STR, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: FSC, contact_id: ARA }, { org_id: L, user_id: R1, contact_id: ARA }, { org_id: L, user_id: R2, contact_id: BO }],
      project_members: [{ org_id: L, project_id: PROJ, user_id: EXT, role: 'editor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
      contacts: [
        { id: ARA, org_id: L, user_id: null, name: 'Ara', category: 'artist' },
        { id: BO, org_id: L, user_id: null, name: 'Bo', category: 'artist' },
      ],
      projects: [{ id: PROJ, org_id: L, user_id: null, name: 'EP', inbox_for_contact_id: null, created_at: '2026-10-01' }],
      parties: [
        { id: PARA, org_id: L, display_name: 'Ara', contact_id: ARA, user_id: R2 }, // linked to R2's account: proves nothing
        { id: PBO, org_id: L, display_name: 'Bo', contact_id: BO, user_id: null },
        { id: PNONE, org_id: L, display_name: 'Pat', contact_id: null, user_id: null },
        { id: POTHER, org_id: L2, display_name: 'Other', contact_id: null, user_id: null },
      ],
      payees: [payee(YARA, PARA, ARA), payee(YBO, PBO, BO)],
      statements: [
        statement('st-ara-issued', YARA, ARA, 'issued', 75000),
        statement('st-ara-draft', YARA, ARA, 'draft', 1000),
        statement('st-bo-issued', YBO, BO, 'issued', 5000),
        statement('st-bo-void', YBO, BO, 'void', 1),
      ],
      statement_lines: [
        { id: 'l1', org_id: L, statement_id: 'st-ara-issued', kind: 'earning', track_id: null, description: 'Streams', share_units: null, amount_minor: 100000, currency: 'USD', position: 0 },
        { id: 'l2', org_id: L, statement_id: 'st-ara-issued', kind: 'recoupment', track_id: null, description: 'Advance', share_units: null, amount_minor: -25000, currency: 'USD', position: 1 },
        { id: 'l3', org_id: L, statement_id: 'st-bo-issued', kind: 'earning', track_id: null, description: 'Streams', share_units: null, amount_minor: 5000, currency: 'USD', position: 0 },
      ],
      activity_events: [],
      user_profiles: [],
    },
    unique: { payees: [['org_id', 'party_id']] },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(path: 'payees' | 'statements', method: string, as: string | null, org: string, body?: unknown) {
  current = as;
  const mod = (path === 'payees' ? await import('./payees/route') : await import('./statements/route')) as unknown as Record<string, Handler>;
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/org/${org}/finance/${path}`, init), { params: Promise.resolve({ orgId: org }) });
}
const ids = async (res: Response, key: string) => ((await res.json())[key] as { id: string }[]).map((x) => x.id).sort();

describe('GET /finance/statements — who reads what', () => {
  it('finance.read reads every statement of the org, drafts and voids included (summaries: lines are the detail route\'s)', async () => {
    for (const who of [OWN, FIN]) {
      const res = await call('statements', 'GET', who, L);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.own).toBe(false);
      expect(body.statements.map((s: { id: string }) => s.id).sort()).toEqual(['st-ara-draft', 'st-ara-issued', 'st-bo-issued', 'st-bo-void']);
      const ara = body.statements.find((s: { id: string }) => s.id === 'st-ara-issued');
      expect(ara.netMinor).toBe('75000');
      expect(ara).not.toHaveProperty('lines');
    }
  });

  it('a finance member limited to Ara reads Ara’s statements only', async () => {
    expect(await ids(await call('statements', 'GET', FSC, L), 'statements')).toEqual(['st-ara-draft', 'st-ara-issued']);
  });

  it('a roster artist reads only their own ISSUED statements — never a draft, never another artist’s', async () => {
    const res = await call('statements', 'GET', R1, L);
    const body = await res.json();
    expect(body.own).toBe(true);
    expect(body.statements.map((s: { id: string }) => s.id)).toEqual(['st-ara-issued']);
    expect(body.statements[0]).not.toHaveProperty('approvedAt');
    expect(body.statements[0]).not.toHaveProperty('lines');
    expect(body.statements[0].status).toBe('issued');
  });

  it('a party linked to your account gives you nothing of its payee (LABEL-71 H1)', async () => {
    // R2 stands for Bo; Ara's party is linked to R2's account. R2 reads Bo's issued statement and not Ara's.
    const body = await (await call('statements', 'GET', R2, L)).json();
    expect(body.statements.map((s: { id: string }) => s.id)).toEqual(['st-bo-issued']);
  });

  it('marketing, an external member, a stranger, and anonymous read nothing', async () => {
    expect((await call('statements', 'GET', MKT, L)).status).toBe(403);
    expect((await call('statements', 'GET', EXT, L)).status).toBeGreaterThanOrEqual(403);
    expect((await call('statements', 'GET', STR, L)).status).toBeGreaterThanOrEqual(403);
    expect((await call('statements', 'GET', null, L)).status).toBe(401);
  });

  it('an org without the finance module answers 404, to the owner and the artist alike', async () => {
    db.tables.org_entitlements = [{ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null }];
    expect((await call('statements', 'GET', OWN, L)).status).toBe(404);
    expect((await call('statements', 'GET', R1, L)).status).toBe(404);
    expect((await call('payees', 'GET', OWN, L)).status).toBe(404);
  });

  it('degrades to schemaReady:false when migration 179 is not applied', async () => {
    db.missingTables = ['payees', 'statements', 'statement_lines'];
    const res = await call('statements', 'GET', OWN, L);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schemaReady: false, statements: [] });
    expect(await (await call('payees', 'GET', OWN, L)).json()).toMatchObject({ schemaReady: false, payees: [] });
  });
});

describe('/finance/payees', () => {
  it('lists payees with finance.read; the payment reference only with finance.write', async () => {
    const own = await (await call('payees', 'GET', OWN, L)).json();
    expect(own.payees).toHaveLength(2);
    expect(own.payees[0].paymentReference).toBe('on file');
    expect(own.canWrite).toBe(true);
  });

  it('a scoped member lists only their artist’s payees', async () => {
    expect(await ids(await call('payees', 'GET', FSC, L), 'payees')).toEqual([YARA]);
  });

  it('a roster artist, marketing and strangers cannot list payees', async () => {
    for (const who of [R1, R2, MKT, STR]) expect((await call('payees', 'GET', who, L)).status).toBeGreaterThanOrEqual(403);
  });

  it('POST makes a payee of a party, records a payee.created event with ids only, and refuses a second', async () => {
    const res = await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: null, currency: 'eur', payment_reference: 'wire details on file' });
    expect(res.status).toBe(201);
    const made = (await res.json()).payee;
    expect(made).toMatchObject({ partyId: PNONE, artistContactId: null, currency: 'EUR' });
    const ev = db.tables.activity_events.filter((e) => e.verb === 'payee.created');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ subject_type: 'payee', visibility: 'internal' });
    expect(JSON.stringify(ev[0].payload)).not.toMatch(/EUR|wire|Pat/);
    expect((await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: null })).status).toBe(409);
  });

  it('POST: unknown currency, account-number-like reference, a foreign party and unknown keys are refused', async () => {
    expect((await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: null, currency: 'XXX' })).status).toBe(400);
    expect((await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: null, payment_reference: 'GB29 NWBK 6016 1331 9268 19' })).status).toBe(400);
    expect((await call('payees', 'POST', OWN, L, { party_id: POTHER, artist_contact_id: null })).status).toBe(404);
    expect((await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: null, bogus: BO })).status).toBe(400);
  });

  it('POST needs finance.write; a scoped member can only pay a party of their own artist', async () => {
    for (const who of [R1, MKT, STR]) expect((await call('payees', 'POST', who, L, { party_id: PNONE, artist_contact_id: null })).status).toBeGreaterThanOrEqual(403);
    expect((await call('payees', 'POST', FSC, L, { party_id: PNONE, artist_contact_id: null })).status).toBe(404); // no artist: whole-org only
    expect((await call('payees', 'POST', FSC, L, { party_id: PBO, artist_contact_id: BO })).status).toBe(404); // Bo is outside their scope
    db.tables.payees = [];
    expect((await call('payees', 'POST', FSC, L, { party_id: PARA, artist_contact_id: ARA })).status).toBe(201);
  });

  it('POST names the artist it expects: a party that stands for someone else is a 409; omitting it is a 400', async () => {
    expect((await call('payees', 'POST', OWN, L, { party_id: PARA, artist_contact_id: BO })).status).toBe(409);
    expect((await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: ARA })).status).toBe(409);
    expect((await call('payees', 'POST', OWN, L, { party_id: PNONE })).status).toBe(400);
  });

  it('POST answers 503  naming 179 when the migration is missing', async () => {
    db.missingTables = ['payees'];
    const res = await call('payees', 'POST', OWN, L, { party_id: PNONE, artist_contact_id: null });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/179/);
  });
});
