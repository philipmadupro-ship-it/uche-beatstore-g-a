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
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }],
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
      parties: [party(PN, 'Nova'), party(PK, 'Kilo Collab'), party(PP, 'Pierre', { user_id: PRD }), party(PU, 'Unused')],
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
