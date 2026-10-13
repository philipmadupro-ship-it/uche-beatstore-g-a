/**
 * GET / POST /api/org/[orgId]/tracks/[id]/credits and PATCH …/[creditId]
 * (LABEL-27), through the REAL lib/auth/org-access, credits(-store), activity
 * and the in-memory audit function, against an in-memory database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project, song S1.
 *     LP2: Kilo's Inbox, song S2. S3: a song in no project.
 *     Org members: OWN (owner → rights.write), AR (A&R → rights.read),
 *     PRD (producer function → own line), MKT (marketing → none),
 *     SC (A&R scoped to Kilo).
 *     External members of LP1: EDITOR, CONTRIB, COMMENTER, VIEWER.
 *   Parties: PN (Nova, a plain rights holder), PP (PRD's own party).
 *   L2: song XS1. The producer: song PS1 (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const PRD = u(3);
const MKT = u(4);
const SC = u(5);
const EDITOR = u(11);
const CONTRIB = u(12);
const COMMENTER = u(13);
const VIEWER = u(14);
const STRANGER = u(15);
const X = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const S3 = t(3);
const XS1 = t(4);
const PS1 = t(5);
const PN = '60000000-0000-4000-8000-0000000000a1';
const PP = '60000000-0000-4000-8000-0000000000a2';
const CR_NOVA = '70000000-0000-4000-8000-0000000000a1';
const CR_PRD = '70000000-0000-4000-8000-0000000000a2';
const CR_S2 = '70000000-0000-4000-8000-0000000000a3';

let current: string | null = null;
let db: MemoryDb;
let failAudit = false;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
const track = (id: string, org: string | null, type = 'song', title = 'T') => ({ id, org_id: org, user_id: org ? null : OWN, type, title, song_stage: 'inbox' });
const ext = (user: string, role: string, project = LP1) => ({ org_id: L, project_id: project, user_id: user, role, allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' });
const credit = (over: Record<string, unknown>) => ({
  track_id: S1, org_id: L, source: 'manual', scope: 'recording', status: 'proposed', role_detail: null, contact_id: null,
  created_by: OWN, confirmed_by: null, confirmed_at: null, dispute_note: null, created_at: '2026-10-01T10:00:00Z', ...over,
});
const party = (over: Record<string, unknown>) => ({
  org_id: L, kind: 'person', legal_name: null, email: null, ipi: null, isni: null, pro: null, pro_affiliation: 'unknown',
  publisher_name: null, publisher_ipi: null, contact_id: null, user_id: null, created_at: '2026-10-01', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failAudit = false;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(PRD, 'member', ['producer']),
        member(MKT, 'member', ['marketing']),
        member(SC, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }],
      project_members: [ext(EDITOR, 'editor'), ext(CONTRIB, 'contributor'), ext(COMMENTER, 'commenter'), ext(VIEWER, 'viewer')],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [track(S1, L, 'song', 'Midnight'), track(S2, L, 'song', 'Dawn'), track(S3, L, 'song', 'Loose'), track(XS1, L2), track(PS1, null)],
      parties: [
        party({ id: PN, display_name: 'Nova', legal_name: 'Nova Okafor', ipi: '00987654321', contact_id: C1 }),
        party({ id: PP, display_name: 'Pierre', legal_name: 'Pierre Producteur', ipi: '00123456789', user_id: PRD }),
      ],
      track_collaborators: [
        credit({ id: CR_NOVA, name: 'Nova', role: 'songwriter', scope: 'composition', party_id: PN, status: 'confirmed', created_by: OWN }),
        credit({ id: CR_PRD, name: 'Pierre', role: 'mixer', party_id: PP, created_by: OWN }),
        credit({ id: CR_S2, track_id: S2, name: 'Pierre', role: 'producer', party_id: PP, created_by: OWN }),
      ],
      activity_events: [],
      song_beats: [],
      track_links: [],
      user_profiles: [
        { user_id: OWN, display_name: 'Owner' },
        { user_id: CONTRIB, display_name: 'Cleo Contrib' },
        { user_id: EDITOR, display_name: 'Eddie Editor' },
        { user_id: PRD, display_name: 'Pierre' },
      ],
    },
    unique: { track_collaborators: [['track_id', 'name', 'role']], parties: [['org_id', 'user_id']] },
    rpc: auditRpcMemory({ failAudit: () => failAudit }),
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: 'GET' | 'POST' | 'PATCH', as: string | null, org: string, id: string, body?: unknown, creditId?: string) {
  current = as;
  const mod = (creditId ? await import('./[creditId]/route') : await import('./route')) as unknown as Record<string, Handler>;
  const url = `https://app.test/api/org/${org}/tracks/${id}/credits${creditId ? `/${creditId}` : ''}`;
  const req = new NextRequest(url, method === 'GET' ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return mod[method](req, { params: Promise.resolve({ orgId: org, id, ...(creditId ? { creditId } : {}) }) });
}
const list = (as: string | null, org: string, id: string) => call('GET', as, org, id);
const propose = (as: string | null, org: string, id: string, body: unknown) => call('POST', as, org, id, body);
const decide = (as: string | null, org: string, id: string, creditId: string, body: unknown) => call('PATCH', as, org, id, body, creditId);
const credits = () => db.tables.track_collaborators;
const events = () => db.tables.activity_events;

describe('GET — who reads which credits', () => {
  it('rights.read (owner, A&R) reads every credit of the song, with each party’s legal name and IPI', async () => {
    for (const who of [OWN, AR]) {
      const res = await list(who, L, S1);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.credits.map((c: { name: string }) => c.name).sort()).toEqual(['Nova', 'Pierre']);
      const nova = body.credits.find((c: { name: string }) => c.name === 'Nova');
      expect(nova).toMatchObject({ role: 'songwriter', roleLabel: 'Songwriter', scope: 'composition', status: 'confirmed' });
      expect(nova.party.legal).toMatchObject({ legalName: 'Nova Okafor', ipi: '00987654321' });
    }
  });

  it('a producer-function member reads only THEIR OWN line, and only their own legal data', async () => {
    const body = await (await list(PRD, L, S1)).json();
    expect(body.credits.map((c: { name: string }) => c.name)).toEqual(['Pierre']);
    expect(body.credits[0]).toMatchObject({ mine: true, status: 'proposed', can: { confirm: true, dispute: true } });
    expect(body.me).toMatchObject({ reach: 'own', canPropose: true, canWrite: false, ownPartyId: PP });
    expect(JSON.stringify(body)).not.toContain('Nova Okafor');
    expect(JSON.stringify(body)).not.toContain('00987654321');
  });

  it('marketing (no rights ability) is 403; a scoped A&R reads only credits inside their scope (404 outside)', async () => {
    expect((await list(MKT, L, S1)).status).toBe(403);
    expect((await list(SC, L, S1)).status).toBe(404);
    const body = await (await list(SC, L, S2)).json();
    expect(body.credits.map((c: { id: string }) => c.id)).toEqual([CR_S2]);
  });

  it('an external member reads only their own line — and nothing of anyone else’s party', async () => {
    db.tables.parties.push(party({ id: '60000000-0000-4000-8000-0000000000a3', display_name: 'Cleo', legal_name: 'Cleo Contrib', ipi: '00555555555', user_id: CONTRIB }));
    db.tables.track_collaborators.push(credit({ id: '70000000-0000-4000-8000-0000000000a4', name: 'Cleo', role: 'mixer', scope: 'recording', party_id: '60000000-0000-4000-8000-0000000000a3', created_by: OWN }));
    for (const who of [VIEWER, COMMENTER, CONTRIB, EDITOR]) {
      const res = await list(who, L, S1);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.me.reach).toBe('own');
      const text = JSON.stringify(body);
      expect(text).not.toContain('Nova');
      expect(text).not.toContain('Pierre Producteur');
      expect(text).not.toContain('00987654321');
    }
    const mine = await (await list(CONTRIB, L, S1)).json();
    expect(mine.credits.map((c: { name: string }) => c.name)).toEqual(['Cleo']);
  });

  it('an external member of ANOTHER project, a stranger, another org’s member, a producer track: 404 — signed out 401', async () => {
    expect((await list(CONTRIB, L, S2)).status).toBe(404); // same org, a project they are not in
    expect((await list(STRANGER, L, S1)).status).toBe(404);
    expect((await list(X, L, S1)).status).toBe(404);
    expect((await list(OWN, L, PS1)).status).toBe(404);
    expect((await list(OWN, L2, S1)).status).toBe(404);
    expect((await list(null, L, S1)).status).toBe(401);
  });

  it('a credit view is built field by field: no creator, no account ids', async () => {
    const text = JSON.stringify(await (await list(OWN, L, S1)).json());
    for (const leak of ['created_by', 'confirmed_by', 'user_id', PRD, 'org_id']) expect(text, leak).not.toContain(leak);
  });
});

describe('POST — propose a credit', () => {
  it('ACCEPTANCE: an external member cannot propose a credit for someone else — party, name or contact', async () => {
    for (const body of [
      { role: 'mixer', party_id: PN },
      { role: 'mixer', party_id: PP },
      { role: 'mixer', name: 'Nova Okafor' },
      { role: 'mixer', name: 'Pierre' },
      { role: 'mixer', contact_id: C1 },
      { role: 'mixer', party_id: PN, name: 'Cleo Contrib' },
    ]) {
      const res = await propose(CONTRIB, L, S1, body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect((await res.json()).error).toBe('You can only propose a credit that names you');
    }
    expect(credits()).toHaveLength(3);
    expect(db.tables.parties).toHaveLength(2);
    expect(events()).toEqual([]);
  });

  it('an external contributor / editor proposes a credit naming THEMSELVES: their own party is made, the credit waits as proposed', async () => {
    const res = await propose(CONTRIB, L, S1, { role: 'instrumentalist', role_detail: 'Rhodes', name: 'cleo   contrib' });
    expect(res.status).toBe(201);
    const { credit: c } = await res.json();
    expect(c).toMatchObject({ name: 'Cleo Contrib', role: 'instrumentalist', roleLabel: 'Instrumentalist', scope: 'recording', status: 'proposed', roleDetail: 'Rhodes', mine: true, proposedByMe: true });
    expect(db.tables.parties.find((p) => p.user_id === CONTRIB)).toMatchObject({ display_name: 'Cleo Contrib', org_id: L, created_by: CONTRIB });
    expect(credits().find((r) => r.id === c.id)).toMatchObject({ org_id: L, track_id: S1, source: 'manual', created_by: CONTRIB, status: 'proposed' });
    expect(credits().find((r) => r.id === c.id)!.confirmed_by ?? null).toBeNull();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ verb: 'credit.proposed', actor_id: CONTRIB, org_id: L, visibility: 'artist', subject_type: 'credit', song_id: S1, audit: false });
    expect(events()[0].payload).toEqual({ role: 'instrumentalist', scope: 'recording' });

    // The second proposal re-uses the party, naming nobody.
    expect((await propose(EDITOR, L, S1, { role: 'producer' })).status).toBe(201);
    expect((await propose(EDITOR, L, S1, { role: 'mixer' })).status).toBe(201);
    expect(db.tables.parties.filter((p) => p.user_id === EDITOR)).toHaveLength(1);
  });

  it('a viewer and a commenter cannot propose at all (06 §2.6)', async () => {
    for (const who of [VIEWER, COMMENTER]) expect((await propose(who, L, S1, { role: 'mixer' })).status).toBe(403);
    expect(credits()).toHaveLength(3);
  });

  it('authorisation answers before the body is read', async () => {
    expect((await propose(MKT, L, S1, { nonsense: true })).status).toBe(403);
    expect((await propose(STRANGER, L, S1, { nonsense: true })).status).toBe(404);
    expect((await propose(null, L, S1, {})).status).toBe(401);
    expect((await propose(CONTRIB, L, S1, { nonsense: true })).status).toBe(400);
  });

  it('a producer-function member proposes for themselves only', async () => {
    expect((await propose(PRD, L, S1, { role: 'producer', party_id: PP })).status).toBe(201);
    expect((await propose(PRD, L, S1, { role: 'songwriter', party_id: PN })).status).toBe(403);
    expect((await propose(PRD, L, S1, { role: 'lyricist', name: 'Nova' })).status).toBe(403);
    expect((await propose(MKT, L, S1, { role: 'mixer' })).status).toBe(403);
  });

  it('rights.write proposes for anyone: a party, or just a name', async () => {
    const withParty = await propose(OWN, L, S1, { role: 'lyricist', party_id: PN });
    expect(withParty.status).toBe(201);
    expect((await withParty.json()).credit).toMatchObject({ name: 'Nova', scope: 'composition', status: 'proposed', partyId: PN, contactId: C1 });
    const byName = await propose(OWN, L, S1, { role: 'mastering_engineer', name: 'Ed Mastering' });
    expect(byName.status).toBe(201);
    expect((await byName.json()).credit).toMatchObject({ name: 'Ed Mastering', partyId: null, status: 'proposed' });
    expect((await propose(OWN, L, S1, { role: 'mixer' })).status).toBe(400);
    expect((await propose(OWN, L, S1, { role: 'mixer', party_id: '60000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
    expect((await propose(OWN, L, S1, { role: 'mixer', name: 'X', contact_id: '30000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
  });

  it('A&R (rights.read, not write) proposes nothing for anyone — it has no own line to propose on', async () => {
    // A&R holds rights.read, which implies the own line: they may propose THEMSELVES only.
    expect((await propose(AR, L, S1, { role: 'producer', party_id: PN })).status).toBe(403);
  });

  it('the role must exist and the scope must be the role’s (400); a repeat is 409', async () => {
    expect((await propose(OWN, L, S1, { role: 'wizard', name: 'Z' })).status).toBe(400);
    expect((await propose(OWN, L, S1, { role: 'mixer', scope: 'composition', name: 'Z' })).status).toBe(400);
    expect((await propose(OWN, L, S1, { role: 'mixer', party_id: PP })).status).toBe(409); // Pierre is already credited as mixer
  });

  it('is 404 for a producer track, another org’s song and out-of-scope songs', async () => {
    expect((await propose(OWN, L, PS1, { role: 'mixer', name: 'Z' })).status).toBe(404);
    expect((await propose(OWN, L, XS1, { role: 'mixer', name: 'Z' })).status).toBe(404);
    expect((await propose(SC, L, S1, { role: 'mixer', name: 'Z' })).status).toBe(404);
  });
});

describe('PATCH — confirm or dispute', () => {
  const rows = (id: string) => credits().find((c) => c.id === id)!;

  it('rights.write confirms: ONE audit event, visible on the creative side, with the song’s context; status, confirmed_by and time set', async () => {
    const res = await decide(OWN, L, S1, CR_PRD, { action: 'confirm' });
    expect(res.status).toBe(200);
    expect((await res.json()).credit).toMatchObject({ id: CR_PRD, status: 'confirmed' });
    expect(rows(CR_PRD)).toMatchObject({ status: 'confirmed', confirmed_by: OWN });
    expect(rows(CR_PRD).confirmed_at).toBeTruthy();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ verb: 'credit.confirmed', actor_id: OWN, org_id: L, audit: true, visibility: 'artist', subject_id: CR_PRD, song_id: S1, project_id: LP1, artist_id: C1 });
    expect(events()[0].payload).toEqual({ role: 'mixer', scope: 'recording', from: 'proposed', to: 'confirmed', noted: false });
    expect(JSON.stringify(events()[0])).not.toContain('Producteur');
  });

  it('the credited person disputes THEIR credit with a reason; the confirmation is cleared', async () => {
    const res = await decide(PRD, L, S1, CR_PRD, { action: 'dispute', note: 'I also did the vocal chain' });
    expect(res.status).toBe(200);
    expect(rows(CR_PRD)).toMatchObject({ status: 'disputed', confirmed_by: null, dispute_note: 'I also did the vocal chain' });
    expect(events()[0]).toMatchObject({ verb: 'credit.disputed', actor_id: PRD, audit: true });
    expect(events()[0].payload).toMatchObject({ noted: true });
    expect(JSON.stringify(events()[0])).not.toContain('vocal chain');
  });

  it('the credited person confirms a credit SOMEONE ELSE proposed for them; not one they proposed themselves', async () => {
    expect((await decide(PRD, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(200);
    // Their own proposal: they may dispute it, not confirm it.
    const own = await propose(PRD, L, S1, { role: 'producer', party_id: PP });
    const id = (await own.json()).credit.id as string;
    const self = await decide(PRD, L, S1, id, { action: 'confirm' });
    expect(self.status).toBe(403);
    expect(rows(id).status).toBe('proposed');
    expect((await decide(OWN, L, S1, id, { action: 'confirm' })).status).toBe(200);
  });

  it('an external member decides their OWN credit and is blind to the others’ (404)', async () => {
    db.tables.parties.push(party({ id: '60000000-0000-4000-8000-0000000000a3', display_name: 'Cleo', user_id: CONTRIB }));
    db.tables.track_collaborators.push(credit({ id: '70000000-0000-4000-8000-0000000000a4', name: 'Cleo', role: 'mixer', party_id: '60000000-0000-4000-8000-0000000000a3', created_by: OWN }));
    expect((await decide(CONTRIB, L, S1, CR_NOVA, { action: 'dispute' })).status).toBe(404);
    expect((await decide(CONTRIB, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(404);
    expect(rows(CR_PRD).status).toBe('proposed');
    expect((await decide(CONTRIB, L, S1, '70000000-0000-4000-8000-0000000000a4', { action: 'confirm' })).status).toBe(200);
    expect((await decide(VIEWER, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(404);
  });

  it('A&R without rights.write, marketing and strangers cannot decide', async () => {
    expect((await decide(AR, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(404); // not theirs, not a writer
    expect((await decide(MKT, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(403);
    expect((await decide(STRANGER, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(404);
    expect((await decide(null, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(401);
    expect(events()).toEqual([]);
  });

  it('a decision that changes nothing is 409 and writes no second event; a disputed credit can be confirmed again', async () => {
    expect((await decide(OWN, L, S1, CR_NOVA, { action: 'confirm' })).status).toBe(409); // already confirmed
    expect((await decide(OWN, L, S1, CR_PRD, { action: 'dispute' })).status).toBe(200);
    expect((await decide(OWN, L, S1, CR_PRD, { action: 'dispute' })).status).toBe(409);
    expect((await decide(OWN, L, S1, CR_PRD, { action: 'confirm' })).status).toBe(200);
    expect(events().map((e) => e.verb)).toEqual(['credit.disputed', 'credit.confirmed']);
  });

  it('a failed audit write changes nothing (the status and the event commit together)', async () => {
    failAudit = true;
    const res = await decide(OWN, L, S1, CR_PRD, { action: 'confirm' });
    expect(res.status).toBe(500);
    expect(rows(CR_PRD).status).toBe('proposed');
    expect(events()).toEqual([]);
  });

  it('is 404 for a credit of another song, another org, a bad id; 400 for a bad body', async () => {
    expect((await decide(OWN, L, S1, CR_S2, { action: 'confirm' })).status).toBe(404); // CR_S2 belongs to S2
    expect((await decide(OWN, L, S1, 'nope', { action: 'confirm' })).status).toBe(404);
    expect((await decide(X, L2, S1, CR_PRD, { action: 'confirm' })).status).toBe(404);
    expect((await decide(OWN, L, S1, CR_PRD, { action: 'approve' })).status).toBe(400);
    expect((await decide(OWN, L, S1, CR_PRD, { action: 'confirm', status: 'confirmed' })).status).toBe(400);
    expect(rows(CR_PRD).status).toBe('proposed');
  });
});
