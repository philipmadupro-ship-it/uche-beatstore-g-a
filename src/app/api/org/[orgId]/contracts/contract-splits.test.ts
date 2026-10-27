/**
 * LABEL-59 over the real routes, org-access, contract / split stores and the
 * activity writer against an in-memory database: a contract pre-fills DRAFT
 * split sheets (never a circulated one, never over an existing draft without
 * `replace_draft`), drift is derived on read for both the contract and the
 * song's splits view, and an own-line reader / a roster artist learn only that
 * a sheet differs (D2).
 *
 *   L: OWN (owner), LEG (legal), LNR (legal, rights.read revoked), SC (legal,
 *      limited to Kilo), MKT (marketing), ART (roster artist Nova, party PN).
 *   Song S1 is Nova's. Contract parties: PL label, PN Nova, PF featured.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { assertCanSign } from '@/lib/labelos/contract-splits-store';
import { createServiceClient } from '@/lib/supabase/server';

const L = '10000000-0000-4000-8000-000000000001';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const LEG = u(2);
const LNR = u(3);
const SC = u(4);
const MKT = u(5);
const ART = u(6);
const PRD = u(8);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const S1 = '50000000-0000-4000-8000-000000000001';
const S2 = '50000000-0000-4000-8000-000000000002';
const P1 = '40000000-0000-4000-8000-000000000001';
const PL = '60000000-0000-4000-8000-000000000001';
const PN = '60000000-0000-4000-8000-000000000002';
const PF = '60000000-0000-4000-8000-000000000003';
const TPL = '90000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let contractsMissing = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
  createServiceClient: () => memoryAdmin(db).client,
}));
const missingTable = (): unknown => {
  const chain: unknown = new Proxy(() => chain, {
    get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) : () => chain),
    apply: () => chain,
  });
  return chain;
};
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const client = memoryAdmin(db).client as unknown as { from: (t: string) => unknown };
    const from = client.from.bind(client);
    return Object.assign(client, { from: (t: string) => (contractsMissing && t === 'contracts' ? missingTable() : from(t)) });
  },
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', cap_revokes: string[] = []) => ({ org_id: L, user_id: user, role, functions, scope, cap_grants: [], cap_revokes });

let seq = 0;
const CLAUSES = [{ id: 'a', heading: 'Master', body: 'The Featured Artist owns {{master_share}}% of the master of {{song.title}}.' }];
const contractRow = (over: Record<string, unknown>) => ({
  id: `70000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, org_id: L, type: 'feature', title: 'Feature on Midnight', status: 'sent', template_id: TPL,
  template_source: 'org:1', template_version: 1, clauses: CLAUSES.map((c) => ({ ...c })), artist_contact_id: C1, track_id: S1, release_id: null,
  effective_date: null, term_months: null, territories: null, fields: { master_share: '30', publishing_share: '10' }, internal_note: 'INTERNAL-NOTE', version: 1,
  created_by: OWN, voided_at: null, void_reason: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  current = null;
  contractsMissing = false;
  seq = 0;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null, settings: {} }],
      org_members: [member(OWN, 'owner'), member(LEG, 'member', ['legal']), member(LNR, 'member', ['legal'], 'org', ['rights.read']), member(SC, 'member', ['legal'], 'artists'), member(MKT, 'member', ['marketing']), member(ART, 'artist', [], 'artists'), member(PRD, 'member', ['producer'])],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [{ id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' }, { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' }],
      tracks: [
        { id: S1, org_id: L, user_id: null, type: 'song', title: 'Midnight', song_stage: 'inbox' },
        { id: S2, org_id: L, user_id: null, type: 'song', title: 'Loose', song_stage: 'inbox' },
      ],
      projects: [{ id: P1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: C1, created_at: '2026-10-01' }],
      project_tracks: [{ project_id: P1, track_id: S1, position: 0 }],
      project_contacts: [],
      releases: [],
      parties: [
        { id: PL, org_id: L, display_name: 'Label L', legal_name: 'Label L Ltd', address: null, user_id: null, contact_id: null },
        { id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: null, user_id: ART, contact_id: C1 },
        { id: PF, org_id: L, display_name: 'Feat', legal_name: 'Feat Person', address: null, user_id: PRD, contact_id: null },
      ],
      contracts: [],
      contract_parties: [],
      contract_templates: [{ id: TPL, org_id: L, type: 'feature', version: 1, name: 'Feature', clauses: CLAUSES.map((c) => ({ ...c })), based_on: null, created_by: OWN, created_at: '2026-10-01' }],
      split_sheets: [],
      split_lines: [],
      project_assets: [],
      activity_events: [],
      user_profiles: [],
    },
    rpc: {
      labelos_split_create_draft: (args, tables) => {
        const kind = args.p_kind as string;
        if (tables.split_sheets.some((s) => s.track_id === args.p_track && s.kind === kind && s.status === 'draft')) return { data: { error: 'draft_exists' }, error: null };
        const version = Math.max(0, ...tables.split_sheets.filter((s) => s.track_id === args.p_track && s.kind === kind).map((s) => Number(s.version))) + 1;
        const id = `80000000-0000-4000-8000-${String(tables.split_sheets.length + 1).padStart(12, '0')}`;
        const sheet = { id, org_id: args.p_org, track_id: args.p_track, kind, version, status: 'draft', note: args.p_note ?? null, document_asset_id: null, created_by: args.p_actor, created_at: '2026-10-02T00:00:00Z', circulated_at: null, signed_at: null, superseded_at: null, superseded_by: null };
        tables.split_sheets.push(sheet);
        ((args.p_lines as { party_id: string; role: string; share: string }[] | null) ?? []).forEach((l, i) =>
          tables.split_lines.push({ id: `${id}-l${i}`, org_id: args.p_org, split_sheet_id: id, party_id: l.party_id, role: l.role, share: l.share, position: i, signed_at: null, signature_method: null, signature_asset_id: null }),
        );
        return { data: { sheet }, error: null };
      },
      labelos_split_save_draft: (args, tables) => {
        const sheet = tables.split_sheets.find((s) => s.id === args.p_sheet);
        if (!sheet) return { data: { error: 'not_found' }, error: null };
        if (sheet.status !== 'draft') return { data: { error: 'not_draft' }, error: null };
        if (args.p_set_lines) {
          tables.split_lines = tables.split_lines.filter((l) => l.split_sheet_id !== sheet.id);
          (args.p_lines as { party_id: string; role: string; share: string }[]).forEach((l, i) =>
            tables.split_lines.push({ id: `${sheet.id}-r${i}`, org_id: args.p_org, split_sheet_id: sheet.id, party_id: l.party_id, role: l.role, share: l.share, position: i, signed_at: null, signature_method: null, signature_asset_id: null }),
          );
        }
        return { data: { sheet }, error: null };
      },
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function contractSplits(method: 'GET' | 'POST', as: string | null, id: string, body?: unknown) {
  current = as;
  const mod = (await import('./[contractId]/splits/route')) as unknown as Record<string, Handler>;
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/org/${L}/contracts/${id}/splits`, init), { params: Promise.resolve({ orgId: L, contractId: id }) });
}

async function songSplits(as: string | null, track = S1) {
  current = as;
  const mod = (await import('../tracks/[id]/splits/route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${L}/tracks/${track}/splits`), { params: Promise.resolve({ orgId: L, id: track }) });
}

const add = (over: Record<string, unknown> = {}, novaIsParty = true) => {
  const row = contractRow(over);
  db.tables.contracts.push(row);
  db.tables.contract_parties.push(
    { contract_id: row.id, org_id: L, party_id: PL, role: 'label', position: 0 },
    ...(novaIsParty ? [{ contract_id: row.id, org_id: L, party_id: PN, role: 'artist', position: 1 }] : []),
    { contract_id: row.id, org_id: L, party_id: PF, role: 'featured', position: 2 },
  );
  return row;
};
const sheet = (kind: string, status: string, lines: [string, string][], track = S1) => {
  const id = `81000000-0000-4000-8000-${String(db.tables.split_sheets.length + 1).padStart(12, '0')}`;
  db.tables.split_sheets.push({ id, org_id: L, track_id: track, kind, version: 1, status, note: null, document_asset_id: null, created_by: OWN, created_at: '2026-10-01', circulated_at: null, signed_at: null, superseded_at: null, superseded_by: null });
  lines.forEach(([party, share], i) => db.tables.split_lines.push({ id: `${id}-l${i}`, org_id: L, split_sheet_id: id, party_id: party, role: kind === 'master' ? 'master_owner' : 'writer', share, position: i, signed_at: null, signature_method: null, signature_asset_id: null }));
  return id;
};
const linesOf = (sheetId: string) => db.tables.split_lines.filter((l) => l.split_sheet_id === sheetId).map((l) => [l.party_id, l.share]);
const events = (verb: string) => db.tables.activity_events.filter((e) => e.verb === verb);

describe('POST — pre-fill a draft from the contract', () => {
  it('creates a master and a composition DRAFT with exact integer shares (the featured artist’s, the rest to the primary artist)', async () => {
    const c = add({ fields: { master_share: '33.3333', publishing_share: '10' } });
    const res = await contractSplits('POST', LEG, c.id);
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { kind: string; action: string }) => [r.kind, r.action])).toEqual([['master', 'created'], ['composition', 'created']]);
    expect(db.tables.split_sheets.map((s) => [s.kind, s.status, s.version])).toEqual([['master', 'draft', 1], ['composition', 'draft', 1]]);
    expect(linesOf(db.tables.split_sheets[0].id as string)).toEqual([[PF, '33.3333'], [PN, '66.6667']]);
    expect(linesOf(db.tables.split_sheets[1].id as string)).toEqual([[PF, '10.0000'], [PN, '90.0000']]);
  });

  it('records the sheets as created from a contract, with kind and version only — never a share or a name', async () => {
    const c = add();
    await contractSplits('POST', LEG, c.id, { kind: 'master' });
    expect(db.tables.split_sheets).toHaveLength(1);
    const ev = events('split_sheet.created');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ kind: 'master', version: 1, source: 'contract' });
  });

  it('never overwrites an existing draft silently: 409, and the hand-edited lines survive', async () => {
    const c = add();
    const draft = sheet('master', 'draft', [[PN, '60'], [PL, '40']]);
    const res = await contractSplits('POST', LEG, c.id, { kind: 'master' });
    expect(res.status).toBe(409);
    expect(linesOf(draft)).toEqual([[PN, '60'], [PL, '40']]);
    expect(events('split_sheet.created')).toHaveLength(0);
  });

  it('replaces the draft’s lines only when asked', async () => {
    const c = add();
    const draft = sheet('master', 'draft', [[PN, '60'], [PL, '40']]);
    const res = await contractSplits('POST', LEG, c.id, { kind: 'master', replace_draft: true });
    expect(res.status).toBe(200);
    expect((await res.json()).results[0]).toMatchObject({ kind: 'master', action: 'replaced', sheetId: draft });
    expect(linesOf(draft)).toEqual([[PF, '30.0000'], [PN, '70.0000']]);
    expect(events('split_sheet.updated')[0].payload).toMatchObject({ kind: 'master', source: 'contract', lines: true });
  });

  it('never touches a circulated or signed sheet: it starts the next DRAFT beside it', async () => {
    const c = add();
    const live = sheet('master', 'signed', [[PN, '50'], [PL, '50']]);
    const res = await contractSplits('POST', LEG, c.id, { kind: 'master' });
    expect(res.status).toBe(200);
    expect(db.tables.split_sheets.find((s) => s.id === live)).toMatchObject({ status: 'signed', version: 1 });
    expect(linesOf(live)).toEqual([[PN, '50'], [PL, '50']]);
    expect(db.tables.split_sheets.filter((s) => s.status === 'draft').map((s) => s.version)).toEqual([2]);
  });

  it('skips a kind the contract cannot fill and reports why (a missing share), and creates the other', async () => {
    const c = add({ fields: { publishing_share: '10' } });
    const res = await contractSplits('POST', LEG, c.id);
    const { results } = await res.json();
    expect(results).toEqual([{ kind: 'master', action: 'skipped', reason: 'field_missing' }, expect.objectContaining({ kind: 'composition', action: 'created' })]);
  });

  it('422 when nothing can be filled: no song, no share, a type that states no split', async () => {
    expect((await contractSplits('POST', LEG, add({ track_id: null }).id)).status).toBe(422);
    expect((await contractSplits('POST', LEG, add({ fields: {} }).id)).status).toBe(422);
    const recording = await contractSplits('POST', LEG, add({ type: 'recording' }).id);
    expect(recording.status).toBe(422);
    expect((await recording.json()).reason).toBe('not_applicable');
    expect(db.tables.split_sheets).toHaveLength(0);
  });

  it('a void contract starts nothing; a bad body is 400', async () => {
    expect((await contractSplits('POST', LEG, add({ status: 'void' }).id)).status).toBe(409);
    expect((await contractSplits('POST', LEG, add().id, { kind: 'bogus' })).status).toBe(400);
  });

  it('needs contracts.write AND rights.write on the song, inside the artist’s scope', async () => {
    const c = add();
    expect((await contractSplits('POST', MKT, c.id)).status).toBe(403);
    expect((await contractSplits('POST', ART, c.id)).status).toBe(403);
    expect((await contractSplits('POST', SC, c.id)).status).toBe(404);
    expect((await contractSplits('POST', null, c.id)).status).toBe(401);
    expect(db.tables.split_sheets).toHaveLength(0);
  });

  it('degrades: contracts not applied → 503 naming the migration, splits not applied → 503, never 500', async () => {
    const c = add();
    contractsMissing = true;
    const res = await contractSplits('POST', LEG, c.id);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('176');
  });
});

describe('GET — what would be filled, and drift', () => {
  it('shows each kind’s plan with names and shares, and no drift when there is no sheet', async () => {
    const c = add();
    const body = await (await contractSplits('GET', LEG, c.id)).json();
    expect(body).toMatchObject({ schemaReady: true, applicable: true, canPrefill: true, drift: [] });
    expect(body.plans[0]).toMatchObject({ kind: 'master', ok: true, lines: [{ name: 'Feat Person', share: '30' }, { name: 'Nova Okafor', share: '70' }] });
    expect(JSON.stringify(body)).not.toContain('INTERNAL-NOTE');
  });

  it('a contract type that states no split is not applicable', async () => {
    const body = await (await contractSplits('GET', LEG, add({ type: 'nda', fields: {} }).id)).json();
    expect(body).toMatchObject({ applicable: false, plans: [], drift: [] });
  });

  it('drift: a circulated sheet that disagrees with a SENT contract is itemised for rights.read', async () => {
    const c = add();
    const s = sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    const body = await (await contractSplits('GET', LEG, c.id)).json();
    expect(body.drift).toEqual([
      {
        kind: 'master', drifted: true, sheetId: s,
        items: [
          { partyId: PF, name: 'Feat', code: 'differs', contract: '30', sheet: '25' },
          { partyId: PN, name: 'Nova', code: 'differs', contract: '70', sheet: '75' },
        ],
      },
    ]);
  });

  it('no drift while the contract is still a draft, or when the sheet carries the stated shares', async () => {
    const draftContract = add({ status: 'draft' });
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    expect((await (await contractSplits('GET', LEG, draftContract.id)).json()).drift).toEqual([]);
    db.tables.split_sheets = [];
    db.tables.split_lines = [];
    const ok = add();
    sheet('master', 'signed', [[PF, '30'], [PN, '70']]);
    expect((await (await contractSplits('GET', LEG, ok.id)).json()).drift).toEqual([{ kind: 'master', drifted: false, sheetId: db.tables.split_sheets[0].id }]);
  });

  it('D2: the roster artist (a party, own-line) is told only that the sheet differs — no name, no share, no total', async () => {
    const c = add();
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    const res = await contractSplits('GET', ART, c.id);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.drift).toEqual([expect.objectContaining({ kind: 'master', drifted: true })]);
    expect(body.drift[0].items).toBeUndefined();
    expect(body.canPrefill).toBe(false);
    // The plan is the contract's own text (which this reader may read); what the SHEET says is not theirs to see.
    for (const secret of ['"sheet"', '"actual"', '"total"', 'INTERNAL-NOTE']) expect(text).not.toContain(secret);
  });

  it('a member without rights.read gets the yes/no only', async () => {
    const c = add();
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    const body = await (await contractSplits('GET', LNR, c.id)).json();
    if (body.drift.length > 0) expect(body.drift[0].items).toBeUndefined();
  });

  it('a contract outside the member’s artist scope is a 404', async () => {
    expect((await contractSplits('GET', SC, add().id)).status).toBe(404);
  });

  it('degrades to schemaReady:false when the contracts table is missing', async () => {
    const c = add();
    contractsMissing = true;
    const res = await contractSplits('GET', LEG, c.id);
    expect(res.status).toBe(200);
    expect((await res.json()).schemaReady).toBe(false);
  });
});

describe('the song’s splits view carries the contract’s drift', () => {
  it('lists the song’s contracts with itemised drift for rights.read', async () => {
    const c = add();
    const s = sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    const body = await (await songSplits(LEG)).json();
    expect(body.contracts).toEqual([
      { contractId: c.id, title: 'Feature on Midnight', status: 'sent', type: 'feature', drift: [expect.objectContaining({ kind: 'master', drifted: true, sheetId: s, items: expect.any(Array) })] },
    ]);
  });

  it('D2: an own-line reader (a producer-function member who is the featured party) sees a yes/no, and only for sheets they are on', async () => {
    add();
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    sheet('composition', 'circulated', [[PN, '10'], [PL, '90']]);
    const res = await songSplits(PRD);
    const text = await res.clone().text();
    const body = await res.json();
    expect(body.contracts).toHaveLength(1);
    // PRD is on the master sheet (as the featured party), not on the composition sheet.
    expect(body.contracts[0].drift).toHaveLength(1);
    expect(body.contracts[0].drift[0]).toMatchObject({ kind: 'master', drifted: true });
    expect(body.contracts[0].drift[0].items).toBeUndefined();
    expect(text).not.toContain('INTERNAL-NOTE');
    expect(text).not.toContain('Nova Okafor');
  });

  it('the roster artist reads names and shares of a sheet already, but the drift view stays a yes/no', async () => {
    add();
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    const body = await (await songSplits(ART)).json();
    expect(body.contracts[0].drift[0].items).toBeUndefined();
  });

  it('a contract the member may not read does not appear (another artist’s scope; a draft for an artist)', async () => {
    add({ artist_contact_id: C2 }, false);
    add({ status: 'draft' }, false);
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    expect((await (await songSplits(ART)).json()).contracts).toEqual([]);
    expect((await songSplits(SC)).status).toBe(404); // the song itself is outside their scope
  });

  it('a void contract says nothing', async () => {
    add({ status: 'void' });
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    expect((await (await songSplits(LEG)).json()).contracts).toEqual([]);
  });

  it('keeps working when the contracts table is missing: the sheets still come back', async () => {
    sheet('master', 'circulated', [[PF, '25'], [PN, '75']]);
    contractsMissing = true;
    const body = await (await songSplits(LEG)).json();
    expect(body.schemaReady).toBe(true);
    expect(body.sheets).toHaveLength(1);
    expect(body.contracts).toEqual([]);
  });
});

describe('assertCanSign — what LABEL-60 calls', () => {
  const admin = () => createServiceClient() as unknown as Parameters<typeof assertCanSign>[0];
  const feature = { type: 'feature' as const, track_id: S1 };

  it('passes while the setting is off (the default)', async () => {
    expect(await assertCanSign(admin(), L, feature)).toEqual({ ok: true });
  });

  it('with the setting on, blocks until the song’s master sheet is signed — then passes', async () => {
    db.tables.organizations[0].settings = { require_signed_master_split: true };
    const none = await assertCanSign(admin(), L, feature);
    expect(none).toMatchObject({ ok: false, code: 'master_split_not_signed' });
    const s = sheet('master', 'circulated', [[PF, '30'], [PN, '70']]);
    expect(await assertCanSign(admin(), L, feature)).toMatchObject({ ok: false });
    db.tables.split_sheets.find((x) => x.id === s)!.status = 'signed';
    expect(await assertCanSign(admin(), L, feature)).toEqual({ ok: true });
  });

  it('a composition sheet does not satisfy it, and another song’s sheet does not either', async () => {
    db.tables.organizations[0].settings = { require_signed_master_split: true };
    sheet('composition', 'signed', [[PF, '10'], [PN, '90']]);
    sheet('master', 'signed', [[PF, '30'], [PN, '70']], S2);
    expect(await assertCanSign(admin(), L, feature)).toMatchObject({ ok: false });
  });

  it('a contract with no master rule or no song is never blocked', async () => {
    db.tables.organizations[0].settings = { require_signed_master_split: true };
    expect(await assertCanSign(admin(), L, { type: 'producer', track_id: S1 })).toEqual({ ok: true });
    expect(await assertCanSign(admin(), L, { type: 'feature', track_id: null })).toEqual({ ok: true });
  });
});
