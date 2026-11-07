/**
 * /api/org/[orgId]/finance/earnings/** (LABEL-62), through the REAL lib/auth/org-access, earnings-store and
 * activity against an in-memory database. The rows' own rules (allocation sums, recoupment limits, idempotency by
 * hash) are proved on Postgres in supabase/local/checks/180_labelos_earnings.sql and the pure arithmetic in
 * lib/labelos/finance/earnings-calc.test.ts; this proves who may call what, the scoped queue, the stored
 * payload and the idempotent no-op.
 *
 *   L (label): OWN owner · FIN finance (whole org) · FSC finance scoped to Ara · MKT marketing (no finance)
 *   · R1 roster artist of Ara · EXT external project member. L2: a stranger's org.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1), FIN = u(2), FSC = u(3), MKT = u(4), R1 = u(5), EXT = u(6), STR = u(7);
const ARA = '30000000-0000-4000-8000-0000000000a1';
const BO = '30000000-0000-4000-8000-0000000000a2';
const PROJ_A = '40000000-0000-4000-8000-000000000001';
const PROJ_B = '40000000-0000-4000-8000-000000000002';
const SONG_A = '50000000-0000-4000-8000-000000000001';
const SONG_B = '50000000-0000-4000-8000-000000000002';
const PARTY = '60000000-0000-4000-8000-000000000001';
const PAYEE = '70000000-0000-4000-8000-000000000001';
const SHEET = '80000000-0000-4000-8000-000000000001';
const IMPORT_ID = '90000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const reviewLine = (id: string, reason: string, track: string | null, song: string | null) => ({
  id, org_id: L, import_id: IMPORT_ID, line_no: Number(id.slice(-1)), isrc: 'USABC2600001', upc: null, title: 'T', store: 'Spotify', territory: 'US', gross_minor: 1234, currency: 'USD',
  track_id: track, song_track_id: song, income_class: 'master', review_reason: reason, period_start: '2026-09-01',
});

const CSV = 'ISRC,Amount\nUS-ABC-26-00001,10.00\nUS-ABC-26-00002,5.50\n';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  rpcCalls = [];
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'), member(FIN, 'member', ['finance']), member(FSC, 'member', ['finance'], 'artists'), member(MKT, 'member', ['marketing']),
        member(R1, 'artist', [], 'artists'), member(STR, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: FSC, contact_id: ARA }, { org_id: L, user_id: R1, contact_id: ARA }],
      project_members: [{ org_id: L, project_id: PROJ_A, user_id: EXT, role: 'editor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
      contacts: [{ id: ARA, org_id: L, user_id: null, name: 'Ara', category: 'artist' }, { id: BO, org_id: L, user_id: null, name: 'Bo', category: 'artist' }],
      projects: [
        { id: PROJ_A, org_id: L, user_id: null, name: 'A', inbox_for_contact_id: ARA, created_at: '2026-10-01' },
        { id: PROJ_B, org_id: L, user_id: null, name: 'B', inbox_for_contact_id: BO, created_at: '2026-10-01' },
      ],
      project_contacts: [],
      project_tracks: [{ project_id: PROJ_A, track_id: SONG_A }, { project_id: PROJ_B, track_id: SONG_B }],
      tracks: [
        { id: SONG_A, org_id: L, type: 'song', isrc: 'USABC2600001' },
        { id: SONG_B, org_id: L, type: 'song', isrc: 'USABC2600002' },
      ],
      releases: [], release_items: [], track_links: [], contracts: [], contract_parties: [], contract_signatures: [], advances: [], earnings_recoupments: [], earnings_allocations: [],
      split_sheets: [{ id: SHEET, org_id: L, track_id: SONG_A, kind: 'master', status: 'signed' }],
      split_lines: [{ split_sheet_id: SHEET, org_id: L, party_id: PARTY, share: 100, position: 0, id: 'sl1' }],
      payees: [{ id: PAYEE, org_id: L, party_id: PARTY, artist_contact_id: ARA, currency: 'USD', status: 'active' }],
      finance_periods: [],
      earnings_imports: [],
      earnings_lines: [
        reviewLine('line-1', 'no_match', null, null),
        reviewLine('line-2', 'no_sheet', SONG_A, SONG_A),
        reviewLine('line-3', 'no_sheet', SONG_B, SONG_B),
      ],
      activity_events: [],
      user_profiles: [],
    },
    rpc: {
      labelos_earnings_import: (args, tables) => {
        rpcCalls.push({ name: 'import', args });
        const header = args.p_import as Record<string, unknown>;
        tables.earnings_imports.push({ id: IMPORT_ID, org_id: L, file_sha256: header.file_sha256 });
        return { data: { id: IMPORT_ID, created: true }, error: null };
      },
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const base = (org: string) => `https://app.test/api/org/${org}/finance/earnings`;

async function importsGet(as: string | null, org = L) {
  current = as;
  const mod = (await import('./imports/route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`${base(org)}/imports`), { params: Promise.resolve({ orgId: org }) });
}
async function importsPost(as: string | null, csv = CSV, fields: Record<string, string> = {}, org = L) {
  current = as;
  const form = new FormData();
  form.set('file', new File([csv], 'report.csv', { type: 'text/csv' }));
  form.set('preset', 'generic');
  form.set('currency', 'USD');
  form.set('mapping', JSON.stringify({ isrc: 'ISRC', amount: 'Amount' }));
  for (const [k, v] of Object.entries(fields)) {
    if (v === '') form.delete(k);
    else form.set(k, v);
  }
  const mod = (await import('./imports/route')) as unknown as Record<string, Handler>;
  return mod.POST(new NextRequest(`${base(org)}/imports`, { method: 'POST', body: form }), { params: Promise.resolve({ orgId: org }) });
}
async function queue(as: string | null, org = L) {
  current = as;
  const mod = (await import('./unmatched/route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`${base(org)}/unmatched`), { params: Promise.resolve({ orgId: org }) });
}
const lineIds = async (res: Response) => ((await res.json()).lines as { id: string }[]).map((l) => l.id).sort();

describe('the needs-review queue', () => {
  it('a whole-org finance reader sees every waiting line', async () => {
    for (const who of [OWN, FIN]) expect(await lineIds(await queue(who))).toEqual(['line-1', 'line-2', 'line-3']);
  });

  it('a finance member limited to Ara sees only lines on Ara’s songs: not an unmatched one, not Bo’s, and no count of them', async () => {
    const res = await queue(FSC);
    const body = await res.json();
    expect(body.lines.map((l: { id: string }) => l.id)).toEqual(['line-2']);
    expect(JSON.stringify(body)).not.toMatch(/hidden|line-1|line-3/);
    expect(body.canWrite).toBe(false);
  });

  it('refuses marketing, a roster artist, an external member, a stranger and anonymous', async () => {
    expect((await queue(MKT)).status).toBe(403);
    expect((await queue(R1)).status).toBe(403);
    expect([401, 404]).toContain((await queue(null)).status);
    expect((await queue(EXT)).status).toBeGreaterThanOrEqual(403);
    expect((await queue(STR)).status).toBeGreaterThanOrEqual(403);
  });

  it('words each reason and carries amounts as strings', async () => {
    const body = await (await queue(FIN)).json();
    const l = body.lines.find((x: { id: string }) => x.id === 'line-2');
    expect(l).toMatchObject({ reason: 'no_sheet', gross_minor: '1234', matched: true });
    expect(l.reason_label).toMatch(/split sheet/i);
  });

  it('an org without the finance module reads nothing: 404', async () => {
    db.tables.org_entitlements = [{ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null }];
    expect((await queue(FIN)).status).toBe(404);
  });

  it('answers schemaReady:false when migration 180 is not applied', async () => {
    db.missingTables = ['earnings_lines'];
    const body = await (await queue(FIN)).json();
    expect(body).toMatchObject({ schemaReady: false, lines: [] });
  });
});

describe('POST /imports', () => {
  it('imports a file in one database call, records an event with counts only, and returns the summary', async () => {
    const res = await importsPost(FIN);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ created: true, import_id: IMPORT_ID, currency: 'USD', lines: 2, total_minor: '1550' });
    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args as { p_org: string; p_user: string; p_import: Record<string, unknown>; p_lines: Record<string, unknown>[]; p_allocs: Record<string, unknown>[] };
    expect(args.p_org).toBe(L);
    expect(args.p_user).toBe(FIN);
    expect(args.p_import).toMatchObject({ file_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), currency: 'USD', row_count: 2, total_minor: '1550', source: 'generic' });
    // Line 2 is Ara's song with a 100 % sheet → allocated to her payee; line 3 matches Bo's song, which has no sheet → waits.
    expect(args.p_lines.map((l) => [l.line_no, l.gross_minor, l.review_reason])).toEqual([[2, '1000', null], [3, '550', 'no_sheet']]);
    expect(args.p_allocs).toHaveLength(1);
    expect(args.p_allocs[0]).toMatchObject({ line_no: 2, payee_id: PAYEE, basis: 'split', units: 1000000, payable_minor: '1000', contract_id: null });
    const ev = db.tables.activity_events.filter((e) => e.verb === 'earnings.imported');
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0].payload)).not.toMatch(/1000|1550|550|Spotify/);
    expect(ev[0].payload).toEqual({ lines: 2, allocated: 1, waiting: 1, allocations: 1, recoupments: 0 });
  });

  it('importing the same file again changes nothing: the original import, no write, no second event', async () => {
    await importsPost(FIN);
    rpcCalls = [];
    const again = await importsPost(FIN);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false, import_id: IMPORT_ID });
    expect(rpcCalls).toHaveLength(0);
    expect(db.tables.activity_events.filter((e) => e.verb === 'earnings.imported')).toHaveLength(1);
  });

  it('the same file after its import was voided is not "the original stands": it says the import was voided (409), nothing written', async () => {
    await importsPost(FIN);
    rpcCalls = [];
    db.tables.earnings_imports[0].status = 'void';
    const again = await importsPost(FIN);
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body).toMatchObject({ code: 'voided_file' });
    expect(body.error).toMatch(/voided/i);
    expect(body.error).not.toMatch(/original import stands/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a file with a bad row, naming the line, and writes nothing', async () => {
    const res = await importsPost(FIN, 'ISRC,Amount\nUS-ABC-26-00001,ten\n');
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'bad_rows', issues: [{ lineNo: 2 }] });
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses mixed currencies', async () => {
    const res = await importsPost(FIN, 'ISRC,Amount,Cur\nUS-ABC-26-00001,1.00,USD\nUS-ABC-26-00002,1.00,EUR\n', { mapping: JSON.stringify({ isrc: 'ISRC', amount: 'Amount', currency: 'Cur' }), currency: '' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('mixed_currency');
  });

  it('needs finance.write on the whole organization; a roster artist, marketing, a scoped finance member, an external member and a stranger cannot', async () => {
    expect((await importsPost(MKT)).status).toBe(403);
    expect((await importsPost(R1)).status).toBe(403);
    expect((await importsPost(FSC)).status).toBe(403);
    expect((await importsPost(EXT)).status).toBeGreaterThanOrEqual(403);
    expect((await importsPost(STR)).status).toBeGreaterThanOrEqual(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('503 naming the migration when 180 is not applied; never a 500', async () => {
    db.missingTables = ['earnings_imports'];
    const res = await importsPost(FIN);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/180/);
  });

  it('GET lists imports for a whole-org reader and nothing for a scoped one', async () => {
    db.tables.earnings_imports = [{ id: IMPORT_ID, org_id: L, period_id: null, source: 'generic', file_name: 'r.csv', file_sha256: 'x', currency: 'USD', row_count: 2, total_minor: 1550, status: 'imported', created_at: '2026-10-01' }];
    const body = await (await importsGet(FIN)).json();
    expect(body.imports).toHaveLength(1);
    expect(body.imports[0].total_minor).toBe('1550');
    expect(body.imports[0]).not.toHaveProperty('file_sha256');
    expect(await (await importsGet(FSC)).json()).toMatchObject({ scoped: true, imports: [] });
    expect((await importsGet(R1)).status).toBe(403);
  });
});
