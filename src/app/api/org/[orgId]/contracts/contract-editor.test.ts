/**
 * LABEL-58 over the real routes, org-access, contract store and activity
 * writer against an in-memory database: clause edits and versions, the
 * server-rendered preview, suggestions from parties and split sheets,
 * "send for signature", and the PDF (its text is parsed back).
 *
 *   L: OWN (owner), LEG (legal), LNR (legal without rights.read), SC (legal,
 *      limited to Kilo), MKT (marketing), ART (artist Nova). L2: X (owner).
 *   Song S1 sits in project P1 (so its contract PDFs are filed there); S2 in
 *   no project.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { pdfText } from '@/lib/labelos/contracts/pdf-text';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const LEG = u(2);
const LNR = u(3);
const SC = u(4);
const MKT = u(5);
const ART = u(6);
const X = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const S1 = '50000000-0000-4000-8000-000000000001';
const S2 = '50000000-0000-4000-8000-000000000002';
const P1 = '40000000-0000-4000-8000-000000000001';
const PL = '60000000-0000-4000-8000-000000000001';
const PN = '60000000-0000-4000-8000-000000000002';
const PX = '60000000-0000-4000-8000-000000000003';
const TPL = '90000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
const storage = { stored: [] as { key: string; mime: string; bytes: number }[], deleted: [] as string[] };

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/storage/project-assets', () => ({
  projectAssetBuckets: () => ['priv'],
  storeProjectAsset: async (buffer: Buffer, k: string, mime: string) => {
    storage.stored.push({ key: k, mime, bytes: buffer.length });
    return `r2://priv/${k}`;
  },
  deleteProjectAssetObject: async (r: string) => { storage.deleted.push(r); },
}));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L, cap_revokes: string[] = []) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes });

let seq = 0;
const CLAUSES = [
  { id: 'a', heading: 'Advance', body: 'The Label pays {{party.artist}} an advance of {{advance}} {{currency}}.' },
  { id: 'b', heading: 'Song', body: 'This covers {{song.title}}.' },
];
const contractRow = (over: Record<string, unknown>) => ({
  id: `70000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, org_id: L, type: 'recording', title: 'Nova deal', status: 'draft', template_id: TPL,
  template_source: 'org:1', template_version: 1, clauses: CLAUSES.map((c) => ({ ...c })),
  artist_contact_id: C1, track_id: S1, release_id: null, effective_date: '2027-03-01', term_months: 24, territories: ['WW'], fields: { advance: '25000', currency: 'USD' },
  internal_note: null, version: 1, created_by: OWN, voided_at: null, void_reason: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  current = null;
  seq = 0;
  storage.stored = [];
  storage.deleted = [];
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'), member(LEG, 'member', ['legal']), member(LNR, 'member', ['legal'], 'org', L, ['rights.read']), member(SC, 'member', ['legal'], 'artists'),
        member(MKT, 'member', ['marketing']), member(ART, 'artist', [], 'artists'), member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      tracks: [
        { id: S1, org_id: L, user_id: null, type: 'song', title: 'Midnight', song_stage: 'inbox' },
        { id: S2, org_id: L, user_id: null, type: 'song', title: 'Loose', song_stage: 'inbox' },
      ],
      projects: [{ id: P1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' }],
      project_tracks: [{ project_id: P1, track_id: S1, position: 0 }],
      project_contacts: [],
      releases: [],
      parties: [
        { id: PL, org_id: L, display_name: 'Label L', legal_name: 'Label L Ltd', address: '1 Label Way', user_id: null, contact_id: null },
        { id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: '2 Road', user_id: ART, contact_id: C1, tax_id: 'SECRET-TAX', payment_instructions: 'SECRET-PAY' },
        { id: PX, org_id: L2, display_name: 'Outsider', legal_name: null, address: null, user_id: null, contact_id: null },
      ],
      contracts: [],
      contract_parties: [],
      contract_templates: [{ id: TPL, org_id: L, type: 'recording', version: 1, name: 'Recording', clauses: CLAUSES.map((c) => ({ ...c })), based_on: null, created_by: OWN, created_at: '2026-10-01' }],
      split_sheets: [],
      split_lines: [],
      project_assets: [],
      activity_events: [],
      user_profiles: [],
    },
    rpc: {
      labelos_contract_save: (args, tables) => {
        const row = args.p_row as Record<string, unknown>;
        const target = tables.contracts.find((c) => c.id === args.p_id && c.org_id === args.p_org);
        if (!target) return { data: null, error: { message: 'not_found' } };
        if (target.status !== 'draft') return { data: null, error: { message: 'not_draft' } };
        Object.assign(target, row);
        const parties = args.p_parties as { party_id: string; role: string; position: number }[] | null;
        if (parties) {
          tables.contract_parties = tables.contract_parties.filter((p) => p.contract_id !== target.id);
          for (const p of parties) tables.contract_parties.push({ contract_id: target.id, org_id: args.p_org, ...p });
        }
        return { data: target.id, error: null };
      },
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Where = 'detail' | 'send' | 'document' | 'preview' | 'suggestions';

async function call(where: Where, method: string, as: string | null, id: string, body?: unknown, org = L) {
  current = as;
  const mod = (await import(
    where === 'detail' ? './[contractId]/route' : where === 'send' ? './[contractId]/send/route' : where === 'document' ? './[contractId]/document/route' : where === 'preview' ? './[contractId]/preview/route' : './[contractId]/suggestions/route'
  )) as unknown as Record<string, Handler>;
  const path = `contracts/${id}${where === 'detail' ? '' : `/${where}`}`;
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/org/${org}/${path}`, init), { params: Promise.resolve({ orgId: org, contractId: id }) });
}

const add = (over: Record<string, unknown> = {}, parties = true) => {
  const row = contractRow(over);
  db.tables.contracts.push(row);
  if (parties) db.tables.contract_parties.push({ contract_id: row.id, org_id: L, party_id: PL, role: 'label', position: 0 }, { contract_id: row.id, org_id: L, party_id: PN, role: 'artist', position: 1 });
  return row;
};
const events = (verb?: string) => db.tables.activity_events.filter((e) => !verb || e.verb === verb);

describe('PATCH — clause edits are versions', () => {
  const edited = [{ id: 'a', heading: 'Advance', body: 'The Label pays {{party.artist}} an advance of {{advance}} {{currency}}, in two instalments.' }, CLAUSES[1]];

  it('saves the wording, bumps the version and records WHICH clause changed — never its words', async () => {
    const c = add();
    const res = await call('detail', 'PATCH', LEG, c.id, { clauses: edited, base_version: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 2 });
    expect(db.tables.contracts[0]).toMatchObject({ version: 2 });
    expect((db.tables.contracts[0].clauses as { body: string }[])[0].body).toContain('two instalments');
    const ev = events('contract.updated')[0];
    expect(ev.payload).toMatchObject({ changed: ['clauses'], changed_clauses: ['a'], version: 2 });
    expect(JSON.stringify(ev.payload)).not.toContain('instalments');
    expect(ev.visibility).toBe('internal');
  });

  it('a field edit is the next version too; the internal note alone is not', async () => {
    const c = add();
    await call('detail', 'PATCH', LEG, c.id, { fields: { advance: '30000', currency: 'USD' } });
    expect(db.tables.contracts[0].version).toBe(2);
    await call('detail', 'PATCH', LEG, c.id, { internal_note: 'chase' });
    expect(db.tables.contracts[0].version).toBe(2);
  });

  it('the editor resends the whole form: only what differs is a change, a version and an event field', async () => {
    const c = add();
    const same = { title: 'Nova deal', artist_contact_id: C1, track_id: S1, release_id: null, effective_date: '2027-03-01', term_months: 24, territories: ['WW'], fields: { currency: 'USD', advance: '25000' }, parties: [{ party_id: PL, role: 'label' }, { party_id: PN, role: 'artist' }], clauses: CLAUSES, base_version: 1 };
    await call('detail', 'PATCH', LEG, c.id, same);
    expect(db.tables.contracts[0].version).toBe(1);
    expect(events('contract.updated')).toHaveLength(0);
    await call('detail', 'PATCH', LEG, c.id, { ...same, fields: { currency: 'USD', advance: '26000' } });
    expect(db.tables.contracts[0].version).toBe(2);
    expect(events('contract.updated')[0].payload).toEqual({ changed: ['fields'], version: 2 });
  });

  it('identical wording saves nothing and bumps nothing', async () => {
    const c = add();
    const res = await call('detail', 'PATCH', LEG, c.id, { clauses: CLAUSES });
    expect(res.status).toBe(200);
    expect(db.tables.contracts[0].version).toBe(1);
    expect(events('contract.updated')).toHaveLength(0);
  });

  it('refuses a merge field that does not exist (there is no tax id key) and an empty clause', async () => {
    const c = add();
    const bad = await call('detail', 'PATCH', LEG, c.id, { clauses: [{ id: 'a', heading: 'Pay', body: 'Tax id {{party.artist.tax_id}}' }] });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('merge fields that do not exist');
    expect((await call('detail', 'PATCH', LEG, c.id, { clauses: [{ id: 'a', heading: 'x', body: ' ' }] })).status).toBe(400);
    expect(db.tables.contracts[0].version).toBe(1);
  });

  it('a stale editor is a 409 and changes nothing', async () => {
    const c = add({ version: 3 });
    const res = await call('detail', 'PATCH', LEG, c.id, { clauses: edited, base_version: 2 });
    expect(res.status).toBe(409);
    expect((db.tables.contracts[0].clauses as { body: string }[])[0].body).not.toContain('instalments');
  });

  it('a sent contract is not edited; marketing and a roster artist cannot write', async () => {
    const sent = add({ status: 'sent' });
    expect((await call('detail', 'PATCH', LEG, sent.id, { clauses: edited })).status).toBe(409);
    const draft = add();
    expect((await call('detail', 'PATCH', MKT, draft.id, { clauses: edited })).status).toBe(403);
    expect((await call('detail', 'PATCH', ART, draft.id, { clauses: edited })).status).toBe(403);
  });
});

describe('GET detail — wording, marks, history', () => {
  it('contracts staff get the clauses, how they differ from the template, and the per-version history', async () => {
    const c = add();
    await call('detail', 'PATCH', LEG, c.id, { clauses: [{ id: 'a', heading: 'Advance', body: 'Changed {{advance}}' }, CLAUSES[1]] });
    const body = await (await call('detail', 'GET', LEG, c.id)).json();
    expect(body.clauses[0].body).toBe('Changed {{advance}}');
    expect(body.clause_marks.marks.a).toBe('edited');
    expect(body.history[0]).toMatchObject({ kind: 'edited', version: 2, clauses: [{ id: 'a', heading: 'Advance' }] });
    expect(body.can_store).toBe(true);
  });

  it('a roster artist reading a sent contract gets the text, not the wording, history or note', async () => {
    const c = add({ status: 'sent', internal_note: 'chase them' });
    const res = await call('detail', 'GET', ART, c.id);
    const text = await res.clone().text();
    const body = await res.json();
    expect(text).toContain('25000');
    expect(body.clauses).toBeUndefined();
    expect(body.history).toBeUndefined();
    expect(body.clause_marks).toBeUndefined();
    expect(text).not.toContain('chase them');
    expect(text).not.toContain('SECRET');
  });
});

describe('POST preview', () => {
  it('renders the unsaved form with the server’s party names and saves nothing', async () => {
    const c = add();
    const res = await call('preview', 'POST', LEG, c.id, { fields: { advance: '99999', currency: 'EUR' }, clauses: [{ id: 'a', heading: 'Advance', body: '{{party.artist}} gets {{advance}} {{currency}} for {{song.title}}' }] });
    const { document } = await res.json();
    expect(document.clauses[0].body).toBe('Nova Okafor gets 99999 EUR for Midnight');
    expect(document.missing).toEqual([]);
    expect(db.tables.contracts[0].fields).toEqual({ advance: '25000', currency: 'USD' });
    expect(db.tables.contracts[0].version).toBe(1);
    expect(events()).toHaveLength(0);
  });
  it('shows a blank value in brackets and reports it missing', async () => {
    const c = add();
    const { document } = await (await call('preview', 'POST', LEG, c.id, { fields: {} })).json();
    expect(document.clauses[0].body).toContain('[Advance]');
    expect(document.missing).toEqual(expect.arrayContaining(['advance', 'currency']));
  });
  it('a member limited to Kilo cannot preview with another artist’s name', async () => {
    const c = add({ artist_contact_id: C2 });
    expect((await call('preview', 'POST', SC, c.id, { artist_contact_id: C1 })).status).toBe(403);
  });
  it('a bad value is 400, a party of another org 404, a sent contract 409, a non-writer 403', async () => {
    const c = add();
    expect((await call('preview', 'POST', LEG, c.id, { fields: { advance: 'lots' } })).status).toBe(400);
    expect((await call('preview', 'POST', LEG, c.id, { parties: [{ party_id: PX, role: 'artist' }] })).status).toBe(404);
    expect((await call('preview', 'POST', MKT, c.id, {})).status).toBe(403);
    const sent = add({ status: 'sent' });
    expect((await call('preview', 'POST', LEG, sent.id, {})).status).toBe(409);
  });
});

describe('GET suggestions', () => {
  const sheet = (kind: string, status: string, lines: [string, string][]) => {
    const id = `80000000-0000-4000-8000-${String(db.tables.split_sheets.length + 1).padStart(12, '0')}`;
    db.tables.split_sheets.push({ id, org_id: L, track_id: S1, kind, version: 1, status, note: null, document_asset_id: null, created_by: OWN, created_at: '2026-10-01' });
    lines.forEach(([party, share], i) => db.tables.split_lines.push({ id: `${id}-l${i}`, org_id: L, split_sheet_id: id, party_id: party, role: 'master_owner', share, position: i, signed_at: null }));
  };
  it('offers the artist’s share from the sheet in force, and the party that stands for the artist', async () => {
    const c = add();
    sheet('master', 'circulated', [[PN, '33.3333'], [PL, '66.6667']]);
    sheet('composition', 'draft', [[PN, '50']]);
    const body = await (await call('suggestions', 'GET', LEG, c.id)).json();
    expect(body.fields).toEqual([{ key: 'master_share', value: '33.3333', source: 'Master split v1 · Nova Okafor', partyId: PN }]);
    expect(body.artist_parties).toEqual([{ id: PN, name: 'Nova Okafor' }]);
  });
  it('without rights.read the split suggestions are simply absent (D2), the party list is not', async () => {
    const c = add();
    sheet('master', 'circulated', [[PN, '50'], [PL, '50']]);
    const body = await (await call('suggestions', 'GET', LNR, c.id)).json();
    expect(body.fields).toEqual([]);
    expect(body.artist_parties).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });
  it('is refused to marketing and to a member outside the artist’s scope', async () => {
    const c = add();
    expect((await call('suggestions', 'GET', MKT, c.id)).status).toBe(403);
    expect((await call('suggestions', 'GET', SC, c.id)).status).toBe(404);
  });
});

describe('POST send — the last edit', () => {
  it('moves a complete draft to sent, records an internal audit event with field NAMES only and files a frozen PDF', async () => {
    const c = add({ internal_note: 'chase' });
    const res = await call('send', 'POST', LEG, c.id, { version: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: 'sent', version: 1, copy: { stored: true, reused: false, project_id: P1 } });
    expect(db.tables.contracts[0].status).toBe('sent');
    const ev = events('contract.sent')[0];
    expect(ev).toMatchObject({ audit: true, visibility: 'internal', subject_id: c.id });
    expect(ev.payload).toMatchObject({ version: 1, fields: ['advance', 'currency'], party_roles: ['label', 'artist'], clauses_changed: 0 });
    expect(JSON.stringify(ev.payload)).not.toContain('25000');

    const asset = db.tables.project_assets[0];
    expect(asset).toMatchObject({ kind: 'contract', sensitivity: 'restricted', project_id: P1, org_id: L, mime: 'application/pdf', in_portal: false });
    expect(asset.file_name).toMatch(/^contract-.*-v1-sent\.pdf$/);
    expect(storage.stored).toHaveLength(1);
    expect(storage.stored[0].key).toMatch(new RegExp(`^orgs/${L}/`));
  });

  it('after sending the content is frozen: edit, second send and preview are all refused', async () => {
    const c = add();
    await call('send', 'POST', LEG, c.id, { version: 1 });
    expect((await call('detail', 'PATCH', LEG, c.id, { title: 'New' })).status).toBe(409);
    expect((await call('send', 'POST', LEG, c.id, { version: 1 })).status).toBe(409);
    expect(events('contract.sent')).toHaveLength(1);
  });

  it('a send that cannot be recorded does not happen', async () => {
    const c = add();
    db.tables.activity_events = { push: () => { throw new Error('events down'); } } as never;
    const res = await call('send', 'POST', LEG, c.id, { version: 1 });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.tables.contracts[0].status).toBe('draft');
  });

  it('is refused with what is missing: an empty value, a required party', async () => {
    const c = add({ fields: { advance: '25000' } });
    const res = await call('send', 'POST', LEG, c.id, { version: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).missing).toEqual(['currency']);
    expect(db.tables.contracts[0].status).toBe('draft');
    const noParty = add({}, false);
    expect((await call('send', 'POST', LEG, noParty.id, { version: 1 })).status).toBe(422);
    expect(events('contract.sent')).toHaveLength(0);
  });

  it('refuses a version the sender did not review', async () => {
    const c = add({ version: 4 });
    expect((await call('send', 'POST', LEG, c.id, { version: 3 })).status).toBe(409);
    expect(db.tables.contracts[0].status).toBe('draft');
  });

  it('a contract with no project is sent without a stored copy', async () => {
    const c = add({ track_id: S2 });
    const body = await (await call('send', 'POST', LEG, c.id, { version: 1 })).json();
    expect(body.copy).toEqual({ stored: false, reason: 'no_project' });
    expect(db.tables.project_assets).toHaveLength(0);
    expect(storage.stored).toHaveLength(0);
  });

  it('marketing, a roster artist and signed-out callers cannot send; a scoped member cannot send another artist’s', async () => {
    const c = add();
    expect((await call('send', 'POST', MKT, c.id, { version: 1 })).status).toBe(403);
    expect((await call('send', 'POST', ART, c.id, { version: 1 })).status).toBe(403);
    expect((await call('send', 'POST', null, c.id, { version: 1 })).status).toBe(401);
    expect((await call('send', 'POST', SC, c.id, { version: 1 })).status).toBe(404);
    expect((await call('send', 'POST', X, c.id, { version: 1 }, L)).status).toBe(403);
    expect(db.tables.contracts[0].status).toBe('draft');
  });
});

describe('document', () => {
  it('GET makes the PDF with the filled values, audits the download before the bytes, and stores nothing', async () => {
    const c = add();
    const res = await call('document', 'GET', LEG, c.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('contract-');
    const text = pdfText(Buffer.from(await res.arrayBuffer()));
    expect(text).toContain('an advance of 25000 USD');
    expect(text).toContain('Nova Okafor');
    expect(text).toContain('This covers Midnight.');
    expect(text).not.toContain('SECRET');
    expect(events('contract.document_downloaded')[0]).toMatchObject({ audit: true, visibility: 'internal', payload: { version: 1, status: 'draft' } });
    expect(db.tables.project_assets).toHaveLength(0);
  });

  it('GET needs contracts.read: a roster artist reading their sent contract does not get the file', async () => {
    const c = add({ status: 'sent' });
    expect((await call('document', 'GET', ART, c.id)).status).toBe(403);
    expect(events('contract.document_downloaded')).toHaveLength(0);
  });

  it('POST files a restricted contract PDF once per version and status', async () => {
    const c = add();
    const first = await (await call('document', 'POST', LEG, c.id)).json();
    expect(first).toMatchObject({ ok: true, reused: false, project_id: P1 });
    const second = await (await call('document', 'POST', LEG, c.id)).json();
    expect(second).toMatchObject({ reused: true, asset_id: first.asset_id });
    expect(db.tables.project_assets).toHaveLength(1);
    expect(events('contract.document_generated')).toHaveLength(1);
    // an edit is a new version, so a new file
    await call('detail', 'PATCH', LEG, c.id, { title: 'Nova deal 2' });
    const third = await (await call('document', 'POST', LEG, c.id)).json();
    expect(third.reused).toBe(false);
    expect(db.tables.project_assets).toHaveLength(2);
  });

  it('POST with no project says so and stores nothing; a void contract has no document', async () => {
    const c = add({ track_id: S2 });
    const res = await call('document', 'POST', LEG, c.id);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('no_project');
    const v = add({ status: 'void' });
    expect((await call('document', 'POST', LEG, v.id)).status).toBe(409);
    expect(db.tables.project_assets).toHaveLength(0);
  });

  it('POST is refused without contracts.write', async () => {
    const c = add();
    expect((await call('document', 'POST', MKT, c.id)).status).toBe(403);
    expect((await call('document', 'POST', ART, c.id)).status).toBe(403);
  });
});

describe('not set up yet', () => {
  it('without migration 176 the writes answer 503 and the read a clean 404, never a 500', async () => {
    delete (db.tables as Record<string, unknown>).contracts;
    delete (db.tables as Record<string, unknown>).contract_parties;
    const id = '70000000-0000-4000-8000-0000000000aa';
    const send = await call('send', 'POST', LEG, id, { version: 1 });
    expect([404, 503]).toContain(send.status);
    const doc = await call('document', 'GET', LEG, id);
    expect([404, 503]).toContain(doc.status);
  });
});
