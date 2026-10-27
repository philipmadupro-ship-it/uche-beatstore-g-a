/**
 * GET / POST /api/org/[orgId]/approvals and POST …/approvals/decide
 * (LABEL-30), through the REAL lib/auth/org-access, approvals(-store/-route),
 * notify, activity and the in-memory audit functions, against an in-memory
 * database that evaluates filters.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project, song S1 and
 *     release R1. LP2: Kilo's Inbox, song S2.
 *     Members: OWN (owner), AR (A&R: release.write, approve master), LG (legal:
 *     approve legal, rights.write), MKT (marketing: approve artwork + marketing),
 *     SC (A&R scoped to Kilo), PRD (producer: no release ability).
 *     EDITOR: an external editor of LP1.
 *   L2: owner X, song XS1.
 *
 * Legal readiness itself is LABEL-29's and is tested there; here it is a dial
 * (`readiness`), so the route's use of "blockers, never the score" is what is proven.
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
const LG = u(3);
const MKT = u(4);
const SC = u(5);
const PRD = u(6);
const EDITOR = u(11);
const X = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const XS1 = t(3);
const R1 = '60000000-0000-4000-8000-000000000001';
const ART1 = '70000000-0000-4000-8000-0000000000a1';
const ART2 = '70000000-0000-4000-8000-0000000000a2';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let failAudit = false;
let readiness = { ready: false, blockers: 3, codes: ['L1', 'L2', 'L5'] };

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current, email: `${current}@local.test` } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
// LABEL-29 owns readiness; the route only reads `ready` (blockers) from it.
vi.mock('@/lib/labelos/approvals-store', async (orig) => ({ ...(await orig<typeof import('@/lib/labelos/approvals-store')>()), legalGateReadiness: async () => readiness }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const track = (id: string, org: string | null, title: string) => ({ id, org_id: org, user_id: org ? null : OWN, type: 'song', title, song_stage: 'inbox' });
const sheet = (over: Record<string, unknown>) => ({ org_id: L, track_id: S1, kind: 'composition', note: null, document_asset_id: null, created_by: OWN, created_at: '2026-10-01', circulated_at: '2026-10-01', signed_at: null, superseded_at: null, superseded_by: null, ...over });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  failAudit = false;
  readiness = { ready: false, blockers: 3, codes: ['L1', 'L2', 'L5'] };
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(LG, 'member', ['legal']),
        member(MKT, 'member', ['marketing']),
        member(SC, 'member', ['a_and_r'], 'artists'),
        member(PRD, 'member', ['producer']),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: SC, contact_id: C2 }],
      project_members: [{ org_id: L, project_id: LP1, user_id: EDITOR, role: 'editor', allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01' }],
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
      // S1 is selected: a song on a DRAFT release is working until the release is delivered (LABEL-56), and a song is selected before it is put on a release.
      tracks: [{ ...track(S1, L, 'Midnight'), song_stage: 'selected' }, track(S2, L, 'Dawn'), track(XS1, L2, 'Other')],
      releases: [{ id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Nova EP', type: 'ep', upc: null, label_name: null, c_line: null, p_line: null, primary_genre: null, target_date: null, release_date: null, artwork_asset_id: ART1, state: 'draft' }],
      release_items: [{ id: t(90), release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: S1 }],
      split_sheets: [sheet({ id: '80000000-0000-4000-8000-000000000001', version: 1, status: 'signed' })],
      split_lines: [],
      track_collaborators: [
        { id: '90000000-0000-4000-8000-000000000001', track_id: S1, org_id: L, name: 'Nova', role: 'songwriter', status: 'confirmed', party_id: null, scope: 'composition', created_by: OWN, created_at: '2026-10-01' },
      ],
      approvals: [],
      tasks: [],
      notifications: [],
      activity_events: [],
      user_profiles: [
        { user_id: OWN, display_name: 'Owner' },
        { user_id: AR, display_name: 'Ari A&R' },
        { user_id: LG, display_name: 'Lena Legal' },
        { user_id: MKT, display_name: 'Max Marketing' },
      ],
    },
    unique: {},
    rpc: auditRpcMemory({ failAudit: () => failAudit }),
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: 'GET' | 'POST', as: string | null, opts: { org?: string; query?: string; body?: unknown; decide?: boolean } = {}) {
  current = as;
  const org = opts.org ?? L;
  const mod = (opts.decide ? await import('./decide/route') : await import('./route')) as unknown as Record<string, Handler>;
  const url = `https://app.test/api/org/${org}/approvals${opts.decide ? '/decide' : ''}${opts.query ?? ''}`;
  const req = new NextRequest(url, method === 'GET' ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) });
  return mod[method](req, { params: Promise.resolve({ orgId: org }) });
}

/** S1 sits on release R1 in the seed; a song's own legal approval is withdrawn while it is (doc 21 #13). Tests that approve at the song take it off (a cancelled release does not count). */
const offRelease = () => {
  db.tables.releases[0].state = 'cancelled';
  // Off a release a song is finished music (so legal can open it) only once selected (D4, lib/labelos/org-read).
  (db.tables.tracks.find((r) => r.id === S1) as Record<string, unknown>).song_stage = 'selected';
};
const song = (id = S1) => ({ kind: 'song' as const, id });
const release = (id = R1) => ({ kind: 'release' as const, id });
const state = (as: string, q: string) => call('GET', as, { query: q }).then((r) => r.json());
type GateJson = { gate: string; status: string; stale: boolean; changed: string[]; chip: { label: string; tone: string }; canRequest: boolean; canDecide: boolean; approvers: { userId: string; name: string }[]; pending: Record<string, unknown> | null; decision: Record<string, unknown> | null };
const legalOf = (body: { gates: { gate: string }[] }) => body.gates.find((g) => g.gate === 'legal') as GateJson;
const request = (as: string, subject: unknown, gate: string, approver: string, note?: string) =>
  call('POST', as, { body: { subject, gate, approver_id: approver, ...(note ? { note } : {}) } });
