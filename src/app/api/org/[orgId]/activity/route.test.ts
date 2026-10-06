/**
 * GET /api/org/[orgId]/activity (LABEL-20), run through the REAL
 * lib/auth/org-access and lib/labelos/activity-store against an in-memory
 * database that evaluates every filter — so a missing org filter, scope walk,
 * visibility check or D4 rule returns the wrong events and fails here. The
 * SQL twin of the same rule (migration 147's policy) is asserted against a
 * real Postgres in supabase/local/checks/147_*.sql.
 *
 *   L (label): artists C1 (Nova) and C2 (Kilo).
 *     LP1 = Nova's project (project_contacts): S1 (selected), S3 (in review).
 *     LP2 = Kilo's Inbox: S2 (inbox — working material, D4).
 *   Members: owner, A&R (no business.read.internal), marketing (internal yes,
 *   finished audio only), A&R scoped to Kilo, roster artist Nova, and L2's owner.
 *   L2: artist D1, project XP1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const MKT = u(3);
const AR_C2 = u(4);
const ART_C1 = u(5);
const X = u(6);
const STRANGER = u(7);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const D1 = '30000000-0000-4000-8000-0000000000d1';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const S1 = '50000000-0000-4000-8000-000000000001';
const S3 = '50000000-0000-4000-8000-000000000005';
const S2 = '50000000-0000-4000-8000-000000000006';
const R1 = '60000000-0000-4000-8000-000000000001';
const ev = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mem.client.from(t) }) }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
const track = (id: string, org: string | null, type: string, title: string, song_stage: string | null) => ({
  id, org_id: org, user_id: org ? null : OWN, type, title, song_stage, cover_url: null, created_at: '2026-01-01', bpm: null, key: null, duration_seconds: 180, beat_track_id: null,
});

type EvOver = {
  n: number;
  verb: string;
  actor?: string | null;
  org?: string;
  artist?: string | null;
  project?: string | null;
  song?: string | null;
  release?: string | null;
  visibility?: 'artist' | 'internal';
  payload?: Record<string, unknown>;
};
function event(o: EvOver) {
  return {
    id: ev(o.n),
    org_id: o.org ?? L,
    actor_id: o.actor === undefined ? AR : o.actor,
    verb: o.verb,
    artist_id: o.artist ?? null,
    project_id: o.project ?? null,
    song_id: o.song ?? null,
    release_id: o.release ?? null,
    subject_type: 'track',
    subject_id: null,
    payload: o.payload ?? {},
    visibility: o.visibility ?? 'artist',
    created_at: `2026-10-05T10:${String(o.n).padStart(2, '0')}:00.000Z`,
  };
}

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
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(ART_C1, 'artist', [], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [
        { org_id: L, user_id: AR_C2, contact_id: C2 },
        { org_id: L, user_id: ART_C1, contact_id: C1 },
      ],
      user_profiles: [
        { user_id: OWN, display_name: 'Olive' },
        { user_id: AR, display_name: 'Ana' },
      ],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
        { id: D1, org_id: L2, user_id: null, name: 'L2 artist', category: 'artist' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2 },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }, { project_id: XP1, contact_id: D1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: S3, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight', 'selected'),
        track(S3, L, 'song', 'Dawn', 'in_review'),
        track(S2, L, 'song', 'Kilo demo', 'inbox'),
      ],
      song_beats: [],
      track_links: [],
      releases: [
        { id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Midnight EP', type: 'ep', state: 'draft', target_date: null, created_at: '2026-01-06' },
      ],
      release_items: [{ id: 'ri1', release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: S1, version_title: null, explicit: false }],
      activity_events: [
        event({ n: 1, verb: 'song.created', artist: C1, project: LP1, song: S1, payload: { title: 'Midnight', song_stage: 'selected' } }),
        event({ n: 2, verb: 'song.created', artist: C2, project: LP2, song: S2, payload: { title: 'Kilo demo', song_stage: 'inbox' } }),
        event({ n: 3, verb: 'file.uploaded', actor: OWN, project: LP1, payload: { kind: 'artwork', sensitivity: 'normal' } }),
        event({ n: 4, verb: 'file.uploaded', actor: OWN, project: LP2, payload: { kind: 'artwork', sensitivity: 'normal' } }),
        event({ n: 5, verb: 'member.removed', actor: OWN, visibility: 'internal', payload: { email: 'gone@example.com', role: 'member' } }),
        event({ n: 6, verb: 'release.updated', artist: C1, project: LP1, release: R1, payload: { items: 'reordered', count: 2 } }),
        event({ n: 7, verb: 'release.updated', artist: C1, project: LP1, release: R1, payload: { items: 'reordered', count: 2 } }),
        event({ n: 8, verb: 'org.settings_changed', actor: OWN, visibility: 'internal', payload: { fields: ['name'] } }),
        event({ n: 9, verb: 'file.uploaded', actor: OWN, artist: C1, project: LP1, visibility: 'internal', payload: { kind: 'contract', sensitivity: 'restricted' } }),
        event({ n: 10, verb: 'recording.uploaded', project: LP1, song: S1, payload: { relation: 'demo', type: 'song' } }),
        event({ n: 11, verb: 'song.created', org: L2, actor: X, artist: D1, project: XP1, payload: { title: 'L2 song' } }),
        event({ n: 12, verb: 'org.settings_changed', actor: null, visibility: 'artist', payload: {} }),
      ],
    },
    unique: { user_profiles: [['user_id']] },
  };
  mem = memoryAdmin(db);
});

async function feed(query = '', org = L) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://x/api/org/${org}/activity${query}`), { params: Promise.resolve({ orgId: org }) });
}
type Body = {
  events: { id: string; verb: string; artistId: string | null; projectId: string | null; summary: Record<string, unknown> }[];
  names: { actors: Record<string, string>; artists: Record<string, string>; releases: Record<string, string> };
  projectArtists: Record<string, string[]>;
  restricted: number;
  hasMore: boolean;
  nextBefore: string | null;
  asOf: string;
};
const ids = (b: Body) => b.events.map((e) => Number(e.id.slice(-12)));
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('GET /api/org/[orgId]/activity — the org overview feed', () => {
  it('the owner reads every event of the org, newest first, and nothing of L2', async () => {
    current = OWN;
    const res = await feed();
    expect(res.status).toBe(200);
    const b: Body = await res.json();
    expect(ids(b)).toEqual([12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(JSON.stringify(b)).not.toMatch(/L2 song|L2 artist/);
  });

  it('is built field by field: a whitelisted summary, names, no payload, no email', async () => {
    current = OWN;
    const b: Body = await (await feed()).json();
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/gone@example\.com|"payload"|sensitivity|relation|fields/);
    expect(b.events.find((e) => e.id === ev(1))).toMatchObject({ verb: 'song.created', summary: { title: 'Midnight', stage: 'selected' } });
    expect(b.events.find((e) => e.id === ev(6))?.summary).toEqual({ items: 'reordered' });
    expect(b.names.actors).toEqual({ [OWN]: 'Olive', [AR]: 'Ana' });
    expect(b.names.artists).toEqual({ [C1]: 'Nova', [C2]: 'Kilo' });
    expect(b.names.releases).toEqual({ [R1]: 'Midnight EP' });
    expect(b.projectArtists).toEqual({ [LP1]: [C1], [LP2]: [C2] });
    expect(Number.isNaN(Date.parse(b.asOf))).toBe(false);
  });

  it('A&R (no business.read.internal) gets artist events only: none of 5, 8, 9', async () => {
    current = AR;
    const b: Body = await (await feed()).json();
    expect(sorted(ids(b))).toEqual([1, 2, 3, 4, 6, 7, 10, 12]);
  });

  it('marketing (internal yes, working audio no): the demo’s events are counted, not listed (D4)', async () => {
    current = MKT;
    const b: Body = await (await feed()).json();
    expect(ids(b)).not.toContain(2);
    expect(b.restricted).toBe(1);
    expect(JSON.stringify(b)).not.toContain('Kilo demo');
    // The selected song's events and the internal ones are theirs.
    expect(ids(b)).toEqual(expect.arrayContaining([1, 5, 8, 9, 10]));
  });

  it('a roster artist does not see internal events — nor another artist’s, nor the organization’s own', async () => {
    current = ART_C1;
    const b: Body = await (await feed()).json();
    // Nova's: 1 (artist), 3 (file in her project), 6 and 7 (her release), 10 (recording in her project).
    expect(sorted(ids(b))).toEqual([1, 3, 6, 7, 10]);
    const verbs = b.events.map((e) => e.verb);
    expect(verbs).not.toContain('member.removed');
    expect(verbs).not.toContain('org.settings_changed');
    expect(ids(b)).not.toContain(9); // the restricted file: internal, though it is Nova's
    expect(JSON.stringify(b)).not.toMatch(/Kilo|gone@example/);
  });

  it('an A&R limited to Kilo does not see Nova’s events, names or release — through the route', async () => {
    current = AR_C2;
    const b: Body = await (await feed()).json();
    expect(sorted(ids(b))).toEqual([2, 4]);
    expect(JSON.stringify(b)).not.toMatch(/Nova|Midnight/);
    expect(b.names.artists).toEqual({ [C2]: 'Kilo' });
    expect(b.projectArtists).toEqual({ [LP2]: [C2] });
  });

  it('files a project shared by two artists under the ones the member holds', async () => {
    db.tables.project_contacts.push({ project_id: LP1, contact_id: C2, user_id: null });
    current = AR_C2;
    const b: Body = await (await feed()).json();
    // LP1 is now Kilo's too: the file event (3) is theirs, and filed under Kilo — never named Nova.
    expect(ids(b)).toContain(3);
    expect(b.projectArtists[LP1]).toEqual([C2]);
    expect(JSON.stringify(b.names)).not.toContain('Nova');
  });

  it('a member limited to no artists reads nothing, not an error', async () => {
    db.tables.member_artist_scopes = [];
    current = AR_C2;
    const res = await feed();
    expect(res.status).toBe(200);
    expect((await res.json()).events).toEqual([]);
  });

  it('follows the CURRENT scope: widening a member shows the history they could not see before', async () => {
    current = AR_C2;
    expect(sorted(ids(await (await feed()).json()))).toEqual([2, 4]);
    db.tables.member_artist_scopes.push({ org_id: L, user_id: AR_C2, contact_id: C1 });
    expect(sorted(ids(await (await feed()).json()))).toEqual([1, 2, 3, 4, 6, 7, 10]);
  });

  it('narrows to what is after `since`', async () => {
    current = OWN;
    const b: Body = await (await feed('?since=2026-10-05T10:08:00.000Z')).json();
    expect(ids(b)).toEqual([12, 10, 9]);
  });

  it('pages: `limit` keeps the newest, `nextBefore` continues without a gap or a repeat', async () => {
    current = OWN;
    const first: Body = await (await feed('?limit=4')).json();
    expect(ids(first)).toEqual([12, 10, 9, 8]);
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).toBe(`2026-10-05T10:08:00.000Z_${ev(8)}`); // created_at_id of the last event on the page
    const second: Body = await (await feed(`?limit=4&before=${encodeURIComponent(first.nextBefore!)}`)).json();
    expect(ids(second)).toEqual([7, 6, 5, 4]);
    const third: Body = await (await feed(`?limit=4&before=${encodeURIComponent(second.nextBefore!)}`)).json();
    expect(ids(third)).toEqual([3, 2, 1]);
    expect(third.hasMore).toBe(false);
    expect(third.nextBefore).toBeNull();
  });

  it('never splits a group of events written at the same instant across two pages', async () => {
    // Five events from one transaction share a created_at; a page boundary lands inside the group.
    const at = '2026-10-06T08:00:00.000Z';
    for (let i = 0; i < 5; i += 1) db.tables.activity_events.push({ ...event({ n: 60 + i, verb: 'file.uploaded', actor: OWN, project: LP1 }), created_at: at });
    current = OWN;
    const seenIds: number[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const b: Body = await (await feed(`?limit=3${before ? `&before=${encodeURIComponent(before)}` : ''}`)).json();
      seenIds.push(...ids(b));
      if (!b.hasMore) break;
      before = b.nextBefore;
    }
    expect(seenIds.length).toBe(new Set(seenIds).size); // none twice
    expect(sorted(seenIds)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 60, 61, 62, 63, 64]); // none lost
  });

  it('reads an empty `before=` as no cursor, and refuses a malformed one', async () => {
    current = OWN;
    expect((await feed('?before=')).status).toBe(200);
    expect((await feed('?before=not-a-cursor')).status).toBe(400);
    expect((await feed('?before=2026-10-05T10:08:00.000Z_not-a-uuid')).status).toBe(400);
  });

  it('keeps scanning past whole pages of events the member cannot read', async () => {
    // 320 org-level events newer than everything else (more than one scan page): a scoped member reads none of them.
    for (let i = 0; i < 320; i += 1) {
      db.tables.activity_events.push({ ...event({ n: 100 + i, verb: 'org.settings_changed', actor: OWN }), created_at: new Date(Date.UTC(2026, 9, 6) + i * 1000).toISOString() });
    }
    current = AR_C2;
    const b: Body = await (await feed('?limit=2')).json();
    expect(sorted(ids(b))).toEqual([2, 4]);
    expect(b.hasMore).toBe(false);
  });
});

describe('GET /api/org/[orgId]/activity — keyed feeds', () => {
  it('an artist feed: their events and the project-only events of their projects, not another artist’s', async () => {
    current = OWN;
    const b: Body = await (await feed(`?artist=${C1}`)).json();
    // 1, 6, 7, 9 name Nova; 3 (a file) and 10 (a recording) name only her project.
    expect(sorted(ids(b))).toEqual([1, 3, 6, 7, 9, 10]);
    expect(ids(b)).not.toContain(4); // Kilo's file
  });

  it('an artist feed for an artist outside the member’s scope is 404, as is another org’s', async () => {
    current = AR_C2;
    expect((await feed(`?artist=${C1}`)).status).toBe(404);
    expect((await feed(`?artist=${D1}`)).status).toBe(404);
    expect((await feed(`?artist=${C2}`)).status).toBe(200);
  });

  it('the artist feed of a scoped member still hides internal events', async () => {
    current = ART_C1;
    const b: Body = await (await feed(`?artist=${C1}`)).json();
    expect(ids(b)).not.toContain(9);
    expect(sorted(ids(b))).toEqual([1, 3, 6, 7, 10]);
  });

  it('a project feed: that project’s events; 404 outside scope', async () => {
    current = OWN;
    const b: Body = await (await feed(`?project=${LP2}`)).json();
    expect(sorted(ids(b))).toEqual([2, 4]);
    current = AR_C2;
    expect((await feed(`?project=${LP1}`)).status).toBe(404);
    expect((await feed(`?project=${LP2}`)).status).toBe(200);
  });

  it('a project feed does not widen an artist-named event: Nova’s release in Kilo’s project is not Kilo’s news', async () => {
    db.tables.activity_events.push(event({ n: 40, verb: 'release.created', artist: C1, project: LP2, release: R1 }));
    current = AR_C2;
    const b: Body = await (await feed(`?project=${LP2}`)).json();
    expect(ids(b)).not.toContain(40);
  });

  it('a song history: the events of that song; D4 makes a song the member may not read a 404', async () => {
    current = OWN;
    const b: Body = await (await feed(`?song=${S1}`)).json();
    expect(sorted(ids(b))).toEqual([1, 10]);
    current = MKT;
    expect((await feed(`?song=${S2}`)).status).toBe(404); // an inbox demo is working material
    expect((await feed(`?song=${S1}`)).status).toBe(200);
    current = AR_C2;
    expect((await feed(`?song=${S1}`)).status).toBe(404); // Nova's song, outside the scope
  });
});

describe('GET /api/org/[orgId]/activity — access and input', () => {
  it('401 without a session, 403 for a stranger and for another org’s owner', async () => {
    current = null;
    expect((await feed()).status).toBe(401);
    current = STRANGER;
    expect((await feed()).status).toBe(403);
    current = X;
    expect((await feed()).status).toBe(403);
  });

  it('L2’s owner reads L2’s own feed, and only that', async () => {
    current = X;
    const b: Body = await (await feed('', L2)).json();
    expect(ids(b)).toEqual([11]);
  });

  it('a member without catalog.read is 403', async () => {
    db.tables.org_members[2].cap_revokes = ['catalog.read'];
    current = MKT;
    expect((await feed()).status).toBe(403);
  });

  it('rejects two keys, a bad id, a bad instant and a bad limit with 400', async () => {
    current = OWN;
    expect((await feed(`?artist=${C1}&project=${LP1}`)).status).toBe(400);
    expect((await feed('?artist=not-a-uuid')).status).toBe(400);
    expect((await feed('?since=yesterday')).status).toBe(400);
    expect((await feed('?limit=0')).status).toBe(400);
    expect((await feed('?limit=500')).status).toBe(400);
  });

  it('an unknown query parameter is ignored', async () => {
    current = OWN;
    expect((await feed('?cache=1')).status).toBe(200);
  });
});

describe('loadOverviewDigest', () => {
  it('measures from the last visit, else from a week back', async () => {
    const { loadOverviewDigest } = await import('@/lib/labelos/activity-store');
    const { requireOrgCapability } = await import('@/lib/auth/org-access');
    current = OWN;
    const access = await requireOrgCapability(L, 'catalog.read');
    if (!access.ok) throw new Error('no access');
    const now = new Date('2026-10-06T12:00:00Z');

    const fresh = await loadOverviewDigest(access, now);
    expect(fresh.lastSeenAt).toBeNull();
    expect(fresh.since).toBe('2026-09-29T12:00:00.000Z');
    expect(fresh.feed.events).toHaveLength(11);

    db.tables.user_profiles.find((r) => r.user_id === OWN)!.last_seen_overview_at = '2026-10-05T10:08:30.000Z';
    const seen = await loadOverviewDigest(access, now);
    expect(seen.lastSeenAt).toBe('2026-10-05T10:08:30.000Z');
    expect(seen.feed.events.map((e) => Number(e.id.slice(-12)))).toEqual([12, 10, 9]);
  });
});
