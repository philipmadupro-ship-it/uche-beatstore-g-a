/**
 * GET /api/org/[orgId]/attention (LABEL-35), through the REAL
 * lib/auth/org-access, attention-store, release-readiness(-store), tasks-store
 * and org-workspace (D4) against an in-memory database that evaluates every
 * filter, so a missing org filter, scope walk or D4 check fails here.
 *
 *   L (label), "now" = 2026-10-13: artists C1 (Nova) and C2 (Kilo).
 *     LP1 = Nova's project: S1 (in development, last moved 2026-09-02, on R1),
 *     S3 (in development since it was made, on no release), master M1.
 *     LP2 = Kilo's Inbox: S2 (in review since 2026-08-01, on R2).
 *     R1 Nova EP (target 2026-11-05) and R2 Kilo single (2026-11-01) are blocked
 *     drafts; R3 is blocked but a year out.
 *     Tasks: T1 (assigned AR, on S1) and T2 (assigned MKT) overdue; T3 not due.
 *   Members: owner, A&R, marketing (finished audio only), A&R scoped to C2.
 *   L2: song XS1, release RX. The producer: PT1 (org_id NULL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const AR_C2 = u(5);
const X = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const CX = '30000000-0000-4000-8000-0000000000c3';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1);
const M1 = t(2);
const S2 = t(3);
const XS1 = t(4);
const S3 = t(5);
const PT1 = t(6);
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const R3 = '70000000-0000-4000-8000-000000000004';
const RX = '70000000-0000-4000-8000-000000000003';
const P1 = '90000000-0000-4000-8000-000000000001';
const A1 = '60000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
let missing = new Set<string>();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (!missing.has(table)) return mem.client.from(table);
      const res = { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST205' } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'lt', 'lte', 'order', 'limit', 'range']) q[m] = () => q;
      q.maybeSingle = async () => res;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return q;
    },
    rpc: (name: string, args: Record<string, unknown>) => mem.client.rpc(name, args),
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function track(id: string, org: string | null, type: string, title: string, song_stage: string | null, created_at = '2026-08-01T00:00:00Z') {
  return { id, org_id: org, user_id: org ? null : OWN, created_by: AR, type, title, song_stage, isrc: null, created_at };
}
function release(id: string, org: string, project: string, contact: string, title: string, target_date: string | null) {
  return {
    id, org_id: org, project_id: project, contact_id: contact, title, type: 'single', upc: null, label_name: null, c_line: null, p_line: null,
    primary_genre: null, target_date, release_date: null, artwork_asset_id: null, state: 'draft', created_by: OWN,
  };
}
const task = (id: string, assignee: string, due: string | null, extra: Record<string, unknown> = {}) => ({
  id, org_id: L, title: `Task ${id.slice(-1)}`, notes: null, due_at: due, done_at: null, assignee_id: assignee, created_by: OWN,
  artist_id: null, project_id: null, song_id: null, release_id: null, created_at: '2026-10-01T00:00:00Z', ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missing = new Set();
  db = {
    tables: {
      organizations: [
        { id: L, slug: 'north-star', kind: 'label', deleted_at: null, settings: {} },
        { id: L2, slug: 'other', kind: 'label', deleted_at: null, settings: {} },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: CX, org_id: L2, user_id: null, name: 'Xen', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: OWN }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: M1, position: 1 },
        { project_id: LP1, track_id: S3, position: 2 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight', 'in_development'),
        track(M1, L, 'song', 'Midnight (master)', null),
        track(S2, L, 'song', 'Dawn', 'in_review'),
        track(S3, L, 'song', 'Secret demo', 'in_development'),
        track(XS1, L2, 'song', 'Xen single', 'in_development'),
        track(PT1, null, 'song', 'Producer song', null),
      ],
      track_links: [{ from_track_id: S1, to_track_id: M1, relation: 'master', user_id: null }],
      song_beats: [],
      project_assets: [{ id: A1, project_id: LP1, org_id: L, kind: 'artwork', mime: 'image/png', sensitivity: 'normal' }],
      parties: [{ id: P1, org_id: L, kind: 'person', display_name: 'Nova', legal_name: null, ipi: null, pro: null, pro_affiliation: 'unknown', publisher_name: null, user_id: null, contact_id: null }],
      track_collaborators: [{ id: 'c1', org_id: L, track_id: S1, name: 'Nova', role: 'songwriter', source: 'manual', scope: 'composition', status: 'confirmed', party_id: P1, created_at: '2026-10-01' }],
      split_sheets: [],
      split_lines: [],
      approvals: [
        { id: 'ap1', org_id: L, song_id: null, release_id: R1, gate: 'legal', decision: 'requested', note: null, actor_id: OWN, approver_id: AR, request_id: null, subject_snapshot: {}, created_at: '2026-10-05T00:00:00Z' },
      ],
      releases: [
        release(R1, L, LP1, C1, 'Nova EP', '2026-11-05'),
        release(R2, L, LP2, C2, 'Kilo single', '2026-11-01'),
        release(R3, L, LP1, C1, 'Far away', '2027-10-13'),
        release(RX, L2, XP1, CX, 'Xen EP', '2026-10-20'),
      ],
      release_items: [
        { id: 'ri1', release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: M1, version_title: null, explicit: false },
        { id: 'ri2', release_id: R2, org_id: L, position: 1, song_track_id: S2, master_track_id: S2, version_title: null, explicit: false },
        { id: 'riX', release_id: RX, org_id: L2, position: 1, song_track_id: XS1, master_track_id: XS1, version_title: null, explicit: false },
      ],
      activity_events: [
        { id: 'e1', org_id: L, actor_id: AR, verb: 'song.stage_changed', song_id: S1, payload: { from: 'shortlisted', to: 'in_development' }, created_at: '2026-09-02T08:00:00Z' },
      ],
      tasks: [
        task('70000000-0000-4000-8000-000000000001', AR, '2026-10-08T00:00:00Z', { song_id: S1 }),
        task('70000000-0000-4000-8000-000000000002', MKT, '2026-10-10T00:00:00Z'),
        task('70000000-0000-4000-8000-000000000003', AR, '2026-10-30T00:00:00Z'),
      ],
      user_profiles: [
        { user_id: OWN, display_name: 'Owner' },
        { user_id: AR, display_name: 'Ada' },
        { user_id: MKT, display_name: 'Max' },
      ],
    },
  };
  mem = memoryAdmin(db);
});
afterEach(() => vi.useRealTimers());

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function read(as: string | null, org = L) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/attention`), { params: Promise.resolve({ orgId: org }) });
}
const titles = (a: { items: { title: string }[] }) => a.items.map((i) => i.title);

describe('the owner’s list', () => {
  it('blocked releases near their date, stalled songs and everyone’s overdue tasks, in order', async () => {
    const res = await read(OWN);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { attention } = await res.json();
    expect(attention.releasesReady).toBe(true);
    expect(attention.restricted).toBe(0);
    expect(titles(attention)).toEqual(['Kilo single', 'Nova EP', 'Dawn', 'Secret demo', 'Midnight', '1 overdue task', '1 overdue task']);
    const ep = attention.items.find((i: { title: string }) => i.title === 'Nova EP');
    expect(ep.person.name).toBe('Ada'); // the legal approval was asked of Ada
    expect(ep.artistName).toBe('Nova');
    expect(ep.action.href).toBe(`/o/north-star/releases/${R1}`);
    const midnight = attention.items.find((i: { title: string }) => i.title === 'Midnight');
    expect(midnight.detail).toBe('In development for 41 days');
    expect(midnight.person.name).toBe('Ada'); // moved it into the stage
    expect(attention.items.find((i: { title: string }) => i.title === 'Secret demo').detail).toBe('In development for 73 days');
    for (const i of attention.items) {
      expect(i.person.name).toBeTruthy();
      expect(i.action.verb).toBeTruthy();
    }
  });

  it('a release a year out is not listed, and thresholds come from the org settings', async () => {
    expect(JSON.stringify((await (await read(OWN)).json()).attention)).not.toContain('Far away');
    db.tables.organizations[0].settings = { attention_release_days: 14, attention_stalled_days: 60, legal_gate: 'off' };
    const { attention } = await (await read(OWN)).json();
    expect(titles(attention)).toEqual(['Dawn', 'Secret demo', '1 overdue task', '1 overdue task']);
    db.tables.organizations[0].settings = { attention_release_days: 'soon', attention_stalled_days: -1 };
    expect(titles((await (await read(OWN)).json()).attention)).toContain('Nova EP');
  });

  it('writes nothing and records no event', async () => {
    await read(OWN);
    expect(mem.writes).toEqual([]);
  });
});

describe('artist scope', () => {
  it('a member scoped to Kilo sees only Kilo’s release and song, and no one else’s tasks', async () => {
    const { attention } = await (await read(AR_C2)).json();
    expect(titles(attention)).toEqual(['Kilo single', 'Dawn']);
    expect(JSON.stringify(attention)).not.toMatch(/Nova|Midnight|Secret/);
  });
});

describe('restricted counts (doc 21 #9)', () => {
  it('the marketing member of the next test, once limited to some artists, is told no count', async () => {
    db.tables.org_members.find((m) => m.user_id === MKT)!.scope = 'artists';
    db.tables.member_artist_scopes.push({ org_id: L, user_id: MKT, contact_id: C1 });
    const { attention } = await (await read(MKT)).json();
    expect(attention.restricted).toBe(0);
    expect(JSON.stringify(attention)).not.toContain('Secret demo');
  });
});

describe('D4 and task visibility', () => {
  it('marketing never reads a working demo: it is a count, not a title; its own task is listed', async () => {
    const { attention } = await (await read(MKT)).json();
    expect(attention.restricted).toBe(1);
    expect(JSON.stringify(attention)).not.toContain('Secret demo');
    expect(titles(attention)).toContain('Midnight'); // on a release: a finished row
    expect(attention.items.filter((i: { kind: string }) => i.kind === 'tasks').map((i: { person: { name: string } }) => i.person.name)).toEqual(['Max']);
  });

  it('a member sees overdue tasks they hold or made, not a colleague’s', async () => {
    const { attention } = await (await read(AR)).json();
    expect(attention.items.filter((i: { kind: string }) => i.kind === 'tasks').map((i: { person: { name: string } }) => i.person.name)).toEqual(['Ada']);
  });
});

describe('access', () => {
  it('signed out is 401; a stranger is refused and another org’s owner is refused and gets only their own org', async () => {
    expect((await read(null)).status).toBe(401);
    expect([403, 404]).toContain((await read(u(9))).status);
    const other = await read(X);
    expect([403, 404]).toContain(other.status);
    const own = await read(X, L2);
    expect(own.status).toBe(200);
    expect(JSON.stringify(await own.json())).not.toMatch(/Nova|Midnight|Kilo/);
  });
});

describe('migrations not applied', () => {
  it('missing tasks and activity contribute nothing; missing releases says so; none is a 500', async () => {
    missing.add('tasks');
    missing.add('activity_events');
    missing.add('releases');
    const res = await read(OWN);
    expect(res.status).toBe(200);
    const { attention } = await res.json();
    expect(attention.releasesReady).toBe(false);
    expect(titles(attention)).toEqual(['Midnight', 'Dawn', 'Secret demo']); // since = created_at, 2026-08-01 for all three
  });
});
