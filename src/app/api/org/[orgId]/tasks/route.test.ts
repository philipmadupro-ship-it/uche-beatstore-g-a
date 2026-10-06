/**
 * Org tasks (LABEL-23) through the REAL lib/auth/org-access, tasks(-store),
 * notify and activity against an in-memory database that evaluates filters,
 * so a leak (another side's task, another org's, a notification to the wrong
 * person) is a failing assertion.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project (project_contacts
 *     C1) with song S1 and release R1. LP2: Kilo's Inbox with song S2 and release R2.
 *     Members: OWN (owner), AR and AR2 (A&R, whole org), MKT (marketing, whole org),
 *     AR_C2 (A&R scoped to Kilo), ART (roster artist Nova — no tasks.write).
 *   L2: owner X, song XS1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const AR2 = u(3);
const MKT = u(4);
const AR_C2 = u(5);
const ART = u(6);
const X = u(7);
const STRANGER = u(8);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const S2 = t(2);
const XS1 = t(3);
const BEAT = t(4);
const R1 = '60000000-0000-4000-8000-000000000001';
const R2 = '60000000-0000-4000-8000-000000000002';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => memoryAdmin(db).client,
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({
  org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});
const track = (id: string, org: string | null, type: string, title: string) => ({ id, org_id: org, user_id: org ? null : OWN, type, title, song_stage: type === 'song' ? (id === S1 ? 'selected' : 'inbox') : null });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(AR2, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(ART, 'artist', [], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: BEAT, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [track(S1, L, 'song', 'Midnight'), track(S2, L, 'song', 'Dawn'), track(XS1, L2, 'song', 'Xen single'), track(BEAT, L, 'beat', 'A beat')],
      releases: [
        { id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Nova single' },
        { id: R2, org_id: L, project_id: LP2, contact_id: C2, title: 'Kilo single' },
      ],
      tasks: [],
      notifications: [],
      activity_events: [],
      song_beats: [],
      track_links: [],
      user_profiles: [
        { user_id: OWN, display_name: 'Owner' },
        { user_id: AR, display_name: 'Ada' },
        { user_id: MKT, display_name: 'Max' },
      ],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(file: 'list' | 'item' | 'assignees', method: string, as: string | null, opts: { org?: string; taskId?: string; query?: string; body?: unknown } = {}) {
  current = as;
  const org = opts.org ?? L;
  const mod = (await (file === 'list' ? import('./route') : file === 'item' ? import('./[taskId]/route') : import('./assignees/route'))) as unknown as Record<string, Handler>;
  const path = file === 'item' ? `/tasks/${opts.taskId}` : file === 'assignees' ? '/tasks/assignees' : '/tasks';
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const req = new NextRequest(`https://app.test/api/org/${org}${path}${opts.query ?? ''}`, {
    method,
    ...(hasBody ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) } : {}),
  });
  return mod[method](req, { params: Promise.resolve({ orgId: org, ...(opts.taskId ? { taskId: opts.taskId } : {}) }) });
}
const create = (as: string | null, body: unknown, org = L) => call('list', 'POST', as, { body, org });
const mine = (as: string | null) => call('list', 'GET', as, { query: '?view=mine' });
const onObject = (as: string | null, kind: string, id: string) => call('list', 'GET', as, { query: `?kind=${kind}&id=${id}` });
const ids = async (res: Response) => ((await res.json()).tasks as { title: string }[]).map((x) => x.title).sort();
const tasks = () => db.tables.tasks;
const notes = () => db.tables.notifications;
const events = () => db.tables.activity_events;

describe('POST: create and assign', () => {
  it('assigning a task notifies ONLY the assignee (acceptance)', async () => {
    const res = await create(AR, { title: 'Clear the sample', assignee_id: MKT, target: { kind: 'song', id: S1 } });
    expect(res.status).toBe(201);
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ org_id: L, title: 'Clear the sample', assignee_id: MKT, created_by: AR, song_id: S1, artist_id: null, project_id: null, release_id: null });
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatchObject({ user_id: MKT, org_id: L, kind: 'task_assigned', title: 'Ada assigned you a task', body: 'Clear the sample', read: false });
    expect(notes()[0].data).toEqual({ taskId: tasks()[0].id, target: { kind: 'song', id: S1 } });
    // Nobody else — not the owner, not the maker, not another A&R — hears of it.
    expect(notes().filter((n) => [OWN, AR, AR2, ART, AR_C2].includes(n.user_id as string))).toEqual([]);
  });

  it('an asker with no name is "Someone", never an email or a placeholder member', async () => {
    // AR2 has no user_profiles row (and no creator profile): there is nothing to call them.
    expect((await create(AR2, { title: 'Nameless', assignee_id: MKT })).status).toBe(201);
    expect(notes()[0]).toMatchObject({ user_id: MKT, title: 'Someone assigned you a task' });
    expect(JSON.stringify(notes()[0])).not.toMatch(/@/);
  });

  it('a task for yourself, or for nobody, asks nobody', async () => {
    expect((await create(AR, { title: 'Mine', assignee_id: AR })).status).toBe(201);
    expect((await create(AR, { title: 'Nobody’s' })).status).toBe(201);
    expect(tasks()).toHaveLength(2);
    expect(notes()).toEqual([]);
  });

  it('can hang on an artist, a project, a song, a release or nothing — and only one', async () => {
    for (const target of [{ kind: 'artist', id: C1 }, { kind: 'project', id: LP1 }, { kind: 'song', id: S1 }, { kind: 'release', id: R1 }, null]) {
      expect((await create(AR, { title: `On ${target?.kind ?? 'org'}`, target })).status, String(target?.kind)).toBe(201);
    }
    const cols = ['artist_id', 'project_id', 'song_id', 'release_id'];
    for (const row of tasks()) expect(cols.filter((c) => row[c] != null).length).toBeLessThanOrEqual(1);
    // Two objects at once is not expressible, and extra keys are refused.
    expect((await create(AR, { title: 'Two', target: { kind: 'song', id: S1, also: LP1 } })).status).toBe(400);
    expect((await create(AR, { title: 'Two', song_id: S1, project_id: LP1 })).status).toBe(400);
  });

  it('refuses an empty title, a bad due date and an unknown kind', async () => {
    expect((await create(AR, { title: '   ' })).status).toBe(400);
    expect((await create(AR, { title: 'x', due_at: 'tomorrow' })).status).toBe(400);
    expect((await create(AR, { title: 'x', target: { kind: 'beat', id: S1 } })).status).toBe(400);
    expect((await create(AR, { title: 'x'.repeat(201) })).status).toBe(400);
    expect(tasks()).toEqual([]);
  });

  it('needs tasks.write: a roster artist, a stranger and a signed-out caller are refused; nothing is written', async () => {
    expect((await create(ART, { title: 'x' })).status).toBe(403);
    expect((await create(STRANGER, { title: 'x' })).status).toBe(403);
    expect((await create(X, { title: 'x' })).status).toBe(403); // owner of ANOTHER org
    expect((await create(null, { title: 'x' })).status).toBe(401);
    expect(tasks()).toEqual([]);
    expect(notes()).toEqual([]);
  });

  it('the creator must reach the object: out of scope and other-org objects are 404, a beat is not a song', async () => {
    expect((await create(AR_C2, { title: 'x', target: { kind: 'song', id: S1 } })).status).toBe(404); // Nova's song, Kilo-scoped member
    expect((await create(AR_C2, { title: 'x', target: { kind: 'artist', id: C1 } })).status).toBe(404);
    expect((await create(AR_C2, { title: 'x', target: { kind: 'song', id: S2 } })).status).toBe(201);
    expect((await create(AR, { title: 'x', target: { kind: 'song', id: XS1 } })).status).toBe(404); // another org's song
    expect((await create(AR, { title: 'x', target: { kind: 'song', id: BEAT } })).status).toBe(404); // a beat
    expect((await create(AR, { title: 'x', target: { kind: 'project', id: XP1 } })).status).toBe(404);
    expect(tasks()).toHaveLength(1);
  });

  it('the assignee must reach it too: out of scope, another org and non-members are refused — and nobody is notified', async () => {
    // AR_C2 sees only Kilo: handing them a task on Nova's song would leak the song's name.
    expect((await create(AR, { title: 'x', assignee_id: AR_C2, target: { kind: 'song', id: S1 } })).status).toBe(400);
    expect((await create(AR, { title: 'x', assignee_id: X })).status).toBe(400); // a member of another org
    expect((await create(AR, { title: 'x', assignee_id: STRANGER })).status).toBe(400);
    expect(tasks()).toEqual([]);
    expect(notes()).toEqual([]);
    // D4: marketing never reads a working demo (S2 is an Inbox demo), so it is not handed a task naming it.
    expect((await create(AR, { title: 'x', assignee_id: MKT, target: { kind: 'song', id: S2 } })).status).toBe(400);
    expect(tasks()).toEqual([]);
    // In scope it works, and the scoped member is asked.
    expect((await create(AR, { title: 'y', assignee_id: AR_C2, target: { kind: 'song', id: S2 } })).status).toBe(201);
    expect(notes().map((n) => n.user_id)).toEqual([AR_C2]);
  });

  it('records task.created without the title, internal-only, naming the song, its project and its artist', async () => {
    await create(AR, { title: 'Secret plan for the album', assignee_id: MKT, target: { kind: 'song', id: S1 } });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ org_id: L, verb: 'task.created', visibility: 'internal', subject_type: 'task', song_id: S1, project_id: LP1, artist_id: C1 });
    expect(JSON.stringify(events()[0])).not.toContain('Secret plan');
  });
});

describe('GET: each side its own tasks', () => {
  beforeEach(async () => {
    // AR hands MKT a task on S1; MKT hands AR one on S1; AR keeps one for themself on S1.
    await create(AR, { title: 'AR→MKT', assignee_id: MKT, target: { kind: 'song', id: S1 } });
    await create(MKT, { title: 'MKT→AR', assignee_id: AR, target: { kind: 'song', id: S1 } });
    await create(AR, { title: 'AR self', assignee_id: AR, target: { kind: 'song', id: S1 } });
    notes().length = 0;
  });

  it('"My work" is what is assigned to me, nothing else', async () => {
    expect(await ids(await mine(AR))).toEqual(['AR self', 'MKT→AR']);
    expect(await ids(await mine(MKT))).toEqual(['AR→MKT']);
    expect(await ids(await mine(AR2))).toEqual([]);
  });

  it('"Waiting on others" is what I handed to someone else — not what I keep for myself', async () => {
    expect(await ids(await call('list', 'GET', AR, { query: '?view=asked' }))).toEqual(['AR→MKT']);
    expect(await ids(await call('list', 'GET', MKT, { query: '?view=asked' }))).toEqual(['MKT→AR']);
  });

  it('on an object a member sees their own side only; an owner sees all; another A&R sees none', async () => {
    expect(await ids(await onObject(AR, 'song', S1))).toEqual(['AR self', 'AR→MKT', 'MKT→AR']);
    expect(await ids(await onObject(MKT, 'song', S1))).toEqual(['AR→MKT', 'MKT→AR']);
    expect(await ids(await onObject(AR2, 'song', S1))).toEqual([]);
    expect(await ids(await onObject(OWN, 'song', S1))).toEqual(['AR self', 'AR→MKT', 'MKT→AR']);
    expect(await ids(await onObject(ART, 'song', S1))).toEqual([]); // the song's own artist, not a party to any task
  });

  it('another org, a stranger and a signed-out caller read nothing', async () => {
    expect((await call('list', 'GET', X, { query: '?view=mine' })).status).toBe(403);
    expect((await call('list', 'GET', STRANGER, { query: '?view=mine' })).status).toBe(403);
    expect((await call('list', 'GET', null, { query: '?view=mine' })).status).toBe(401);
    // X is the owner of L2: their view of L2 is empty, whatever the ids.
    expect(await ids(await call('list', 'GET', X, { org: L2, query: '?view=mine' }))).toEqual([]);
  });

  it('a scoped member loses a task the moment its object leaves their scope', async () => {
    await create(AR, { title: 'Kilo thing', assignee_id: AR_C2, target: { kind: 'release', id: R2 } });
    expect(await ids(await mine(AR_C2))).toEqual(['Kilo thing']);
    db.tables.member_artist_scopes = [];
    expect(await ids(await mine(AR_C2))).toEqual([]);
  });

  it('refuses a request that names neither a view nor an object', async () => {
    expect((await call('list', 'GET', AR)).status).toBe(400);
    expect((await call('list', 'GET', AR, { query: '?kind=song' })).status).toBe(400);
    expect((await call('list', 'GET', AR, { query: '?kind=song&id=nope' })).status).toBe(400);
  });

  it('is built field by field: names, no emails, no org id, no table columns beyond the view', async () => {
    const body = await (await mine(MKT)).json();
    expect(Object.keys(body.tasks[0]).sort()).toEqual(['assignee', 'canChange', 'canDelete', 'createdAt', 'createdBy', 'doneAt', 'dueAt', 'id', 'mine', 'notes', 'target', 'title']);
    expect(body.tasks[0]).toMatchObject({ assignee: { id: MKT, name: 'Max' }, createdBy: { id: AR, name: 'Ada' }, mine: true, canChange: true, canDelete: false });
    expect(JSON.stringify(body)).not.toContain(L);
  });
});

describe('PATCH / DELETE', () => {
  let id: string;
  beforeEach(async () => {
    await create(AR, { title: 'Clear the sample', assignee_id: MKT, target: { kind: 'song', id: S1 } });
    id = tasks()[0].id as string;
    notes().length = 0;
    events().length = 0;
  });

  it('the assignee ticks it off and back; no one is notified; the events say completed / updated', async () => {
    const done = await call('item', 'PATCH', MKT, { taskId: id, body: { done: true } });
    expect(done.status).toBe(200);
    expect(tasks()[0]).toMatchObject({ done_by: MKT });
    expect(tasks()[0].done_at).toBeTruthy();
    expect(events().map((e) => e.verb)).toEqual(['task.completed']);
    expect((await call('item', 'PATCH', MKT, { taskId: id, body: { done: false } })).status).toBe(200);
    expect(tasks()[0].done_at ?? null).toBeNull();
    expect(events().map((e) => e.verb)).toEqual(['task.completed', 'task.updated']);
    expect(notes()).toEqual([]);
  });

  it('a no-op change records nothing', async () => {
    expect((await call('item', 'PATCH', MKT, { taskId: id, body: { done: false } })).status).toBe(200);
    expect(events()).toEqual([]);
  });

  it('a member who is not a party cannot see it: 404, not 403; an owner can', async () => {
    expect((await call('item', 'PATCH', AR2, { taskId: id, body: { done: true } })).status).toBe(404);
    expect((await call('item', 'DELETE', AR2, { taskId: id })).status).toBe(404);
    expect((await call('item', 'PATCH', ART, { taskId: id, body: { done: true } })).status).toBe(404);
    expect(tasks()[0].done_at ?? null).toBeNull();
    expect((await call('item', 'PATCH', OWN, { taskId: id, body: { title: 'Renamed' } })).status).toBe(200);
  });

  it('another org, a stranger, signed out, a bad id and an unknown task are refused', async () => {
    expect((await call('item', 'PATCH', X, { taskId: id, body: { done: true } })).status).toBe(403);
    expect((await call('item', 'PATCH', X, { org: L2, taskId: id, body: { done: true } })).status).toBe(404); // the id of L's task, asked through L2
    expect((await call('item', 'PATCH', STRANGER, { taskId: id, body: { done: true } })).status).toBe(403);
    expect((await call('item', 'PATCH', null, { taskId: id, body: { done: true } })).status).toBe(401);
    expect((await call('item', 'PATCH', AR, { taskId: 'nope', body: { done: true } })).status).toBe(404);
    expect((await call('item', 'PATCH', AR, { taskId: '60000000-0000-4000-8000-0000000000ff', body: { done: true } })).status).toBe(404);
    expect((await call('item', 'PATCH', AR, { taskId: id, body: {} })).status).toBe(400);
    expect(tasks()[0].done_at ?? null).toBeNull();
  });

  it('reassigning asks the NEW assignee only; the old one and the actor hear nothing', async () => {
    expect((await call('item', 'PATCH', AR, { taskId: id, body: { assignee_id: AR2 } })).status).toBe(200);
    expect(tasks()[0].assignee_id).toBe(AR2);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatchObject({ user_id: AR2, org_id: L, kind: 'task_assigned' });
    // Keeping the same assignee is not an ask.
    notes().length = 0;
    expect((await call('item', 'PATCH', AR, { taskId: id, body: { assignee_id: AR2, title: 'Again' } })).status).toBe(200);
    expect(notes()).toEqual([]);
    // An owner who is neither maker nor assignee reassigning is still named, not "Someone".
    notes().length = 0;
    expect((await call('item', 'PATCH', OWN, { taskId: id, body: { assignee_id: MKT } })).status).toBe(200);
    expect(notes()[0]).toMatchObject({ user_id: MKT, title: 'Owner assigned you a task' });
  });

  it('reassigning needs tasks.write and a member who can reach the object', async () => {
    // The assignee (marketing) may hand it on; a roster artist who holds a task may tick it but not hand it on.
    db.tables.tasks.push({ id: '70000000-0000-4000-8000-000000000001', org_id: L, title: 'Artist task', assignee_id: ART, created_by: AR, song_id: S1, artist_id: null, project_id: null, release_id: null, created_at: '2026-10-02', done_at: null });
    const aid = '70000000-0000-4000-8000-000000000001';
    expect((await call('item', 'PATCH', ART, { taskId: aid, body: { assignee_id: AR2 } })).status).toBe(403);
    expect((await call('item', 'PATCH', ART, { taskId: aid, body: { done: true } })).status).toBe(200);
    // Out of scope: AR_C2 cannot reach Nova's song.
    expect((await call('item', 'PATCH', AR, { taskId: id, body: { assignee_id: AR_C2 } })).status).toBe(400);
    expect(tasks().find((x) => x.id === id)!.assignee_id).toBe(MKT);
    expect(notes()).toEqual([]);
  });

  it('only the maker (or an owner/admin) deletes: the assignee gets 403', async () => {
    expect((await call('item', 'DELETE', MKT, { taskId: id })).status).toBe(403);
    expect(tasks()).toHaveLength(1);
    expect((await call('item', 'DELETE', AR, { taskId: id })).status).toBe(200);
    expect(tasks()).toEqual([]);
    expect(events().map((e) => e.verb)).toEqual(['task.deleted']);
  });
});

describe('assignees', () => {
  it('lists the members who can take a task on the object, by name, no emails', async () => {
    const res = await call('assignees', 'GET', AR, { query: `?kind=song&id=${S1}` });
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as { members: { id: string; name: string }[] };
    // Nova's song: the whole-org members and Nova (a roster artist whose scope reaches it). Not Kilo's A&R, not L2's owner.
    expect(members.map((m) => m.id).sort()).toEqual([OWN, AR, AR2, MKT, ART].sort());
    expect(members.find((m) => m.id === AR)!.name).toBe('Ada');
    expect(JSON.stringify(members)).not.toContain('@');
    const org = await (await call('assignees', 'GET', AR)).json();
    expect(org.members.map((m: { id: string }) => m.id).sort()).toEqual([OWN, AR, AR2, MKT, AR_C2, ART].sort());
  });

  it('needs tasks.write and reaches no further than the caller: out-of-scope object is 404', async () => {
    expect((await call('assignees', 'GET', ART)).status).toBe(403);
    expect((await call('assignees', 'GET', AR_C2, { query: `?kind=song&id=${S1}` })).status).toBe(404);
    expect((await call('assignees', 'GET', X)).status).toBe(403);
  });
});
