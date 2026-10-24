/**
 * /api/org/[orgId]/parties and /parties/[partyId] (LABEL-27), through the
 * REAL lib/auth/org-access, credits-store, parties and activity against an
 * in-memory database.
 *
 *   L: members OWN (owner → rights.write), AR (A&R → rights.read),
 *      SC (A&R scoped to Kilo), PRD (producer function → own line),
 *      MKT (marketing → none). ACCT is an account in the org's project only.
 *   Parties: PN (Nova, on song S1 of Nova's project), PK (Kilo's collaborator,
 *   credited on S2 in Kilo's Inbox), PP (PRD's own), PU (credited nowhere).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const SC = u(3);
const PRD = u(4);
const MKT = u(5);
const ACCT = u(6);
const STRANGER = u(7);
const X = u(8);
const ART = u(9);
const FIN = u(10);
const LEG = u(11);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const p = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PN = p(1);
const PK = p(2);
const PP = p(3);
const PU = p(4);

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const party = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, org_id: L, kind: 'person', display_name: name, legal_name: `${name} Legal`, email: null, ipi: '00123456789', isni: null, pro: null,
  pro_affiliation: 'unknown', publisher_name: null, publisher_ipi: null, contact_id: null, user_id: null, created_at: '2026-10-01', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'), member(AR, 'member', ['a_and_r']), member(SC, 'member', ['a_and_r'], 'artists'),
        member(PRD, 'member', ['producer']), member(MKT, 'member', ['marketing']), member(X, 'owner', [], 'org', L2),
        member(ART, 'artist', [], 'artists'), member(FIN, 'member', ['finance']), member(LEG, 'member', ['legal']),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      project_members: [{ org_id: L, project_id: LP1, user_id: ACCT, role: 'contributor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [{ project_id: LP1, track_id: S1, position: 0 }, { project_id: LP2, track_id: S2, position: 0 }],
      tracks: [
        { id: S1, org_id: L, user_id: null, type: 'song', title: 'Midnight', song_stage: 'inbox' },
        { id: S2, org_id: L, user_id: null, type: 'song', title: 'Dawn', song_stage: 'inbox' },
      ],
      parties: [
        party(PN, 'Nova', { address: '2 road Y', country: 'GB', tax_id: 'GB-TAX-2', payment_instructions: 'Invoice monthly' }),
        party(PK, 'Kilo Collab'),
        party(PP, 'Pierre', { user_id: PRD, address: '1 rue X', country: 'FR', tax_id: 'FR-TAX-1', payment_instructions: 'PayPal, ask finance' }),
        party(PU, 'Unused'),
      ],
      track_collaborators: [
        { id: 'c-1', track_id: S1, org_id: L, name: 'Nova', role: 'songwriter', party_id: PN, status: 'confirmed' },
        { id: 'c-2', track_id: S2, org_id: L, name: 'Kilo Collab', role: 'mixer', party_id: PK, status: 'proposed' },
        { id: 'c-3', track_id: S2, org_id: L, name: 'Pierre', role: 'producer', party_id: PP, status: 'proposed' },
      ],
      activity_events: [],
      user_profiles: [],
    },
    unique: { parties: [['org_id', 'user_id']] },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: string, as: string | null, org: string, partyId?: string, body?: unknown) {
  current = as;
  const mod = (partyId ? await import('./[partyId]/route') : await import('./route')) as unknown as Record<string, Handler>;
  const url = `https://app.test/api/org/${org}/parties${partyId ? `/${partyId}` : ''}`;
  const init = method === 'GET' || method === 'DELETE' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(url, init), { params: Promise.resolve({ orgId: org, ...(partyId ? { partyId } : {}) }) });
}
const events = () => db.tables.activity_events;
const names = async (res: Response) => ((await res.json()).parties as { displayName: string }[]).map((x) => x.displayName).sort();

describe('GET /parties — who reads the directory', () => {
  it('rights.read reads every party, with legal data', async () => {
    for (const who of [OWN, AR]) {
      const res = await call('GET', who, L);
      const body = await res.json();
      expect(body.parties.map((x: { displayName: string }) => x.displayName).sort()).toEqual(['Kilo Collab', 'Nova', 'Pierre', 'Unused']);
      expect(body.parties[0].legal).toMatchObject({ ipi: '00123456789' });
    }
  });

  it('a member limited to some artists reads only the parties credited on songs of their scope (06 §3)', async () => {
    expect(await names(await call('GET', SC, L))).toEqual(['Kilo Collab', 'Pierre']);
  });

  it('an own line reads only its own party; marketing and strangers are refused', async () => {
    expect(await names(await call('GET', PRD, L))).toEqual(['Pierre']);
    expect((await call('GET', MKT, L)).status).toBe(403);
    // An org-level route answers a non-member 403 (requireOrgCapability); nothing of the org leaks.
    expect((await call('GET', STRANGER, L)).status).toBe(403);
    expect((await call('GET', X, L)).status).toBe(403);
    expect((await call('GET', null, L)).status).toBe(401);
  });

  it('GET one: the same visibility, 404 for a party the caller may not read', async () => {
    expect((await call('GET', AR, L, PN)).status).toBe(200);
    expect((await call('GET', PRD, L, PP)).status).toBe(200);
    expect((await call('GET', PRD, L, PN)).status).toBe(404);
    expect((await call('GET', SC, L, PN)).status).toBe(404);
    expect((await call('GET', SC, L, PK)).status).toBe(200);
    expect((await call('GET', OWN, L, 'nope')).status).toBe(404);
  });
});

describe('POST /parties', () => {
  it('needs rights.write', async () => {
    for (const who of [AR, SC, PRD, MKT]) expect((await call('POST', who, L, undefined, { display_name: 'Z' })).status).toBe(403);
    expect((await call('POST', STRANGER, L, undefined, { display_name: 'Z' })).status).toBe(403);
    expect(db.tables.parties).toHaveLength(4);
  });

  it('creates a party with the legal identifiers NORMALISED, and records party.created without legal data', async () => {
    const res = await call('POST', OWN, L, undefined, {
      display_name: ' Odile  Writer ', legal_name: 'Odile Writer-Smith', ipi: '00 123.456-789', isni: '0000 0001 2103 000x', pro: 'SACEM', pro_affiliation: 'affiliated', email: 'Odile@X.test', contact_id: C1,
    });
    expect(res.status).toBe(201);
    const { party: created } = await res.json();
    expect(created).toMatchObject({ displayName: 'Odile Writer', kind: 'person', contactId: C1 });
    expect(created.legal).toMatchObject({ legalName: 'Odile Writer-Smith', ipi: '00123456789', isni: '000000012103000X', proAffiliation: 'affiliated', email: 'odile@x.test' });
    const stored = db.tables.parties.find((r) => r.id === created.id)!;
    expect(stored).toMatchObject({ org_id: L, created_by: OWN, ipi: '00123456789' });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ verb: 'party.created', actor_id: OWN, org_id: L, visibility: 'internal', subject_type: 'party', subject_id: created.id });
    expect(JSON.stringify(events()[0])).not.toContain('00123456789');
    expect(JSON.stringify(events()[0])).not.toContain('Writer-Smith');
  });

  it('refuses an IPI or ISNI that cannot be real (400), a foreign contact (404), a stranger’s account (400), bad bodies (400)', async () => {
    expect((await call('POST', OWN, L, undefined, { display_name: 'Z', ipi: '12ab' })).status).toBe(400);
    expect((await call('POST', OWN, L, undefined, { display_name: 'Z', isni: '1' })).status).toBe(400);
    expect((await call('POST', OWN, L, undefined, { display_name: 'Z', contact_id: CX })).status).toBe(404);
    expect((await call('POST', OWN, L, undefined, { display_name: 'Z', user_id: STRANGER })).status).toBe(400);
    expect((await call('POST', OWN, L, undefined, {})).status).toBe(400);
    expect((await call('POST', OWN, L, undefined, { display_name: 'Z', org_id: L2 })).status).toBe(400);
    expect(db.tables.parties).toHaveLength(4);
    expect(events()).toEqual([]);
  });

  it('links an account that is an org member or an external project member; one party per account (409)', async () => {
    expect((await call('POST', OWN, L, undefined, { display_name: 'Ext', user_id: ACCT })).status).toBe(201);
    expect((await call('POST', OWN, L, undefined, { display_name: 'Ext again', user_id: ACCT })).status).toBe(409);
    expect((await call('POST', OWN, L, undefined, { display_name: 'Pierre 2', user_id: PRD })).status).toBe(409);
  });
});

describe('PATCH / DELETE /parties/[partyId]', () => {
  it('PATCH changes the named fields only, clears with an empty string, and a rename follows into the credits', async () => {
    const res = await call('PATCH', OWN, L, PN, { display_name: 'Nova O.', ipi: '' , pro: 'ASCAP' });
    expect(res.status).toBe(200);
    expect(db.tables.parties.find((r) => r.id === PN)).toMatchObject({ display_name: 'Nova O.', ipi: null, pro: 'ASCAP', legal_name: 'Nova Legal' });
    expect(db.tables.track_collaborators.find((c) => c.id === 'c-1')!.name).toBe('Nova O.');
    expect(db.tables.track_collaborators.find((c) => c.id === 'c-2')!.name).toBe('Kilo Collab');
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ verb: 'party.updated', subject_id: PN, visibility: 'internal' });
    expect(events()[0].payload).toEqual({ fields: ['display_name', 'ipi', 'pro'] });
  });

  it('PATCH needs rights.write; 404 for another org’s or a missing party; 400 for nothing to change', async () => {
    expect((await call('PATCH', AR, L, PN, { pro: 'x' })).status).toBe(403);
    expect((await call('PATCH', PRD, L, PP, { pro: 'x' })).status).toBe(403);
    expect((await call('PATCH', X, L2, PN, { pro: 'x' })).status).toBe(404); // owner of ANOTHER org: not this org's party
    expect((await call('PATCH', OWN, L, p(99), { pro: 'x' })).status).toBe(404);
    expect((await call('PATCH', OWN, L, PN, {})).status).toBe(400);
    expect((await call('PATCH', OWN, L, PN, { ipi: 'bad' })).status).toBe(400);
  });

  it('a party another org owns is not reachable through this org', async () => {
    db.tables.parties.push({ ...party(p(50), 'Elsewhere'), org_id: L2 });
    expect((await call('PATCH', OWN, L, p(50), { pro: 'x' })).status).toBe(404);
    expect((await call('DELETE', OWN, L, p(50))).status).toBe(404);
    expect((await call('GET', OWN, L, p(50))).status).toBe(404);
  });

  it('DELETE refuses a party named on credits (409), removes an unused one and records party.deleted', async () => {
    const used = await call('DELETE', OWN, L, PN);
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({ credits: 1 });
    expect(db.tables.parties.some((r) => r.id === PN)).toBe(true);
    expect((await call('DELETE', AR, L, PU)).status).toBe(403);
    expect((await call('DELETE', OWN, L, PU)).status).toBe(200);
    expect(db.tables.parties.some((r) => r.id === PU)).toBe(false);
    expect(events().map((e) => e.verb)).toEqual(['party.deleted']);
  });
});

describe('LABEL-54: what each role reads of a party', () => {
  const get = async (who: string, id?: string) => (await (await call('GET', who, L, id)).json()) as Record<string, any>;
  const one = (body: Record<string, any>, name: string) => (body.parties as { displayName: string }[]).find((x) => x.displayName === name) as Record<string, any>;

  it('a roster artist reads the names of their own songs’ co-writers and nothing about them — no legal block, no payee block', async () => {
    const body = await get(ART);
    expect((body.parties as { displayName: string }[]).map((x) => x.displayName)).toEqual(['Nova']);
    expect(body.canSeePayee).toBe(false);
    expect(one(body, 'Nova').legal).toBeUndefined();
    expect(one(body, 'Nova').payee).toBeUndefined();
    const wire = JSON.stringify(body);
    for (const leak of ['Nova Legal', '00123456789', '2 road Y', 'GB-TAX-2', 'Invoice monthly']) expect(wire, leak).not.toContain(leak);
    const single = await get(ART, PN);
    expect(single.party).toMatchObject({ displayName: 'Nova' });
    expect(single.party.legal).toBeUndefined();
    expect((await call('GET', ART, L, PK)).status).toBe(404); // outside their scope
  });

  it('a roster artist reads their own party in full — except the payee block', async () => {
    db.tables.parties.push(party(p(30), 'Art Ist', { user_id: ART, address: 'Home', tax_id: 'ART-1' }));
    const own = one(await get(ART), 'Art Ist');
    expect(own.legal).toMatchObject({ legalName: 'Art Ist Legal', address: 'Home' });
    expect(own.payee).toBeUndefined();
  });

  it('the owner and legal (rights.write) read the payee block; A&R reads the legal block but not payee', async () => {
    for (const who of [OWN, LEG]) {
      const body = await get(who);
      expect(body.canSeePayee, who).toBe(true);
      expect(one(body, 'Pierre').payee).toEqual({ taxId: 'FR-TAX-1', paymentInstructions: 'PayPal, ask finance' });
      expect(one(body, 'Pierre').legal).toMatchObject({ address: '1 rue X', country: 'FR' });
    }
    const ar = await get(AR);
    expect(ar.canSeePayee).toBe(false);
    expect(one(ar, 'Pierre').legal.address).toBe('1 rue X');
    expect(JSON.stringify(ar)).not.toMatch(/FR-TAX-1|PayPal/);
  });

  it('finance (finance.read) reads every payee and no legal block', async () => {
    const body = await get(FIN);
    expect(body.canWrite).toBe(false);
    expect(body.canSeePayee).toBe(true);
    expect(one(body, 'Nova').payee).toEqual({ taxId: 'GB-TAX-2', paymentInstructions: 'Invoice monthly' });
    expect(one(body, 'Nova').legal).toBeUndefined();
    expect((await call('GET', FIN, L, PN)).status).toBe(200);
    expect((await call('POST', FIN, L, undefined, { display_name: 'Z' })).status).toBe(403);
    expect((await call('PATCH', FIN, L, PN, { tax_id: 'x' })).status).toBe(403);
  });

  it('the person on a party reads their own legal data, never their payee data back', async () => {
    const body = await get(PRD);
    expect(one(body, 'Pierre').legal).toMatchObject({ address: '1 rue X' });
    expect(one(body, 'Pierre').payee).toBeUndefined();
    expect(body.canSeePayee).toBe(false);
  });

  it('only a rights writer is offered the members to link', async () => {
    expect((await get(OWN)).members).toBeInstanceOf(Array);
    expect((await get(AR)).members).toBeUndefined();
    expect((await get(FIN)).members).toBeUndefined();
  });
});

describe('LABEL-54: writing address, country, tax id and payment instructions', () => {
  it('stores them (country upper-cased) and shows the writer the payee block', async () => {
    const res = await call('POST', OWN, L, undefined, { display_name: 'Odile', address: ' 5 rue Z ', country: 'fr', tax_id: 'FR99', payment_instructions: 'Wise link in the contract' });
    expect(res.status).toBe(201);
    const { party: created } = await res.json();
    expect(created.legal).toMatchObject({ address: '5 rue Z', country: 'FR' });
    expect(created.payee).toEqual({ taxId: 'FR99', paymentInstructions: 'Wise link in the contract' });
    expect(db.tables.parties.find((r) => r.id === created.id)).toMatchObject({ tax_id: 'FR99', payment_instructions: 'Wise link in the contract' });
  });

  it('refuses an IBAN or a card number as payment instructions (400), plainly, without echoing it, and stores nothing', async () => {
    for (const bad of ['GB29 NWBK 6016 1331 9268 19', 'card 4111 1111 1111 1111']) {
      const res = await call('POST', OWN, L, undefined, { display_name: 'Z', payment_instructions: bad });
      expect(res.status, bad).toBe(400);
      const text = JSON.stringify(await res.json());
      expect(text).toMatch(/bank or card number/i);
      expect(text).not.toContain('NWBK');
      expect(text).not.toContain('4111');
      expect((await call('PATCH', OWN, L, PN, { payment_instructions: bad })).status, bad).toBe(400);
    }
    expect(db.tables.parties).toHaveLength(4);
    expect(db.tables.parties.find((r) => r.id === PN)!.payment_instructions).toBe('Invoice monthly');
  });

  it('refuses a country that is not a two-letter code, and a bad tax id length', async () => {
    expect((await call('PATCH', OWN, L, PN, { country: 'France' })).status).toBe(400);
    expect((await call('PATCH', OWN, L, PN, { tax_id: 'x'.repeat(65) })).status).toBe(400);
  });

  it('the activity event names the fields that changed, never a tax id or a payment instruction', async () => {
    await call('PATCH', OWN, L, PN, { tax_id: 'NEW-SECRET-TAX', payment_instructions: 'Pay Bob', address: 'Nowhere' });
    expect(events()[0].payload).toEqual({ fields: ['address', 'payment_instructions', 'tax_id'] });
    expect(JSON.stringify(events())).not.toMatch(/NEW-SECRET-TAX|Pay Bob|Nowhere/);
  });
});

describe('LABEL-54: the lock on a name a circulated sheet shows', () => {
  const sheet = (status: string) => ({ id: 'sh-1', org_id: L, track_id: S1, kind: 'composition', version: 1, status });
  const line = (partyId: string) => ({ id: `ln-${partyId}`, split_sheet_id: 'sh-1', org_id: L, track_id: S1, party_id: partyId, role: 'writer', share: 50 });

  it('a draft sheet does not lock: rename and re-link are allowed', async () => {
    db.tables.split_sheets = [sheet('draft')];
    db.tables.split_lines = [line(PN), line(PP)];
    expect((await call('PATCH', OWN, L, PN, { display_name: 'Nova Okafor' })).status).toBe(200);
    expect((await call('PATCH', OWN, L, PP, { user_id: AR })).status).toBe(200);
  });

  for (const status of ['circulated', 'signed', 'disputed', 'superseded']) {
    it(`a ${status} sheet locks the name and an existing account — 409 party_locked, nothing changes`, async () => {
      db.tables.split_sheets = [sheet(status)];
      db.tables.split_lines = [line(PN), line(PP)];
      const rename = await call('PATCH', OWN, L, PN, { display_name: 'Nova Okafor' });
      expect(rename.status).toBe(409);
      expect(await rename.json()).toMatchObject({ code: 'party_locked' });
      expect((await call('PATCH', OWN, L, PP, { user_id: AR })).status).toBe(409);
      expect((await call('PATCH', OWN, L, PP, { user_id: null })).status).toBe(409);
      expect(db.tables.parties.find((r) => r.id === PN)!.display_name).toBe('Nova');
      expect(db.tables.parties.find((r) => r.id === PP)!.user_id).toBe(PRD);
      expect(db.tables.track_collaborators.find((c) => c.id === 'c-1')!.name).toBe('Nova');
      expect(events()).toEqual([]);
    });
  }

  it('on a circulated sheet the legal data stays editable, a no-op rename passes, and an unlinked party can be linked', async () => {
    db.tables.split_sheets = [sheet('circulated')];
    db.tables.split_lines = [line(PN), line(PP)];
    expect((await call('PATCH', OWN, L, PN, { legal_name: 'Nova Okafor', ipi: '00987654321', address: 'New road' })).status).toBe(200);
    expect((await call('PATCH', OWN, L, PN, { display_name: ' Nova ' })).status).toBe(200);
    expect((await call('PATCH', OWN, L, PN, { user_id: AR })).status).toBe(200);
    expect(db.tables.parties.find((r) => r.id === PN)).toMatchObject({ display_name: 'Nova', legal_name: 'Nova Okafor', user_id: AR });
  });

  it('a party on no sheet, or only on a sheet of another party, is not locked', async () => {
    db.tables.split_sheets = [sheet('circulated')];
    db.tables.split_lines = [line(PP)];
    expect((await call('PATCH', OWN, L, PN, { display_name: 'Nova Okafor' })).status).toBe(200);
  });
});

describe('LABEL-54: POST /parties/[partyId]/confirm', () => {
  const confirm = async (as: string | null, partyId: string, body: unknown = {}) => {
    current = as;
    const mod = (await import('./[partyId]/confirm/route')) as unknown as Record<string, Handler>;
    return mod.POST(
      new NextRequest(`https://app.test/api/org/${L}/parties/${partyId}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ orgId: L, partyId }) },
    );
  };

  it('the person confirms their own details: stamped, event names no values', async () => {
    const res = await confirm(PRD, PP, {});
    expect(res.status).toBe(200);
    const stored = db.tables.parties.find((r) => r.id === PP)!;
    expect(stored.details_confirmed_by).toBe(PRD);
    expect(stored.details_confirmed_at).toBeTruthy();
    expect((await res.json()).party.legal.confirmedAt).toBeTruthy();
    expect(events()[0]).toMatchObject({ verb: 'party.confirmed', actor_id: PRD, visibility: 'internal' });
    expect(events()[0].payload).toEqual({ corrected: [] });
  });

  it('they can correct the legal fields first (normalised), and only those', async () => {
    const res = await confirm(PRD, PP, { legal_name: 'Pierre P.', ipi: '00 123.456-780', country: 'be', address: 'Rue 1' });
    expect(res.status).toBe(200);
    expect(db.tables.parties.find((r) => r.id === PP)).toMatchObject({ legal_name: 'Pierre P.', ipi: '00123456780', country: 'BE', address: 'Rue 1', tax_id: 'FR-TAX-1' });
    expect(events()[0].payload).toEqual({ corrected: ['address', 'country', 'ipi', 'legal_name'] });
    expect(JSON.stringify(events())).not.toMatch(/Pierre P\.|Rue 1|00123456780/);
  });

  it('identity, links and payee data cannot be sent (400), and an invalid IPI is refused', async () => {
    for (const body of [{ display_name: 'X' }, { user_id: AR }, { tax_id: 'x' }, { payment_instructions: 'x' }, { contact_id: C1 }]) {
      expect((await confirm(PRD, PP, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await confirm(PRD, PP, { ipi: 'bad' })).status).toBe(400);
    expect(db.tables.parties.find((r) => r.id === PP)!.details_confirmed_at).toBeUndefined();
  });

  it('nobody confirms for another person — a rights writer included (404); marketing 403; signed out 401', async () => {
    expect((await confirm(OWN, PP)).status).toBe(404);
    expect((await confirm(AR, PN)).status).toBe(404);
    expect((await confirm(PRD, PN)).status).toBe(404);
    expect((await confirm(MKT, PP)).status).toBe(403);
    expect((await confirm(null, PP)).status).toBe(401);
    expect(events()).toEqual([]);
  });
});

describe('LABEL-54: POST /parties/[partyId]/invite', () => {
  const invite = async (as: string | null, partyId: string) => {
    current = as;
    const mod = (await import('./[partyId]/invite/route')) as unknown as Record<string, Handler>;
    return mod.POST(new NextRequest(`https://app.test/api/org/${L}/parties/${partyId}/invite`, { method: 'POST' }), { params: Promise.resolve({ orgId: L, partyId }) });
  };

  it('asks the one linked account, once, with a direct-ask notification and an internal event', async () => {
    const res = await invite(OWN, PP);
    expect(res.status).toBe(200);
    const rows = db.tables.notifications as Record<string, any>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: PRD, org_id: L, kind: 'party_confirmation', read: false });
    expect(JSON.stringify(rows[0])).not.toMatch(/email|token/i);
    expect(events()[0]).toMatchObject({ verb: 'party.confirmation_requested', visibility: 'internal', subject_id: PP });
  });

  it('a party with no account has nobody to ask (409 no_account); an already confirmed one is 409 too', async () => {
    const none = await invite(OWN, PN);
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ code: 'no_account' });
    db.tables.parties.find((r) => r.id === PP)!.details_confirmed_at = '2026-10-02';
    expect(await (await invite(OWN, PP)).json()).toMatchObject({ code: 'already_confirmed' });
    expect(db.tables.notifications ?? []).toEqual([]);
  });

  it('an external project member cannot be asked here (409 not_a_member)', async () => {
    db.tables.parties.find((r) => r.id === PU)!.user_id = ACCT;
    expect(await (await invite(OWN, PU)).json()).toMatchObject({ code: 'not_a_member' });
  });

  it('needs rights.write; 404 for a missing party', async () => {
    for (const who of [AR, PRD, FIN, ART, MKT]) expect((await invite(who, PP)).status, who).toBe(403);
    expect((await invite(OWN, p(99))).status).toBe(404);
  });
});
