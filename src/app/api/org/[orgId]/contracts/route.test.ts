/**
 * /api/org/[orgId]/contracts, /contracts/[contractId] and /contract-templates
 * (LABEL-57), through the REAL org-access, contracts-store, contract rules and
 * activity writer against an in-memory database.
 *
 *   L: OWN (owner), LEG (legal, whole org), SC (legal, limited to Kilo),
 *      MKT (marketing: no contracts ability), ART (role artist, Nova),
 *      ART2 (role artist, Kilo). L2: X (owner).
 *   Contacts: C1 Nova, C2 Kilo (L), CX (L2). Parties: PL label, PN Nova's own
 *   (account ART), PX (L2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const LEG = u(2);
const SC = u(3);
const MKT = u(4);
const ART = u(5);
const ART2 = u(6);
const X = u(7);
const STRANGER = u(8);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const PL = '60000000-0000-4000-8000-000000000001';
const PN = '60000000-0000-4000-8000-000000000002';
const PX = '60000000-0000-4000-8000-000000000003';
const T1 = '50000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });

let seq = 0;
const contractRow = (over: Record<string, unknown>) => ({
  id: `70000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, org_id: L, type: 'recording', title: 'Row', status: 'draft', template_id: null,
  template_source: 'platform:recording@1', template_version: 1, clauses: [{ id: 'a', heading: 'H', body: 'Pay {{advance}} to {{party.artist}}' }],
  artist_contact_id: null, track_id: null, release_id: null, effective_date: null, term_months: null, territories: null, fields: {},
  internal_note: null, version: 1, created_by: OWN, voided_at: null, void_reason: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  current = null;
  seq = 0;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'), member(LEG, 'member', ['legal']), member(SC, 'member', ['legal'], 'artists'), member(MKT, 'member', ['marketing']),
        member(ART, 'artist', [], 'artists'), member(ART2, 'artist', [], 'artists'), member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }, { org_id: L, user_id: ART2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      tracks: [{ id: T1, org_id: L, user_id: null, type: 'song', title: 'Midnight', song_stage: 'inbox' }],
      parties: [
        { id: PL, org_id: L, display_name: 'Label L', legal_name: 'Label L Ltd', address: '1 Label Way', user_id: null },
        { id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: '2 Road', user_id: ART, tax_id: 'SECRET-TAX', payment_instructions: 'SECRET-PAY' },
        { id: PX, org_id: L2, display_name: 'Outsider', legal_name: null, address: null, user_id: null },
      ],
      contracts: [],
      contract_parties: [],
      contract_templates: [],
      activity_events: [],
      user_profiles: [],
    },
    rpc: {
      labelos_contract_save: (args, tables) => {
        const row = args.p_row as Record<string, unknown>;
        let target: Record<string, unknown> | undefined;
        if (args.p_id) {
          target = tables.contracts.find((c) => c.id === args.p_id && c.org_id === args.p_org);
          if (!target) return { data: null, error: { message: 'not_found' } };
          if (target.status !== 'draft') return { data: null, error: { message: 'not_draft' } };
          Object.assign(target, row);
        } else {
          target = contractRow({ ...row, org_id: args.p_org, created_by: args.p_actor });
          tables.contracts.push(target);
        }
        const parties = args.p_parties as { party_id: string; role: string; position: number }[] | null;
        if (parties) {
          tables.contract_parties = tables.contract_parties.filter((p) => p.contract_id !== target!.id);
          for (const p of parties) tables.contract_parties.push({ contract_id: target.id, org_id: args.p_org, ...p });
        }
        return { data: target.id, error: null };
      },
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: string, as: string | null, org: string, opts: { id?: string; body?: unknown; templates?: string } = {}) {
  current = as;
  let mod: Record<string, Handler>;
  let path: string;
  const params: Record<string, string> = { orgId: org };
  if (opts.templates !== undefined) {
    if (opts.templates) {
      mod = (await import('../contract-templates/[type]/route')) as unknown as Record<string, Handler>;
      params.type = opts.templates;
      path = `contract-templates/${opts.templates}`;
    } else {
      mod = (await import('../contract-templates/route')) as unknown as Record<string, Handler>;
      path = 'contract-templates';
    }
  } else if (opts.id) {
    mod = (await import('./[contractId]/route')) as unknown as Record<string, Handler>;
    params.contractId = opts.id;
    path = `contracts/${opts.id}`;
  } else {
    mod = (await import('./route')) as unknown as Record<string, Handler>;
    path = 'contracts';
  }
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/org/${org}/${path}`, init), { params: Promise.resolve(params) });
}
const titles = async (res: Response) => ((await res.json()).contracts as { title: string }[]).map((c) => c.title).sort();
const events = () => db.tables.activity_events;

function seedContracts() {
  db.tables.contracts.push(
    contractRow({ title: 'Nova sent', status: 'sent', artist_contact_id: C1, internal_note: 'chase them', fields: { advance: '5000' }, effective_date: '2027-01-01', term_months: 24, territories: ['WW'] }),
    contractRow({ title: 'Nova draft', status: 'draft', artist_contact_id: C1 }),
    contractRow({ title: 'Kilo sent', status: 'sent', artist_contact_id: C2 }),
    contractRow({ title: 'Vendor NDA', status: 'sent', type: 'nda', artist_contact_id: null }),
  );
  const nova = db.tables.contracts[0].id;
  db.tables.contract_parties.push({ contract_id: nova, org_id: L, party_id: PL, role: 'label', position: 0 }, { contract_id: nova, org_id: L, party_id: PN, role: 'artist', position: 1 });
}

describe('GET /contracts — who reads what', () => {
  beforeEach(seedContracts);

  it('contracts.read reads every contract of the org', async () => {
    for (const who of [OWN, LEG]) expect(await titles(await call('GET', who, L))).toEqual(['Kilo sent', 'Nova draft', 'Nova sent', 'Vendor NDA']);
  });

  it('a member limited to Kilo reads Kilo’s only — not Nova’s, not a contract with no artist', async () => {
    expect(await titles(await call('GET', SC, L))).toEqual(['Kilo sent']);
  });

  it('a roster artist reads only their own contract, once it left draft, without the internal note', async () => {
    const res = await call('GET', ART, L);
    expect(await titles(res.clone() as Response)).toEqual(['Nova sent']);
    const text = await res.text();
    expect(text).not.toContain('chase them');
    expect(text).not.toContain('SECRET-TAX');
    expect(await titles(await call('GET', ART2, L))).toEqual(['Kilo sent']);
  });

  it('marketing reads an empty list; strangers, another org’s owner and signed-out callers are refused', async () => {
    expect(await titles(await call('GET', MKT, L))).toEqual([]);
    expect((await call('GET', STRANGER, L)).status).toBe(403);
    expect((await call('GET', X, L)).status).toBe(403);
    expect((await call('GET', null, L)).status).toBe(401);
  });

  it('an org not licensed for contracts answers 404 to everyone', async () => {
    db.tables.org_entitlements = [{ org_id: L, modules: ['catalog'], max_seats: null, max_artists: null, setup_done: true }];
    expect((await call('GET', OWN, L)).status).toBe(404);
    expect((await call('GET', ART, L)).status).toBe(404);
  });

  it('the owner sees the internal note', async () => {
    const body = await (await call('GET', OWN, L)).json();
    expect(body.contracts.find((c: { title: string }) => c.title === 'Nova sent').internal_note).toBe('chase them');
  });
});

describe('GET /contracts/[id]', () => {
  beforeEach(seedContracts);

  it('returns the text with values merged and party names (legal name, never payee data)', async () => {
    const id = db.tables.contracts[0].id as string;
    const res = await call('GET', ART, L, { id });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('Pay 5000 to Nova Okafor');
    expect(text).not.toMatch(/SECRET-TAX|SECRET-PAY|chase them/);
  });

  it('is 404 for a draft the artist is named on, another artist’s contract, and another org', async () => {
    const [, draft, kilo] = db.tables.contracts.map((c) => c.id as string);
    expect((await call('GET', ART, L, { id: draft })).status).toBe(404);
    expect((await call('GET', ART, L, { id: kilo })).status).toBe(404);
    expect((await call('GET', X, L2, { id: kilo })).status).toBe(404);
    expect((await call('GET', X, L, { id: kilo })).status).toBe(403);
    expect((await call('GET', OWN, L, { id: 'nope' })).status).toBe(404);
  });
});

describe('POST /contracts', () => {
  const base = { type: 'recording', title: 'Nova recording', artist_contact_id: C1, parties: [{ party_id: PL, role: 'label' }, { party_id: PN, role: 'artist' }], fields: { advance: '2500.50', currency: 'USD' }, term_months: 24, territories: ['WW'] };

  it('starts a draft from the platform template and snapshots its clauses', async () => {
    const res = await call('POST', LEG, L, { body: base });
    expect(res.status).toBe(201);
    const row = db.tables.contracts[0];
    expect(row).toMatchObject({ status: 'draft', type: 'recording', template_source: 'platform:recording@1', template_id: null });
    expect((row.clauses as unknown[]).length).toBeGreaterThan(5);
    expect(db.tables.contract_parties).toHaveLength(2);
  });

  it('uses the org’s latest saved version, and a later edit does not rewrite the contract', async () => {
    const own = [{ id: 'x', heading: 'Ours', body: 'Our words {{advance}}' }];
    await call('PUT', OWN, L, { templates: 'recording', body: { name: 'Ours', clauses: own } });
    await call('POST', LEG, L, { body: base });
    expect(db.tables.contracts[0]).toMatchObject({ template_source: 'org:1', template_version: 1 });
    expect(db.tables.contracts[0].clauses).toEqual(own);
    await call('PUT', OWN, L, { templates: 'recording', body: { name: 'Ours', clauses: [{ id: 'x', heading: 'Ours', body: 'Changed words' }] } });
    expect(db.tables.contracts[0].clauses).toEqual(own);
    await call('POST', LEG, L, { body: { ...base, title: 'Platform again', source: 'platform' } });
    expect(db.tables.contracts[1].template_source).toBe('platform:recording@1');
  });

  it('records an event that names fields and kinds, never wording or amounts', async () => {
    await call('POST', LEG, L, { body: base });
    const ev = events().find((e) => e.verb === 'contract.created')!;
    expect(ev.visibility).toBe('internal');
    expect(ev.payload).toMatchObject({ type: 'recording', fields: ['advance', 'currency'], party_roles: ['label', 'artist'] });
    expect(JSON.stringify(ev.payload)).not.toMatch(/2500|Nova recording/);
  });

  it('refuses the wrong people', async () => {
    for (const who of [MKT, ART, STRANGER, X]) expect((await call('POST', who, L, { body: base })).status).toBe(403);
    expect((await call('POST', null, L, { body: base })).status).toBe(401);
    expect(db.tables.contracts).toHaveLength(0);
  });

  it('a writer limited to Kilo cannot start a contract for Nova, or one with no artist', async () => {
    expect((await call('POST', SC, L, { body: base })).status).toBe(403);
    expect((await call('POST', SC, L, { body: { ...base, artist_contact_id: undefined } })).status).toBe(403);
    expect((await call('POST', SC, L, { body: { ...base, artist_contact_id: C2 } })).status).toBe(201);
  });

  it('validates fields, party roles and org membership of everything linked', async () => {
    expect((await call('POST', LEG, L, { body: { ...base, fields: { advance: '12.345' } } })).status).toBe(400);
    expect((await call('POST', LEG, L, { body: { ...base, fields: { tax_id: 'x' } } })).status).toBe(400);
    expect((await call('POST', LEG, L, { body: { ...base, parties: [{ party_id: PL, role: 'publisher' }] } })).status).toBe(400);
    expect((await call('POST', LEG, L, { body: { ...base, parties: [{ party_id: PL, role: 'label' }, { party_id: PN, role: 'label' }] } })).status).toBe(400);
    expect((await call('POST', LEG, L, { body: { ...base, parties: [{ party_id: PX, role: 'label' }] } })).status).toBe(404);
    expect((await call('POST', LEG, L, { body: { ...base, artist_contact_id: CX } })).status).toBe(404);
    expect((await call('POST', LEG, L, { body: { ...base, territories: ['England'] } })).status).toBe(400);
    expect((await call('POST', LEG, L, { body: { ...base, type: 'nope' } })).status).toBe(400);
    expect(db.tables.contracts).toHaveLength(0);
  });

  it('answers 503 naming 176 when the migration is missing', async () => {
    db.rpc = { labelos_contract_save: () => ({ data: null, error: { message: 'function not found', code: 'PGRST202' } }) };
    const res = await call('POST', LEG, L, { body: base });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('176');
  });
});

describe('PATCH /contracts/[id]', () => {
  beforeEach(seedContracts);
  const [sentId, draftId] = [() => db.tables.contracts[0].id as string, () => db.tables.contracts[1].id as string];

  it('edits a draft and records which fields changed', async () => {
    const res = await call('PATCH', LEG, L, { id: draftId(), body: { title: 'Renamed', fields: { royalty_rate: '18.5' }, internal_note: 'hush' } });
    expect(res.status).toBe(200);
    expect(db.tables.contracts[1]).toMatchObject({ title: 'Renamed', fields: { royalty_rate: '18.5' } });
    const ev = events().find((e) => e.verb === 'contract.updated')!;
    expect(ev.payload).toEqual({ changed: ['title', 'internal_note', 'fields'] });
  });

  it('refuses to edit a contract past draft (409), and bad values (400)', async () => {
    expect((await call('PATCH', LEG, L, { id: sentId(), body: { title: 'x' } })).status).toBe(409);
    expect((await call('PATCH', LEG, L, { id: draftId(), body: { fields: { advance: 'lots' } } })).status).toBe(400);
    expect((await call('PATCH', LEG, L, { id: draftId(), body: {} })).status).toBe(400);
  });

  it('voids once, with an event, and refuses a second void', async () => {
    const res = await call('PATCH', LEG, L, { id: sentId(), body: { status: 'void', void_reason: 'replaced' } });
    expect(res.status).toBe(200);
    expect(db.tables.contracts[0]).toMatchObject({ status: 'void', void_reason: 'replaced' });
    expect(events().find((e) => e.verb === 'contract.voided')!.payload).toEqual({ from: 'sent', with_reason: true });
    expect((await call('PATCH', LEG, L, { id: sentId(), body: { status: 'void' } })).status).toBe(409);
    expect((await call('PATCH', LEG, L, { id: draftId(), body: { status: 'void', title: 'x' } })).status).toBe(400);
  });

  it('a roster artist, marketing, and a writer outside the contract’s artist cannot', async () => {
    expect((await call('PATCH', ART, L, { id: draftId(), body: { title: 'x' } })).status).toBe(403);
    expect((await call('PATCH', MKT, L, { id: draftId(), body: { title: 'x' } })).status).toBe(403);
    expect((await call('PATCH', SC, L, { id: draftId(), body: { title: 'x' } })).status).toBe(404);
  });
});

describe('templates', () => {
  it('lists all 14 platform templates for contracts.read, nobody else', async () => {
    const body = await (await call('GET', LEG, L, { templates: '' })).json();
    expect(body.platform).toHaveLength(14);
    expect(body.canWrite).toBe(true);
    expect((await call('GET', MKT, L, { templates: '' })).status).toBe(403);
    expect((await call('GET', ART, L, { templates: '' })).status).toBe(403);
  });

  it('saves versions 1 and 2, skips a no-op, and never carries wording into the event', async () => {
    const v1 = [{ id: 'a', heading: 'One', body: 'Secret wording {{advance}}' }];
    expect((await call('PUT', OWN, L, { templates: 'nda', body: { name: 'Our NDA', clauses: v1 } })).status).toBe(201);
    expect((await call('PUT', OWN, L, { templates: 'nda', body: { name: 'Our NDA', clauses: v1 } })).status).toBe(200);
    expect(db.tables.contract_templates).toHaveLength(1);
    expect((await call('PUT', OWN, L, { templates: 'nda', body: { name: 'Our NDA', clauses: [{ id: 'a', heading: 'One', body: 'New wording' }] } })).status).toBe(201);
    expect(db.tables.contract_templates.map((t) => t.version)).toEqual([1, 2]);
    expect(db.tables.contract_templates[1].based_on).toBe('org:1');
    expect(db.tables.contract_templates[0].based_on).toBe('platform:nda@1');
    const evs = events().filter((e) => e.verb === 'contract_template.saved');
    expect(evs).toHaveLength(2);
    expect(JSON.stringify(evs.map((e) => e.payload))).not.toMatch(/wording/);
    expect(evs[1].payload).toMatchObject({ changed_clauses: ['a'], version: 2 });
  });

  it('refuses unknown merge fields, unknown types and non-writers', async () => {
    expect((await call('PUT', OWN, L, { templates: 'nda', body: { name: 'x', clauses: [{ heading: 'a', body: '{{party.label.tax_id}}' }] } })).status).toBe(400);
    expect((await call('PUT', OWN, L, { templates: 'nope', body: { name: 'x', clauses: [{ heading: 'a', body: 'b' }] } })).status).toBe(404);
    expect((await call('PUT', MKT, L, { templates: 'nda', body: { name: 'x', clauses: [{ heading: 'a', body: 'b' }] } })).status).toBe(403);
    expect((await call('PUT', ART, L, { templates: 'nda', body: { name: 'x', clauses: [{ heading: 'a', body: 'b' }] } })).status).toBe(403);
  });
});
