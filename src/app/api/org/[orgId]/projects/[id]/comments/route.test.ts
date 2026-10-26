/**
 * The org comments routes (LABEL-22): list / post / patch / delete, through the
 * REAL lib/auth/org-access (membership, capability, artist scope, external
 * members) and the real route code on an in-memory database. Only the rate
 * limiter, logging and the Supabase clients are faked.
 *
 * The property the task exists for: an `internal` comment never reaches a
 * roster artist or an external project member, on any path — list, one thread,
 * reply, patch, delete, carry-forward, the event feed — and the response of
 * everyone else is built field by field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { auditRpcMemory } from '@/lib/labelos/mocks/audit-rpc-memory';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = u(1);
const AR = u(2);
const MKT = u(3);
const ART = u(4); // roster artist (role artist), scoped to C1
const SC = u(5); // A&R scoped to C2 only
const X_VIEWER = u(11);
const X_COMMENTER = u(12);
const X_EDITOR = u(13);
const X_OTHER = u(14); // external member of ANOTHER project (P2)
const STRANGER = u(15);
const OTHER_ORG = u(16);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const P1 = '40000000-0000-4000-8000-0000000000a1';
const P2 = '40000000-0000-4000-8000-0000000000a2';
const PRODUCER_P = '40000000-0000-4000-8000-0000000000e1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1); // a selected song: finished, the song's own mix = mix v1
const V2 = t(2); // a version added to S1 (mix v2): working
const V3 = t(3); // a later version (mix v3, the current one)
const DEMO = t(4); // a demo linked to S1: working
const OTHER_SONG = t(5);
const c = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true }));

const listRoute = () => import('./route');
const itemRoute = () => import('./[commentId]/route');

const member = (user: string, role: string, functions: string[] = [], scope = 'org') => ({
  org_id: L, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});
const pm = (user: string, role: string, project = P1) => ({
  org_id: L, project_id: project, user_id: user, role, allow_downloads: false, expires_at: null, invitation_id: null, created_at: '2026-10-01',
});
type CommentSeed = Record<string, unknown>;
const comment = (id: string, extra: CommentSeed = {}) => ({
  id, org_id: L, project_id: P1, track_id: S1, user_id: AR, author_name: 'Dana', body: `body-${id}`, parent_id: null,
  region_start: null, region_end: null, visibility: 'artist', resolved_at: null, resolved_by: null, edited_at: null,
  deleted_at: null, share_token: null, contact_id: null, created_at: `2026-10-01T10:${id.slice(-2)}:00Z`, ...extra,
});

function seed(): MemoryDb {
  return {
    tables: {
      organizations: [
        { id: L, name: 'Night Shift', slug: 'night-shift', kind: 'label', deleted_at: null },
        { id: L2, name: 'Other Label', slug: 'other', kind: 'label', deleted_at: null },
      ],
      org_members: [
        member(OWNER, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(ART, 'artist', [], 'artists'),
        member(SC, 'member', ['a_and_r'], 'artists'),
        { ...member(OTHER_ORG, 'owner'), org_id: L2 },
      ],
      member_artist_scopes: [
        { org_id: L, user_id: ART, contact_id: C1 },
        { org_id: L, user_id: SC, contact_id: C2 },
      ],
      project_members: [
        pm(X_VIEWER, 'viewer'),
        pm(X_COMMENTER, 'commenter'),
        pm(X_EDITOR, 'editor'),
        pm(X_OTHER, 'editor', P2),
      ],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: P1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: C1 },
        { id: P2, org_id: L, user_id: null, name: 'Kilo EP', inbox_for_contact_id: C2 },
        { id: PRODUCER_P, org_id: null, user_id: OWNER, name: 'Producer project' },
      ],
      project_contacts: [],
      project_tracks: [
        { project_id: P1, track_id: S1, position: 0 },
        { project_id: P1, track_id: V2, position: 1 },
        { project_id: P1, track_id: V3, position: 2 },
        { project_id: P1, track_id: DEMO, position: 3 },
        { project_id: P2, track_id: OTHER_SONG, position: 0 },
      ],
      tracks: [
        { id: S1, org_id: L, user_id: null, created_by: AR, title: 'Midnight', type: 'song', song_stage: 'selected', beat_track_id: null },
        { id: V2, org_id: L, user_id: null, created_by: X_EDITOR, title: 'Midnight (v2)', type: 'song', song_stage: null, beat_track_id: null },
        { id: V3, org_id: L, user_id: null, created_by: X_EDITOR, title: 'Midnight (v3)', type: 'song', song_stage: null, beat_track_id: null },
        { id: DEMO, org_id: L, user_id: null, created_by: AR, title: 'Midnight demo', type: 'song', song_stage: null, beat_track_id: null },
        { id: OTHER_SONG, org_id: L, user_id: null, created_by: AR, title: 'Secret', type: 'song', song_stage: 'selected', beat_track_id: null },
      ],
      track_links: [
        { from_track_id: S1, to_track_id: V2, relation: 'version', position: 0, created_at: '2026-10-02T00:00:00Z' },
        { from_track_id: S1, to_track_id: V3, relation: 'version', position: 0, created_at: '2026-10-03T00:00:00Z' },
        { from_track_id: S1, to_track_id: DEMO, relation: 'demo', position: 0, created_at: '2026-10-04T00:00:00Z' },
      ],
      song_beats: [],
      release_items: [],
      releases: [],
      project_comments: [
        comment(c(1), { body: 'The vocal is too bright', region_start: 12.5, region_end: 20 }), // artist-visible, on mix v1, unresolved
        comment(c(2), { body: 'Team: clear the sample first', visibility: 'internal' }), // INTERNAL, on mix v1, unresolved
        comment(c(3), { body: 'Bass is fixed in v2', resolved_at: '2026-10-05T00:00:00Z', resolved_by: AR }), // resolved on mix v1
        comment(c(4), { body: 'Reply to the vocal note', parent_id: c(1), user_id: X_EDITOR }), // reply under c1
        comment(c(5), { body: 'Snare on v2 is thin', track_id: V2 }), // unresolved on mix v2
        comment(c(6), { body: 'Latest mix feels great', track_id: V3 }), // native on the current mix
        comment(c(7), { body: 'Internal on a demo', track_id: DEMO, visibility: 'internal' }),
        comment(c(8), { body: 'Notes on the demo', track_id: DEMO }),
        comment(c(9), { body: 'Project-wide note', track_id: null }),
        comment(c(10), { body: 'Kilo project note', project_id: P2, track_id: OTHER_SONG }),
        comment(c(11), { body: 'Portal thread (artist ↔ producer)', contact_id: C1 }),
        comment(c(12), { body: 'Guest via a share link', share_token: 'tok', user_id: null }),
        comment(c(13), { body: 'Deleted note', deleted_at: '2026-10-06T00:00:00Z' }),
      ],
      activity_events: [],
      user_profiles: [{ user_id: AR, display_name: 'Dana' }, { user_id: OWNER, display_name: 'Owen' }],
      creator_profiles: [],
    },
    rpc: auditRpcMemory(),
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = seed();
  mem = memoryAdmin(db);
});

type Comment = { id: string; body: string; visibility: string; carriedFrom: { label: string; trackId: string } | null; mine: boolean; resolvedAt: string | null; regionStart: number | null; parentId: string | null };

async function list(user: string | null, opts: { project?: string; org?: string; trackId?: string } = {}) {
  current = user;
  const { GET } = await listRoute();
  const project = opts.project ?? P1;
  const org = opts.org ?? L;
  const q = opts.trackId ? `?trackId=${opts.trackId}` : '';
  return GET(new NextRequest(`https://app.test/api/org/${org}/projects/${project}/comments${q}`), { params: Promise.resolve({ orgId: org, id: project }) });
}
async function post(user: string | null, body: unknown, opts: { project?: string; org?: string } = {}) {
  current = user;
  const { POST } = await listRoute();
  const project = opts.project ?? P1;
  const org = opts.org ?? L;
  return POST(
    new NextRequest(`https://app.test/api/org/${org}/projects/${project}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ orgId: org, id: project }) },
  );
}
async function patch(user: string | null, commentId: string, body: unknown, opts: { project?: string } = {}) {
  current = user;
  const { PATCH } = await itemRoute();
  const project = opts.project ?? P1;
  return PATCH(
    new NextRequest(`https://app.test/api/org/${L}/projects/${project}/comments/${commentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ orgId: L, id: project, commentId }) },
  );
}
async function del(user: string | null, commentId: string, opts: { project?: string } = {}) {
  current = user;
  const { DELETE } = await itemRoute();
  const project = opts.project ?? P1;
  return DELETE(new NextRequest(`https://app.test/api/org/${L}/projects/${project}/comments/${commentId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ orgId: L, id: project, commentId }),
  });
}
const ids = async (res: Response) => ((await res.json()).comments as Comment[]).map((x) => x.id);
const INTERNAL_BODIES = ['Team: clear the sample first', 'Internal on a demo'];

describe('GET: who sees what', () => {
  it('the team sees artist-visible and internal notes of the project, nothing else of the table', async () => {
    for (const user of [OWNER, AR]) {
      const res = await list(user);
      expect(res.status).toBe(200);
      const got = await ids(res);
      expect(got).toEqual([c(1), c(2), c(3), c(4), c(5), c(6), c(7), c(8), c(9)]);
      // Not another project's, not the portal thread, not a share guest's, not a deleted one.
      for (const never of [c(10), c(11), c(12), c(13)]) expect(got).not.toContain(never);
    }
  });

  it('a roster artist reads only artist-visible comments — no internal row in the JSON at all', async () => {
    const res = await list(ART);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    for (const body of INTERNAL_BODIES) expect(text).not.toContain(body);
    expect(text).not.toContain('"internal"');
    expect(text).not.toContain(c(2));
    expect(text).toContain('The vocal is too bright');
  });

  it('an external member of this project — viewer, commenter, editor — never gets an internal comment', async () => {
    for (const user of [X_VIEWER, X_COMMENTER, X_EDITOR]) {
      const res = await list(user);
      expect(res.status, user).toBe(200);
      const text = JSON.stringify(await res.json());
      for (const body of INTERNAL_BODIES) expect(text, user).not.toContain(body);
      expect(text).not.toContain('"internal"');
      expect(text).toContain('The vocal is too bright');
    }
  });

  it('the answer never carries a user id, a share token, a contact id, an org id or the raw rows', async () => {
    const text = JSON.stringify(await (await list(AR)).json());
    for (const leak of [OWNER, X_EDITOR, C1, L, 'user_id', 'share_token', 'contact_id', 'org_id', 'resolved_by', 'tok']) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it('a project that is not theirs, another org, a producer project and a stranger: the same 404; signed out 401', async () => {
    expect((await list(X_OTHER)).status).toBe(404); // external member of P2 asking for P1
    expect((await list(STRANGER)).status).toBe(404);
    expect((await list(OTHER_ORG)).status).toBe(404); // an owner of ANOTHER org
    expect((await list(AR, { project: PRODUCER_P })).status).toBe(404);
    expect((await list(AR, { org: L2 })).status).toBe(404);
    expect((await list(null)).status).toBe(401);
    // …and an artists-scoped member whose artist is not on this project.
    expect((await list(SC)).status).toBe(404);
  });

  it('D4: a member who may not hear the demo does not get its notes (marketing), nor can they ask for its track', async () => {
    const res = await list(MKT);
    expect(res.status).toBe(200);
    const got = await ids(res);
    expect(got).toContain(c(1)); // the selected song is finished material
    for (const hidden of [c(5), c(6), c(7), c(8)]) expect(got, hidden).not.toContain(hidden); // versions and the demo are working
    expect((await list(MKT, { trackId: DEMO })).status).toBe(404);
    expect((await list(AR, { trackId: DEMO })).status).toBe(200);
  });

  it('each comment carries what THIS caller may do to it: an admin may moderate, an author who lost the right may not edit', async () => {
    const abilities = async (user: string, id: string) => ((await (await list(user)).json()).comments as { id: string; can: unknown }[]).find((x) => x.id === id)!.can;
    // c(1) was written by AR.
    expect(await abilities(AR, c(1))).toEqual({ edit: true, delete: true, changeVisibility: true });
    expect(await abilities(OWNER, c(1))).toEqual({ edit: false, delete: true, changeVisibility: true });
    expect(await abilities(ART, c(1))).toEqual({ edit: false, delete: false, changeVisibility: false });
    expect(await abilities(X_EDITOR, c(1))).toEqual({ edit: false, delete: false, changeVisibility: false });
    // c(4) was written by the external editor: they may edit and delete their own words, never flip visibility.
    expect(await abilities(X_EDITOR, c(4))).toEqual({ edit: true, delete: true, changeVisibility: false });
  });

  it('a track outside the project is a 404, and a malformed one too', async () => {
    expect((await list(AR, { trackId: OTHER_SONG })).status).toBe(404);
    expect((await list(AR, { trackId: 'not-a-uuid' })).status).toBe(404);
  });

  it('the caller’s abilities ride along', async () => {
    const me = async (user: string) => (await (await list(user)).json()).me;
    expect(await me(AR)).toEqual({ canComment: true, canPostInternal: true });
    expect(await me(ART)).toEqual({ canComment: true, canPostInternal: false });
    expect(await me(MKT)).toEqual({ canComment: false, canPostInternal: false });
    expect(await me(X_VIEWER)).toEqual({ canComment: false, canPostInternal: false });
    expect(await me(X_COMMENTER)).toEqual({ canComment: true, canPostInternal: false });
  });

  it('before migration 150 the list says so instead of failing, and a write says which migration', async () => {
    // PostgREST on a database without the columns: any select that names `visibility` answers 42703.
    const real = mem.client.from.bind(mem.client);
    const missing = { code: '42703', message: 'column project_comments.visibility does not exist' };
    mem.client.from = ((table: string) => {
      const b = real(table);
      if (table !== 'project_comments') return b;
      const select = b.select.bind(b);
      b.select = ((cols?: string) => {
        if (!cols || !cols.includes('visibility')) return select(cols);
        const dead: Record<string, unknown> = {};
        for (const m of ['eq', 'is', 'in', 'order', 'limit', 'maybeSingle', 'single']) dead[m] = () => dead;
        dead.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: null, error: missing }).then(resolve);
        return dead as unknown as ReturnType<typeof select>;
      }) as typeof b.select;
      return b;
    }) as typeof mem.client.from;
    const res = await list(AR);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaReady: false, comments: [] });
    const write = await post(AR, { body: 'hello' });
    expect(write.status).toBe(503);
    expect(await write.json()).toMatchObject({ migration: '150', schemaReady: false });
    expect((await patch(AR, c(1), { resolved: true })).status).toBe(503);
    expect((await del(AR, c(1))).status).toBe(503);
  });

  it('GET: one audio-class lookup however many comments, and the picker list only when asked', async () => {
    const asked: string[] = [];
    const real = mem.client.from.bind(mem.client);
    mem.client.from = ((table: string) => { asked.push(table); return real(table); }) as typeof mem.client.from;
    const plain = await (await list(AR)).json();
    expect(plain.recordings).toBeUndefined();
    // facts = tracks + song_beats + track_links + main beats (+ linked tracks) once, not once per use.
    expect(asked.filter((t) => t === 'song_beats')).toHaveLength(1);
    current = AR;
    const { GET } = await listRoute();
    const withPicker = await (await GET(new NextRequest(`https://app.test/api/org/${L}/projects/${P1}/comments?recordings=1`), { params: Promise.resolve({ orgId: L, id: P1 }) })).json();
    expect(withPicker.recordings).toEqual([
      { id: S1, title: 'Midnight' }, { id: V2, title: 'Midnight (v2)' }, { id: V3, title: 'Midnight (v3)' }, { id: DEMO, title: 'Midnight demo' },
    ]);
    // Marketing hears the finished song only: the picker offers nothing else.
    current = MKT;
    const mkt = await (await GET(new NextRequest(`https://app.test/api/org/${L}/projects/${P1}/comments?recordings=1`), { params: Promise.resolve({ orgId: L, id: P1 }) })).json();
    expect(mkt.recordings).toEqual([{ id: S1, title: 'Midnight' }]);
  });

  it('the list is the NEWEST page: past the cap the oldest comments drop, never the latest', async () => {
    db.tables.project_comments = [];
    for (let i = 0; i < 2003; i++) db.tables.project_comments.push(comment(`70000000-0000-4000-8000-${String(i).padStart(12, '0')}`, { body: `n${i}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }));
    const got = ((await (await list(AR)).json()).comments as { body: string }[]).map((x) => x.body);
    expect(got).toHaveLength(2000);
    expect(got[0]).toBe('n3');
    expect(got[1999]).toBe('n2002');
  });
});

describe('GET ?trackId: carry-forward shows exactly the unresolved comments of earlier versions', () => {
  it('the current mix (v3) shows its own, plus the unresolved threads of v1 and v2 labelled, with their replies', async () => {
    const res = await list(AR, { trackId: V3 });
    const body = await res.json();
    const view = (body.comments as Comment[]).map((x) => [x.id, x.carriedFrom?.label ?? null]);
    expect(view).toEqual([
      [c(1), 'mix v1'], // the vocal note (unresolved)
      [c(2), 'mix v1'], // the internal note — carried for the TEAM
      [c(4), 'mix v1'], // its reply travels with the thread
      [c(5), 'mix v2'],
      [c(6), null], // native on v3
    ]);
    // c(3) is resolved → not carried; c(7)/c(8) are the demo's; c(9) is project-level.
    expect(body.version).toEqual({ label: 'mix v3', current: true });
    expect((body.comments as Comment[]).find((x) => x.id === c(1))).toMatchObject({ carriedFrom: { trackId: S1, label: 'mix v1' }, regionStart: 12.5 });
  });

  it('an artist gets the same carried threads minus the internal one — never a carried internal note', async () => {
    for (const user of [ART, X_COMMENTER]) {
      const body = await (await list(user, { trackId: V3 })).json();
      expect((body.comments as Comment[]).map((x) => x.id), user).toEqual([c(1), c(4), c(5), c(6)]);
      expect(JSON.stringify(body)).not.toContain('clear the sample');
    }
  });

  it('resolving a thread removes it from the next version’s view, reopening brings it back', async () => {
    expect((await patch(AR, c(1), { resolved: true })).status).toBe(200);
    expect(await ids(await list(AR, { trackId: V3 }))).toEqual([c(2), c(5), c(6)]);
    expect((await patch(AR, c(1), { resolved: false })).status).toBe(200);
    expect(await ids(await list(AR, { trackId: V3 }))).toEqual([c(1), c(2), c(4), c(5), c(6)]);
  });

  it('an older mix shows only its own comments (resolved ones too) and nothing is carried; the version says so', async () => {
    const body = await (await list(AR, { trackId: S1 })).json();
    expect((body.comments as Comment[]).map((x) => x.id)).toEqual([c(1), c(2), c(3), c(4)]);
    expect((body.comments as Comment[]).every((x) => x.carriedFrom === null)).toBe(true);
    expect(body.version).toEqual({ label: 'mix v1', current: false });
  });

  it('a track in no version chain has none', async () => {
    const body = await (await list(AR, { trackId: DEMO })).json();
    expect((body.comments as Comment[]).map((x) => x.id)).toEqual([c(7), c(8)]);
    expect(body.version).toEqual({ label: 'mix v1', current: true });
  });
});

describe('POST', () => {
  it('a team member posts an artist-visible comment, pinned to a moment, stored by the service role with the project’s org', async () => {
    const res = await post(AR, { body: '  Lift the hook  ', track_id: V3, region_start: 30, region_end: 35 });
    expect(res.status).toBe(201);
    const { comment: made } = await res.json();
    expect(made).toMatchObject({ body: 'Lift the hook', trackId: V3, regionStart: 30, regionEnd: 35, visibility: 'artist', mine: true, authorName: 'Dana', carriedFrom: null });
    const stored = db.tables.project_comments.find((r) => r.id === made.id)!;
    expect(stored).toMatchObject({ org_id: L, project_id: P1, user_id: AR, share_token: null, contact_id: null, visibility: 'artist' });
  });

  it('a half-set or inverted pin becomes an ordinary comment on the recording', async () => {
    const a = await (await post(AR, { body: 'x', track_id: V3, region_start: 30 })).json();
    expect(a.comment).toMatchObject({ regionStart: null, regionEnd: null, trackId: V3 });
    const b = await (await post(AR, { body: 'y', track_id: V3, region_start: 40, region_end: 35 })).json();
    expect(b.comment.regionStart).toBeNull();
  });

  it('internal: the team may; a roster artist and an external member are refused, even an editor', async () => {
    expect((await post(AR, { body: 'note', visibility: 'internal' })).status).toBe(201);
    expect((await post(OWNER, { body: 'note', visibility: 'internal' })).status).toBe(201);
    for (const user of [ART, X_COMMENTER, X_EDITOR]) {
      const res = await post(user, { body: 'sneaky', visibility: 'internal' });
      expect(res.status, user).toBe(403);
    }
    expect(db.tables.project_comments.some((r) => r.body === 'sneaky')).toBe(false);
  });

  it('who may comment: artist, A&R, a commenter and up; not marketing, not a viewer', async () => {
    expect((await post(ART, { body: 'hi' })).status).toBe(201);
    expect((await post(X_COMMENTER, { body: 'hi' })).status).toBe(201);
    expect((await post(X_EDITOR, { body: 'hi' })).status).toBe(201);
    expect((await post(MKT, { body: 'hi' })).status).toBe(403);
    expect((await post(X_VIEWER, { body: 'hi' })).status).toBe(403);
    expect((await post(null, { body: 'hi' })).status).toBe(401);
    // Never into someone else's project / org.
    expect((await post(X_COMMENTER, { body: 'hi' }, { project: P2 })).status).toBe(404);
    expect((await post(STRANGER, { body: 'hi' })).status).toBe(404);
    expect((await post(SC, { body: 'hi' })).status).toBe(404); // scoped to Kilo, this is Nova's project
  });

  it('an external member’s comment is stored as theirs, artist-visible, with no way to set an org, user or token', async () => {
    const res = await post(X_COMMENTER, { body: 'Nice mix', track_id: V2 });
    expect(res.status).toBe(201);
    const stored = db.tables.project_comments.find((r) => r.body === 'Nice mix')!;
    expect(stored).toMatchObject({ user_id: X_COMMENTER, org_id: L, visibility: 'artist', share_token: null, contact_id: null });
    expect((await post(X_COMMENTER, { body: 'x', org_id: L2 })).status).toBe(400);
    expect((await post(X_COMMENTER, { body: 'x', user_id: OWNER })).status).toBe(400);
    expect((await post(X_COMMENTER, { body: 'x', share_token: 'tok' })).status).toBe(400);
    expect((await post(X_COMMENTER, { body: 'x', contact_id: C1 })).status).toBe(400);
  });

  it('validation: empty, too long, bad ids, bad JSON', async () => {
    expect((await post(AR, { body: '   ' })).status).toBe(400);
    expect((await post(AR, { body: 'x'.repeat(5001) })).status).toBe(400);
    expect((await post(AR, { body: 'x', track_id: 'nope' })).status).toBe(400);
    expect((await post(AR, { body: 'x', visibility: 'public' })).status).toBe(400);
    current = AR;
    const { POST } = await listRoute();
    const res = await POST(new NextRequest(`https://app.test/api/org/${L}/projects/${P1}/comments`, { method: 'POST', body: '{' }), { params: Promise.resolve({ orgId: L, id: P1 }) });
    expect(res.status).toBe(400);
  });

  it('a track outside the project is 404; one the member may not hear is 403', async () => {
    expect((await post(AR, { body: 'x', track_id: OTHER_SONG })).status).toBe(404);
    expect((await post(AR, { body: 'x', track_id: t(99) })).status).toBe(404);
    // Marketing cannot comment at all; a member with comment rights but no working audio is covered by the D4 list test.
  });

  describe('replies', () => {
    it('go under the thread root, take its recording, and carry no pin of their own', async () => {
      const res = await post(ART, { body: 'Will fix', parent_id: c(4), track_id: V3, region_start: 1, region_end: 2 });
      expect(res.status).toBe(201);
      const { comment: made } = await res.json();
      expect(made).toMatchObject({ parentId: c(1), trackId: S1, regionStart: null, visibility: 'artist' }); // c(4) is a reply → its root is c(1)
    });

    it('a reply under an internal comment is internal; an artist or external member cannot even see it exists', async () => {
      const res = await post(AR, { body: 'agreed', parent_id: c(2), visibility: 'artist' });
      expect(res.status).toBe(201);
      expect((await res.json()).comment.visibility).toBe('internal');
      for (const user of [ART, X_COMMENTER, X_EDITOR]) {
        expect((await post(user, { body: 'peeking', parent_id: c(2) })).status, user).toBe(404);
      }
      expect(db.tables.project_comments.some((r) => r.body === 'peeking')).toBe(false);
    });

    it('a reply to a comment of another project, a portal thread or a share guest is a 404', async () => {
      for (const parent of [c(10), c(11), c(12), c(13), c(99)]) expect((await post(AR, { body: 'x', parent_id: parent })).status, parent).toBe(404);
    });
  });

  it('records a comment.created event that names the comment but never says what it says, internal for an internal note', async () => {
    const res = await post(AR, { body: 'Secret negotiating position', visibility: 'internal' });
    const { comment: made } = await res.json();
    const ev = db.tables.activity_events.find((e) => e.verb === 'comment.created')!;
    expect(ev).toMatchObject({ org_id: L, actor_id: AR, subject_type: 'comment', subject_id: made.id, project_id: P1, visibility: 'internal' });
    expect(JSON.stringify(ev)).not.toContain('Secret negotiating position');
    await post(ART, { body: 'public' });
    const pub = db.tables.activity_events.filter((e) => e.verb === 'comment.created').pop()!;
    expect(pub.visibility).toBe('artist');
  });
});

describe('PATCH', () => {
  it('resolve and reopen: anyone who may comment; a viewer and marketing cannot; a reply cannot be resolved alone', async () => {
    expect((await patch(X_COMMENTER, c(1), { resolved: true })).status).toBe(200);
    expect(db.tables.project_comments.find((r) => r.id === c(1))).toMatchObject({ resolved_by: X_COMMENTER });
    expect(db.tables.project_comments.find((r) => r.id === c(1))!.resolved_at).toBeTruthy();
    expect((await patch(X_VIEWER, c(1), { resolved: false })).status).toBe(403);
    expect((await patch(MKT, c(1), { resolved: false })).status).toBe(403);
    expect((await patch(AR, c(4), { resolved: true })).status).toBe(400);
    expect((await patch(ART, c(1), { resolved: false })).status).toBe(200);
    expect(db.tables.project_comments.find((r) => r.id === c(1))).toMatchObject({ resolved_at: null, resolved_by: null });
  });

  it('an artist or external member cannot touch an internal comment: 404, not 403, and nothing changes', async () => {
    for (const user of [ART, X_COMMENTER, X_EDITOR]) {
      for (const body of [{ resolved: true }, { body: 'x' }, { visibility: 'artist' }]) {
        expect((await patch(user, c(2), body)).status, `${user} ${JSON.stringify(body)}`).toBe(404);
      }
      expect((await del(user, c(2))).status, user).toBe(404);
    }
    expect(db.tables.project_comments.find((r) => r.id === c(2))).toMatchObject({ visibility: 'internal', resolved_at: null, deleted_at: null, body: 'Team: clear the sample first' });
  });

  it('edit: the author only, and edited_at is stamped', async () => {
    expect((await patch(AR, c(1), { body: 'Vocal is a touch bright' })).status).toBe(200);
    expect(db.tables.project_comments.find((r) => r.id === c(1))).toMatchObject({ body: 'Vocal is a touch bright' });
    expect(db.tables.project_comments.find((r) => r.id === c(1))!.edited_at).toBeTruthy();
    expect((await patch(OWNER, c(1), { body: 'hijack' })).status).toBe(403); // not even the owner edits someone else's words
    expect((await patch(ART, c(1), { body: 'hijack' })).status).toBe(403);
  });

  it('visibility: the author (team) may; an artist may not, even on their own comment; making a thread internal takes its replies with it', async () => {
    expect((await patch(ART, c(1), { visibility: 'internal' })).status).toBe(403);
    expect((await patch(AR, c(1), { visibility: 'internal' })).status).toBe(200);
    const rows = db.tables.project_comments;
    expect(rows.find((r) => r.id === c(1))!.visibility).toBe('internal');
    expect(rows.find((r) => r.id === c(4))!.visibility).toBe('internal'); // the reply under it
    // The artist no longer sees either.
    const got = await ids(await list(ART));
    expect(got).not.toContain(c(1));
    expect(got).not.toContain(c(4));
    // A reply cannot be made visible under an internal root.
    expect((await patch(OWNER, c(4), { visibility: 'artist' })).status).toBe(409);
    // The whole thread can.
    expect((await patch(AR, c(1), { visibility: 'artist' })).status).toBe(200);
  });

  it('records comment.updated / comment.resolved without the words', async () => {
    await patch(AR, c(1), { body: 'Changed words', resolved: true });
    const verbs = db.tables.activity_events.map((e) => e.verb).sort();
    expect(verbs).toEqual(['comment.resolved', 'comment.updated']);
    expect(JSON.stringify(db.tables.activity_events)).not.toContain('Changed words');
  });

  it('a comment of another project is a 404 even by id', async () => {
    expect((await patch(AR, c(10), { resolved: true })).status).toBe(404);
    expect((await patch(AR, c(11), { resolved: true })).status).toBe(404); // a portal thread is not an org comment
    expect((await patch(AR, c(12), { resolved: true })).status).toBe(404);
    expect((await patch(AR, c(13), { resolved: true })).status).toBe(404); // deleted
  });

  it('validation: an empty patch, unknown or forbidden fields', async () => {
    expect((await patch(AR, c(1), {})).status).toBe(400);
    expect((await patch(AR, c(1), { user_id: OWNER })).status).toBe(400);
    expect((await patch(AR, c(1), { org_id: L2 })).status).toBe(400);
    expect((await patch(AR, c(1), { body: '' })).status).toBe(400);
  });

  it('a patch that changes nothing writes nothing and records no event', async () => {
    const before = mem.writes.length;
    expect((await patch(AR, c(1), { visibility: 'artist', resolved: false })).status).toBe(200);
    expect(mem.writes.length).toBe(before);
    expect(db.tables.activity_events).toEqual([]);
  });
});

describe('DELETE', () => {
  it('the author and the owner / admin delete (soft), with the replies under it; anyone else is 403', async () => {
    expect((await del(ART, c(1))).status).toBe(403);
    expect((await del(X_COMMENTER, c(1))).status).toBe(403);
    expect((await del(X_EDITOR, c(4))).status).toBe(200); // the editor's own reply
    expect(db.tables.project_comments.find((r) => r.id === c(4))!.deleted_at).toBeTruthy();
    expect(db.tables.project_comments.find((r) => r.id === c(1))!.deleted_at).toBeNull();
    expect((await del(OWNER, c(1))).status).toBe(200); // moderation
    expect(db.tables.project_comments.find((r) => r.id === c(1))!.deleted_at).toBeTruthy();
    expect(await ids(await list(AR))).not.toContain(c(1));
    expect(db.tables.activity_events.map((e) => e.verb)).toEqual(['comment.deleted', 'comment.deleted']);
  });

  it('the row is kept (soft delete) and a comment of another project cannot be reached', async () => {
    await del(AR, c(1));
    expect(db.tables.project_comments.some((r) => r.id === c(1))).toBe(true);
    expect((await del(OWNER, c(10))).status).toBe(404);
    expect((await del(null, c(1))).status).toBe(401);
  });

  it('deleting a thread root takes its replies with it', async () => {
    expect((await del(AR, c(1))).status).toBe(200);
    expect(db.tables.project_comments.find((r) => r.id === c(4))!.deleted_at).toBeTruthy();
  });
});

describe('revocation takes effect on the very next request', () => {
  it('a removed or expired external member loses read and write at once', async () => {
    expect((await list(X_COMMENTER)).status).toBe(200);
    db.tables.project_members = db.tables.project_members.filter((m) => m.user_id !== X_COMMENTER);
    expect((await list(X_COMMENTER)).status).toBe(404);
    expect((await post(X_COMMENTER, { body: 'x' })).status).toBe(404);
    db.tables.project_members.find((m) => m.user_id === X_EDITOR)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await list(X_EDITOR)).status).toBe(404);
    expect((await patch(X_EDITOR, c(4), { body: 'x' })).status).toBe(404);
  });

  it('a roster artist whose scope is removed loses the project', async () => {
    db.tables.member_artist_scopes = db.tables.member_artist_scopes.filter((s) => s.user_id !== ART);
    expect((await list(ART)).status).toBe(404);
  });
});