/** Like the screen: approving sends the key the gate state handed out, unless the test passes its own (`null` = none at all). */
const keyOf = async (as: string, subject: { kind: 'song' | 'release'; id: string }, gate: string) =>
  (((await state(as, `?${subject.kind}=${subject.id}`)).gates ?? []) as { gate: string; snapshotKey: string | null }[]).find((g) => g.gate === gate)?.snapshotKey ?? null;
const decide = async (as: string, subject: { kind: 'song' | 'release'; id: string }, gate: string, decision: string, note?: string, seen?: string | null) => {
  const key = seen === undefined && decision === 'approved' ? await keyOf(as, subject, gate) : seen;
  return call('POST', as, { decide: true, body: { subject, gate, decision, ...(note ? { note } : {}), ...(key !== undefined && key !== null ? { seen: key } : {}) } });
};

describe('GET — who sees approvals, and where a gate stands', () => {
  it('a song has the legal gate only; the approvers are the members who hold it and can open the song', async () => {
    const res = await call('GET', AR, { query: `?song=${S1}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gates.map((g: { gate: string }) => g.gate)).toEqual(['legal']);
    expect(legalOf(body)).toMatchObject({ status: 'none', stale: false, canRequest: true, canDecide: false, chip: { label: 'Not requested' } });
    // OWN (every ability) and LG (approve.legal); not AR / MKT / PRD (no legal ability).
    expect(legalOf(body).approvers.map((a: { userId: string }) => a.userId).sort()).toEqual([OWN, LG].sort());
    expect(JSON.stringify(body)).not.toContain('@local.test');
  });

  it('a release has all five gates', async () => {
    const body = await state(OWN, `?release=${R1}`);
    expect(body.gates.map((g: { gate: string }) => g.gate)).toEqual(['master', 'artwork', 'legal', 'marketing', 'metadata']);
  });

  it('marketing (approve.artwork / marketing) reads; the producer function (no release ability) is 403; a scoped A&R is 404 outside their artist', async () => {
    expect((await call('GET', MKT, { query: `?song=${S1}` })).status).toBe(200);
    expect((await call('GET', PRD, { query: `?song=${S1}` })).status).toBe(403);
    expect((await call('GET', SC, { query: `?song=${S1}` })).status).toBe(404);
    expect((await call('GET', SC, { query: `?song=${S2}` })).status).toBe(200);
  });

  it('an external project member, another org’s owner and a signed-out caller get nothing', async () => {
    expect([403, 404]).toContain((await call('GET', EDITOR, { query: `?song=${S1}` })).status);
    expect(await (await call('GET', EDITOR, { query: `?song=${S1}` })).json()).not.toHaveProperty('gates');
    expect([403, 404]).toContain((await call('GET', X, { query: `?song=${S1}` })).status);
    expect((await call('GET', X, { org: L2, query: `?song=${S1}` })).status).toBe(404);
    expect((await call('GET', null, { query: `?song=${S1}` })).status).toBe(401);
  });

  it('wants exactly one subject', async () => {
    expect((await call('GET', OWN, { query: '' })).status).toBe(400);
    expect((await call('GET', OWN, { query: `?song=${S1}&release=${R1}` })).status).toBe(400);
  });
});

describe('POST — asking one member', () => {
  it('A&R asks legal: a requested row, its audit event, and ONE direct-ask notification to the person asked', async () => {
    const res = await request(AR, song(), 'legal', LG, 'Please check the splits');
    expect(res.status).toBe(201);
    const rows = db.tables.approvals;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ org_id: L, song_id: S1, release_id: null, gate: 'legal', decision: 'requested', actor_id: AR, approver_id: LG, note: 'Please check the splits' });
    // The snapshot is what the approver is asked about: the sheet in force and the credits.
    expect(rows[0].subject_snapshot).toMatchObject({ v: 1, gate: 'legal', parts: { songs: [{ id: S1, sheets: [{ id: '80000000-0000-4000-8000-000000000001', version: 1 }] }] } });

    const ev = db.tables.activity_events.filter((e) => e.verb === 'approval.requested');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ org_id: L, actor_id: AR, subject_type: 'approval', song_id: S1, artist_id: C1, project_id: LP1, audit: true, visibility: 'internal' });
    // Blockers are listed in the event (allowed with blockers) — never the note's words.
    expect(ev[0].payload).toMatchObject({ gate: 'legal', blockers: 3, blocker_codes: ['L1', 'L2', 'L5'] });
    expect(JSON.stringify(ev[0].payload)).not.toContain('Please check');

    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ user_id: LG, org_id: L, kind: 'approval_requested', read: false });
    expect(db.tables.notifications[0].data).toMatchObject({ gate: 'legal', target: { kind: 'song', id: S1 } });

    const body = await res.json();
    expect(legalOf(body)).toMatchObject({ status: 'requested', chip: { label: 'Awaiting approval' } });
    expect(legalOf(body).pending).toMatchObject({ by: 'Ari A&R', approver: 'Lena Legal' });
  });

  it('a second request while one is open is a 409; asking for the wrong gate or a person who cannot decide it is refused', async () => {
    expect((await request(AR, song(), 'legal', LG)).status).toBe(201);
    const again = await request(AR, song(), 'legal', OWN);
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_requested');
    expect((await request(AR, song(), 'artwork', MKT)).status).toBe(400); // a song takes legal only
    expect(db.tables.approvals).toHaveLength(1);
  });

  it('the person asked must hold the gate and reach the subject', async () => {
    const mkt = await request(AR, song(), 'legal', MKT);
    expect(mkt.status).toBe(422);
    expect((await mkt.json()).code).toBe('approver_cannot_decide');
    expect((await request(AR, song(), 'legal', X)).status).toBe(422); // another org's owner
    expect((await request(AR, song(), 'legal', EDITOR)).status).toBe(422); // an external member
    expect(db.tables.approvals).toHaveLength(0);
    expect(db.tables.notifications).toHaveLength(0);
  });

  it('a member cannot ask themselves; an owner can (and is not notified of their own ask)', async () => {
    const self = await request(LG, song(), 'legal', LG);
    expect(self.status).toBe(422);
    expect((await self.json()).code).toBe('ask_someone_else');
    expect((await request(OWN, song(), 'legal', OWN)).status).toBe(201);
    expect(db.tables.notifications).toHaveLength(0);
  });

  it('who may ask: release.write / rights.write / the gate itself — not marketing for legal, not the producer function', async () => {
    expect((await request(MKT, song(), 'legal', LG)).status).toBe(403);
    expect((await request(PRD, song(), 'legal', LG)).status).toBe(403);
    expect((await request(LG, song(), 'legal', OWN)).status).toBe(201);
  });

  it('a release is asked for any gate, and a request on another org’s or a scoped-out subject is 404', async () => {
    expect((await request(AR, release(), 'master', OWN)).status).toBe(201);
    expect((await request(AR, release(), 'artwork', MKT)).status).toBe(201);
    expect((await request(SC, song(S1), 'legal', LG)).status).toBe(404);
    expect((await request(AR, song(XS1), 'legal', LG)).status).toBe(404);
  });

  it('validates the body and refuses an external member before reading it', async () => {
    expect((await call('POST', AR, { body: { subject: song(), gate: 'legal' } })).status).toBe(400);
    expect((await call('POST', AR, { body: { subject: song(), gate: 'distribution', approver_id: LG } })).status).toBe(400);
    expect([403, 404]).toContain((await call('POST', EDITOR, { body: {} })).status);
  });

  it('a failed audit insert leaves no approval and notifies nobody', async () => {
    failAudit = true;
    expect((await request(AR, song(), 'legal', LG)).status).toBe(500);
    expect(db.tables.approvals).toHaveLength(0);
    expect(db.tables.notifications).toHaveLength(0);
  });

  describe('Send to legal (LABEL-31): the request plus a task, in one action', () => {
    const sendToLegal = (as: string, subject: unknown, approver: string, note?: string) =>
      call('POST', as, { body: { subject, gate: 'legal', approver_id: approver, with_task: true, ...(note ? { note } : {}) } });

    it('also gives the person asked a task on the song — and still ONE notification, to that person only', async () => {
      const res = await sendToLegal(AR, song(), LG, 'Splits are in');
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(db.tables.approvals).toHaveLength(1);
      expect(db.tables.tasks).toHaveLength(1);
      expect(db.tables.tasks[0]).toMatchObject({ org_id: L, assignee_id: LG, created_by: AR, song_id: S1, release_id: null, title: 'Legal review: Midnight', notes: 'Splits are in' });
      expect(body.task).toEqual({ id: db.tables.tasks[0].id });
      // The approval request told them; the task does not tell them again, and nobody else hears.
      expect(db.tables.notifications).toHaveLength(1);
      expect(db.tables.notifications[0]).toMatchObject({ user_id: LG, kind: 'approval_requested' });
      expect(db.tables.activity_events.filter((e) => e.verb === 'approval.requested')).toHaveLength(1);
      expect(db.tables.activity_events.filter((e) => e.verb === 'task.created')).toHaveLength(1);
    });

    it('works on a release: the task targets the release', async () => {
      expect((await sendToLegal(AR, release(), LG)).status).toBe(201);
      expect(db.tables.tasks[0]).toMatchObject({ assignee_id: LG, release_id: R1, song_id: null, title: 'Legal review: Nova EP' });
    });

    it('without with_task there is no task (the plain request is unchanged)', async () => {
      const res = await request(AR, song(), 'legal', LG);
      expect(db.tables.tasks).toHaveLength(0);
      expect((await res.json()).task).toBeNull();
    });

    it('a refused request makes no task: wrong person, open request, failed audit', async () => {
      expect((await sendToLegal(AR, song(), PRD)).status).toBe(422);
      failAudit = true;
      expect((await sendToLegal(AR, song(), LG)).status).toBe(500);
      failAudit = false;
      expect((await sendToLegal(AR, song(), LG)).status).toBe(201);
      expect((await sendToLegal(AR, song(), LG)).status).toBe(409);
      expect(db.tables.tasks).toHaveLength(1);
    });

    it('needs tasks.write: without it 403 and nothing is written', async () => {
      db.tables.org_members.find((m) => m.user_id === AR)!.cap_revokes = ['tasks.write'];
      expect((await sendToLegal(AR, song(), LG)).status).toBe(403);
      expect(db.tables.approvals).toHaveLength(0);
      expect(db.tables.tasks).toHaveLength(0);
    });
  });
});

describe('POST /decide — Approved / Changes requested', () => {
  it('needs the gate capability: 403 for A&R, marketing and the producer function on legal; 401 signed out', async () => {
    offRelease();
    await request(AR, song(), 'legal', LG);
    for (const who of [AR, MKT]) expect((await decide(who, song(), 'legal', 'approved')).status).toBe(403);
    expect((await decide(PRD, song(), 'legal', 'approved')).status).toBe(403);
    expect((await decide(LG, song(), 'legal', 'approved')).status).not.toBe(403);
    current = null;
    expect((await call('POST', null, { decide: true, body: {} })).status).toBe(401);
    expect(db.tables.approvals.filter((a) => a.decision === 'approved')).toHaveLength(0);
  });

  it('changes requested needs a note and is stored with it, answering the request', async () => {
    await request(AR, song(), 'legal', LG);
    const bare = await decide(LG, song(), 'legal', 'changes_requested');
    expect(bare.status).toBe(400);
    expect((await bare.json()).code).toBe('note_required');
    const res = await decide(LG, song(), 'legal', 'changes_requested', 'Nova needs an IPI');
    expect(res.status).toBe(201);
    const row = db.tables.approvals[1];
    expect(row).toMatchObject({ decision: 'changes_requested', note: 'Nova needs an IPI', actor_id: LG, approver_id: null, request_id: db.tables.approvals[0].id });
    const g = legalOf(await res.json());
    expect(g).toMatchObject({ status: 'changes_requested', chip: { label: 'Changes requested' } });
    expect(g.decision).toMatchObject({ note: 'Nova needs an IPI', by: 'Lena Legal' });
    const ev = db.tables.activity_events.filter((e) => e.verb === 'approval.decided');
    expect(ev[0]).toMatchObject({ audit: true, visibility: 'internal', song_id: S1 });
    expect(ev[0].payload).toMatchObject({ gate: 'legal', decision: 'changes_requested', answered_request: true });
    expect(JSON.stringify(ev[0].payload)).not.toContain('IPI');
  });

  it('legal is approved only while there are no blockers; changes can be requested regardless', async () => {
    offRelease();
    await request(AR, song(), 'legal', LG);
    const blocked = await decide(LG, song(), 'legal', 'approved');
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).code).toBe('legal_blockers');
    expect(db.tables.approvals.filter((a) => a.decision === 'approved')).toHaveLength(0);
    readiness = { ready: true, blockers: 0, codes: [] };
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(201);
  });

  it('a requester cannot approve their own request', async () => {
    offRelease();
    readiness = { ready: true, blockers: 0, codes: [] };
    // LG holds the legal ability and asks OWN; LG then tries to approve LG's own request.
    await request(LG, song(), 'legal', OWN);
    const res = await decide(LG, song(), 'legal', 'approved');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('self_approval');
    expect(db.tables.approvals.filter((a) => a.decision === 'approved')).toHaveLength(0);
    // Anyone else who holds the gate may — and the approval links the request it answers.
    expect((await decide(OWN, song(), 'legal', 'approved')).status).toBe(201);
    const approved = db.tables.approvals.find((a) => a.decision === 'approved')!;
    expect(approved).toMatchObject({ actor_id: OWN, request_id: db.tables.approvals[0].id });
  });

  it('… except an owner or admin, who may approve a request they made themselves', async () => {
    offRelease();
    readiness = { ready: true, blockers: 0, codes: [] };
    await request(OWN, song(), 'legal', OWN);
    expect((await decide(OWN, song(), 'legal', 'approved')).status).toBe(201);
    // An admin, too.
    const ADMIN = u(7);
    db.tables.org_members.push(member(ADMIN, 'admin'));
    await request(ADMIN, release(), 'master', OWN);
    expect((await decide(ADMIN, release(), 'master', 'approved')).status).toBe(201);
  });

  it('the self-approval rule is the database’s too: the function refuses when the route is bypassed', async () => {
    readiness = { ready: true, blockers: 0, codes: [] };
    await request(LG, song(), 'legal', OWN);
    const direct = await mem.client.rpc('labelos_audit_approval_decide', {
      p_org: L, p_actor: LG, p_kind: 'song', p_subject: S1, p_gate: 'legal', p_decision: 'approved', p_note: null,
      p_snapshot: {}, p_may_self_approve: false, p_ctx: {}, p_payload: {},
    });
    expect(direct.data).toEqual({ error: 'self_approval' });
  });

  it('approving what is approved and unchanged is a 409', async () => {
    offRelease();
    readiness = { ready: true, blockers: 0, codes: [] };
    await request(AR, song(), 'legal', LG);
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(201);
    const again = await decide(OWN, song(), 'legal', 'approved');
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_approved');
  });

  it('a scoped-out song is 404 for a decider, and another org’s subject is 404', async () => {
    const SC_LEGAL = u(8);
    db.tables.org_members.push(member(SC_LEGAL, 'member', ['legal'], 'artists'));
    db.tables.member_artist_scopes.push({ org_id: L, user_id: SC_LEGAL, contact_id: C2 });
    expect((await decide(SC_LEGAL, song(S1), 'legal', 'changes_requested', 'x')).status).toBe(404);
    expect((await decide(OWN, song(XS1), 'legal', 'changes_requested', 'x')).status).toBe(404);
  });
});

describe('doc 21 #15 — approving needs a request addressed to the decider (owner and admin exempt)', () => {
  beforeEach(() => {
    offRelease();
    readiness = { ready: true, blockers: 0, codes: [] };
  });

  it('no request at all: 403 no_request, nothing stored; the gate state says why before the button is pressed', async () => {
    const g = legalOf(await state(LG, `?song=${S1}`));
    expect(g.canDecide).toBe(true);
    expect((g as unknown as { approveBlockedReason: string }).approveBlockedReason).toContain('request addressed to you');
    const res = await decide(LG, song(), 'legal', 'approved');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('no_request');
    expect(db.tables.approvals).toHaveLength(0);
  });

  it('a request addressed to someone else does not open the gate to a third holder', async () => {
    await request(AR, song(), 'legal', OWN);
    const res = await decide(LG, song(), 'legal', 'approved');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('no_request');
  });

  it('the person asked can approve; a request answered is closed, so a second approval needs a second request', async () => {
    await request(AR, song(), 'legal', LG);
    expect((legalOf(await state(LG, `?song=${S1}`)) as unknown as { approveBlockedReason: string | null }).approveBlockedReason).toBeNull();
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(201);
    db.tables.split_sheets[0].status = 'superseded';
    db.tables.split_sheets.push(sheet({ id: '80000000-0000-4000-8000-0000000000f2', version: 2, status: 'circulated' }));
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(403);
  });

  it('the owner approves without any request', async () => {
    expect((await decide(OWN, song(), 'legal', 'approved')).status).toBe(201);
  });
});

describe('doc 21 #13 — a song on a release is approved at the release', () => {
  beforeEach(() => {
    readiness = { ready: true, blockers: 0, codes: [] };
  });

  it('the song’s gate state names the release, and its own Approve is refused (409) even for the owner', async () => {
    await request(AR, song(), 'legal', LG);
    const g = legalOf(await state(LG, `?song=${S1}`)) as unknown as { onReleases: { id: string; title: string }[] };
    expect(g.onReleases).toEqual([{ id: R1, title: 'Nova EP' }]);
    for (const who of [LG, OWN]) {
      const res = await decide(who, song(), 'legal', 'approved');
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('decided_on_release');
    }
    expect(db.tables.approvals.filter((a) => a.decision === 'approved')).toHaveLength(0);
    // Changes can still be asked of it, and the release's own legal gate is decided normally.
    expect((await decide(LG, song(), 'legal', 'changes_requested', 'splits')).status).toBe(201);
    await request(AR, release(), 'legal', LG);
    expect((await decide(LG, release(), 'legal', 'approved')).status).toBe(201);
  });

  it('a member limited to another artist is told neither the title nor even that the song is on a release; a non-decider gets no titles', async () => {
    const SC_LEGAL = u(9);
    db.tables.org_members.push(member(SC_LEGAL, 'member', ['legal'], 'artists'));
    // Scoped to Kilo (C2) only, but allowed to open the song through Kilo's inbox: the release is Nova's.
    db.tables.member_artist_scopes.push({ org_id: L, user_id: SC_LEGAL, contact_id: C2 });
    db.tables.project_tracks.push({ project_id: LP2, track_id: S1, position: 1 });
    const scoped = legalOf(await state(SC_LEGAL, `?song=${S1}`)) as unknown as { onRelease: boolean; onReleases: unknown[] };
    expect(scoped.onReleases).toEqual([]);
    expect(JSON.stringify(scoped)).not.toContain('Nova EP');
    // The server still refuses the approval, in words that name nothing.
    await request(AR, song(), 'legal', SC_LEGAL);
    const res = await decide(SC_LEGAL, song(), 'legal', 'approved');
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain('Nova EP');
    // Someone who cannot decide gets neither the flag nor a title.
    const reader = legalOf(await state(AR, `?song=${S1}`)) as unknown as { onRelease: boolean; onReleases: unknown[] };
    expect(reader).toMatchObject({ onRelease: false, onReleases: [] });
  });

  it('a cancelled release no longer counts; a release gate state carries no list', async () => {
    db.tables.releases[0].state = 'cancelled';
    expect((legalOf(await state(OWN, `?song=${S1}`)) as unknown as { onReleases: unknown[] }).onReleases).toEqual([]);
    db.tables.releases[0].state = 'draft';
    const rel = (await state(OWN, `?release=${R1}`)).gates as { gate: string; onReleases: unknown[] }[];
    expect(rel.every((g) => g.onReleases.length === 0)).toBe(true);
  });
});

describe('stale detection — changing a split after approval', () => {
  async function approveLegal() {
    offRelease();
    readiness = { ready: true, blockers: 0, codes: [] };
    await request(AR, song(), 'legal', LG);
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(201);
  }

  it('approved and unchanged reads Approved', async () => {
    await approveLegal();
    expect(legalOf(await state(AR, `?song=${S1}`))).toMatchObject({ status: 'approved', stale: false, chip: { label: 'Approved', tone: 'good' } });
  });

  it('a new split version circulated afterwards makes the approval stale — nothing stored changes', async () => {
    await approveLegal();
    const before = JSON.stringify(db.tables.approvals);
    // The producer renegotiates: v1 is superseded, v2 is circulated (LABEL-28's transition).
    db.tables.split_sheets[0].status = 'superseded';
    db.tables.split_sheets.push(sheet({ id: '80000000-0000-4000-8000-000000000002', version: 2, status: 'circulated' }));
    const g = legalOf(await state(AR, `?song=${S1}`));
    expect(g).toMatchObject({ status: 'approved', stale: true, changed: ['songs'], chip: { label: 'Stale — changed since approval', tone: 'warn' } });
    expect(JSON.stringify(db.tables.approvals)).toBe(before); // derived on read, never written
  });

  it('a credit disputed afterwards stales it too; a draft being edited does not', async () => {
    await approveLegal();
    db.tables.split_sheets.push(sheet({ id: '80000000-0000-4000-8000-000000000003', version: 2, status: 'draft' }));
    expect(legalOf(await state(AR, `?song=${S1}`)).stale).toBe(false);
    db.tables.track_collaborators[0].status = 'disputed';
    expect(legalOf(await state(AR, `?song=${S1}`)).stale).toBe(true);
  });

  it('a stale approval can be renewed (no 409), and the new row carries the new snapshot', async () => {
    await approveLegal();
    db.tables.split_sheets[0].status = 'superseded';
    db.tables.split_sheets.push(sheet({ id: '80000000-0000-4000-8000-000000000002', version: 2, status: 'circulated' }));
    // The earlier request was answered; renewing it needs a new one.
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(403);
    expect((await request(AR, song(), 'legal', LG)).status).toBe(201);
    expect((await decide(LG, song(), 'legal', 'approved')).status).toBe(201);
    expect(db.tables.approvals).toHaveLength(4);
    expect(legalOf(await state(AR, `?song=${S1}`))).toMatchObject({ status: 'approved', stale: false });
  });

  it('a request after an approval re-opens the gate', async () => {
    await approveLegal();
    expect((await request(AR, song(), 'legal', LG)).status).toBe(201);
    expect(legalOf(await state(AR, `?song=${S1}`))).toMatchObject({ status: 'requested', chip: { label: 'Asked again' } });
  });

  it('replacing a release’s artwork file stales an artwork approval', async () => {
    await request(AR, release(), 'artwork', MKT);
    expect((await decide(MKT, release(), 'artwork', 'approved')).status).toBe(201);
    const artwork = (b: { gates: { gate: string }[] }) => b.gates.find((g) => g.gate === 'artwork') as GateJson;
    expect(artwork(await state(OWN, `?release=${R1}`))).toMatchObject({ status: 'approved', stale: false });
    db.tables.releases[0].artwork_asset_id = ART2;
    expect(artwork(await state(OWN, `?release=${R1}`))).toMatchObject({ stale: true, changed: ['artwork'] });
  });

  it('a metadata approval goes stale when a track’s ISRC or explicit flag, or the primary artist’s name, changes afterwards', async () => {
    const metadata = (b: { gates: { gate: string }[] }) => b.gates.find((g) => g.gate === 'metadata') as GateJson;
    await request(AR, release(), 'metadata', OWN);
    expect((await decide(OWN, release(), 'metadata', 'approved')).status).toBe(201);
    expect(metadata(await state(OWN, `?release=${R1}`))).toMatchObject({ status: 'approved', stale: false });

    const trackRow = db.tables.tracks.find((r) => r.id === S1) as Record<string, unknown>;
    trackRow.isrc = 'USRC17607839';
    expect(metadata(await state(OWN, `?release=${R1}`))).toMatchObject({ stale: true, changed: ['details'] });

    // Renewing records the new facts; then each of the others stales it again.
    await request(AR, release(), 'metadata', OWN);
    expect((await decide(OWN, release(), 'metadata', 'approved')).status).toBe(201);
    expect(metadata(await state(OWN, `?release=${R1}`))).toMatchObject({ stale: false });
    db.tables.release_items[0].explicit = true;
    expect(metadata(await state(OWN, `?release=${R1}`))).toMatchObject({ stale: true, changed: ['details'] });

    await request(AR, release(), 'metadata', OWN);
    expect((await decide(OWN, release(), 'metadata', 'approved')).status).toBe(201);
    (db.tables.contacts.find((c) => c.id === C1) as Record<string, unknown>).name = 'Renamed Artist';
    expect(metadata(await state(OWN, `?release=${R1}`))).toMatchObject({ stale: true, changed: ['release'] });
  });

  describe('approve what you saw', () => {
    const artwork = (b: { gates: { gate: string }[] }) => b.gates.find((g) => g.gate === 'artwork') as GateJson & { snapshotKey: string | null };

    it('the gate state carries a token for the facts, only to someone who can decide it', async () => {
      const mine = artwork(await state(MKT, `?release=${R1}`));
      expect(mine.canDecide).toBe(true);
      expect(mine.snapshotKey).toMatch(/^[0-9a-f]{14}$/);
      const theirs = artwork(await state(AR, `?release=${R1}`));
      expect(theirs.canDecide).toBe(false);
      expect(theirs.snapshotKey).toBeNull();
    });

    it('approving with the token the screen was drawn from is recorded', async () => {
      await request(AR, release(), 'artwork', MKT);
      const seen = artwork(await state(MKT, `?release=${R1}`)).snapshotKey;
      expect((await decide(MKT, release(), 'artwork', 'approved', undefined, seen)).status).toBe(201);
      expect(db.tables.approvals.filter((r) => r.decision === 'approved')).toHaveLength(1);
    });

    it('if the artwork was replaced after the approver opened it, the approval is refused (409) and nothing is stored', async () => {
      await request(AR, release(), 'artwork', MKT);
      const seen = artwork(await state(MKT, `?release=${R1}`)).snapshotKey;
      db.tables.releases[0].artwork_asset_id = ART2;
      const before = db.tables.approvals.length;
      const res = await decide(MKT, release(), 'artwork', 'approved', undefined, seen);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('changed_since_seen');
      expect(db.tables.approvals).toHaveLength(before);
      // Looking again gives a fresh token, and that one is accepted.
      const fresh = artwork(await state(MKT, `?release=${R1}`)).snapshotKey;
      expect(fresh).not.toBe(seen);
      expect((await decide(MKT, release(), 'artwork', 'approved', undefined, fresh)).status).toBe(201);
    });

    it('asking for changes needs no token; approving needs one (doc 21 #14), from API callers too', async () => {
      db.tables.releases[0].artwork_asset_id = ART2;
      expect((await decide(MKT, release(), 'artwork', 'changes_requested', 'wrong crop', 'stale-token')).status).toBe(201);
      expect((await request(AR, release(), 'artwork', MKT)).status).toBe(201);
      const none = await decide(MKT, release(), 'artwork', 'approved', undefined, null);
      expect(none.status).toBe(400);
      expect((await none.json()).code).toBe('seen_required');
      expect(db.tables.approvals.filter((r) => r.decision === 'approved')).toHaveLength(0);
      expect((await decide(MKT, release(), 'artwork', 'approved')).status).toBe(201);
    });
  });
});

describe('append-only', () => {
  it('neither route exposes an update or a delete', async () => {
    for (const mod of [await import('./route'), await import('./decide/route')] as Record<string, unknown>[]) {
      for (const m of ['PATCH', 'PUT', 'DELETE']) expect(mod[m], m).toBeUndefined();
    }
  });

  it('a whole request → changes → request → approval history only ever adds rows, never touches an earlier one', async () => {
    offRelease();
    readiness = { ready: true, blockers: 0, codes: [] };
    const seen: string[] = [];
    const snap = () => db.tables.approvals.map((a) => JSON.stringify(a));
    await request(AR, song(), 'legal', LG);
    seen.push(...snap());
    await decide(LG, song(), 'legal', 'changes_requested', 'fix');
    expect(snap().slice(0, seen.length)).toEqual(seen);
    seen.splice(0, seen.length, ...snap());
    await request(AR, song(), 'legal', LG);
    await decide(LG, song(), 'legal', 'approved');
    expect(snap().slice(0, seen.length)).toEqual(seen);
    expect(db.tables.approvals.map((a) => a.decision)).toEqual(['requested', 'changes_requested', 'requested', 'approved']);
    // The route layer wrote no update and no delete to the table, ever (the writes are RPC inserts).
    expect(mem.writes.filter((w) => w.table === 'approvals' && ['update', 'delete', 'upsert'].includes(w.op))).toEqual([]);
  });
});
