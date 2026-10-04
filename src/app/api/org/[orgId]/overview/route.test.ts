/**
 * GET /api/org/[orgId]/overview (LABEL-18), run through the REAL
 * lib/auth/org-access and lib/labelos/overview-store against an in-memory
 * database that evaluates every filter, so a missing org filter, scope walk
 * or D4 check returns the wrong numbers and fails here.
 *
 *   L (label): artists C1 (Nova) and C2 (Kilo).
 *     LP1 = Nova's project (project_contacts): S1 (selected), S3 (in review)
 *     and S1's master / demo / loop. LP2 = Kilo's Inbox: S2 (inbox).
 *     Draft release R1 (Nova, LP1): S1, S3.
 *   Members: owner, A&R, marketing (finished audio only), A&R scoped to C2.
 *   L2: artist D1, project XP1, song XS1. The producer: contact PC1, track PT1.
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
const STRANGER = u(5);
const X = u(6);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const D1 = '30000000-0000-4000-8000-0000000000d1';
const PC1 = '30000000-0000-4000-8000-0000000000e1';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP1 = '40000000-0000-4000-8000-0000000000b1';
const S1 = '50000000-0000-4000-8000-000000000001';
const S1M = '50000000-0000-4000-8000-000000000002';
const S1D = '50000000-0000-4000-8000-000000000003';
const LO1 = '50000000-0000-4000-8000-000000000004';
const S3 = '50000000-0000-4000-8000-000000000005';
const S2 = '50000000-0000-4000-8000-000000000006';
const XS1 = '50000000-0000-4000-8000-000000000007';
const PT1 = '50000000-0000-4000-8000-000000000008';
const R1 = '60000000-0000-4000-8000-000000000001';

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
/** Tables that answer like PostgREST does before their migration is applied. */
let missingTables = new Set<string>();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (!missingTables.has(table)) return mem.client.from(table);
      const err = { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'range']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(err).then(ok);
      return q;
    },
  }),
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
const track = (id: string, org: string | null, type: string, title: string, song_stage: string | null, created_at = '2026-01-01') => ({
  id, org_id: org, user_id: org ? null : OWN, type, title, song_stage, cover_url: null, created_at, bpm: null, key: null, duration_seconds: 180, beat_track_id: null,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  missingTables = new Set();
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(MKT, 'member', ['marketing']),
        member(AR_C2, 'member', ['a_and_r'], 'artists'),
        member(X, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist', secondary_category: null, avatar_url: null, created_at: '2026-01-01' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist', secondary_category: null, avatar_url: null, created_at: '2026-01-01' },
        { id: D1, org_id: L2, user_id: null, name: 'L2 artist', category: 'artist', secondary_category: null, avatar_url: null, created_at: '2026-01-01' },
        { id: PC1, org_id: null, user_id: OWN, name: 'CRM artist', category: 'artist', secondary_category: null, avatar_url: null, created_at: '2026-01-01' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', cover_url: null, inbox_for_contact_id: null, status: 'in_progress', created_at: '2026-01-02' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', cover_url: null, inbox_for_contact_id: C2, status: 'in_progress', created_at: '2026-01-01' },
        { id: XP1, org_id: L2, user_id: null, name: 'L2', cover_url: null, inbox_for_contact_id: null, status: 'in_progress', created_at: '2026-01-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }, { project_id: XP1, contact_id: D1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 },
        { project_id: LP1, track_id: S1M, position: 1 },
        { project_id: LP1, track_id: S1D, position: 2 },
        { project_id: LP1, track_id: LO1, position: 3 },
        { project_id: LP1, track_id: S3, position: 4 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight', 'selected', '2026-01-05'),
        track(S1M, L, 'song', 'Midnight (master)', null),
        track(S1D, L, 'song', 'Midnight (demo)', null),
        track(LO1, L, 'loop', 'Pad loop', null),
        track(S3, L, 'song', 'Dawn', 'in_review', '2026-01-04'),
        track(S2, L, 'song', 'Kilo demo', 'inbox'),
        track(XS1, L2, 'song', 'L2 song', 'inbox'),
        track(PT1, null, 'song', 'Producer song', null),
      ],
      song_beats: [],
      track_links: [
        { from_track_id: S1, to_track_id: S1M, user_id: null, relation: 'master', position: 0 },
        { from_track_id: S1, to_track_id: S1D, user_id: null, relation: 'demo', position: 0 },
        { from_track_id: S1, to_track_id: LO1, user_id: null, relation: 'loop', position: 0 },
      ],
      releases: [
        { id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Midnight EP', type: 'ep', state: 'draft', target_date: null, release_date: null, created_at: '2026-01-06' },
      ],
      release_items: [
        { id: 'ri1', release_id: R1, org_id: L, position: 1, song_track_id: S1, master_track_id: S1M, version_title: null, explicit: false },
        { id: 'ri2', release_id: R1, org_id: L, position: 2, song_track_id: S3, master_track_id: S3, version_title: null, explicit: false },
      ],
    },
  };
  mem = memoryAdmin(db);
});

async function overview(org = L) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://x/api/org/${org}/overview`), { params: Promise.resolve({ orgId: org }) });
}
const rowOf = (o: { artists: { id: string }[] }, id: string) => o.artists.find((a) => a.id === id) as unknown as Record<string, unknown>;

describe('GET /api/org/[orgId]/overview', () => {
  it('counts match the fixtures: songs by stage per artist, totals, next release', async () => {
    current = OWN;
    const res = await overview();
    expect(res.status).toBe(200);
    const { overview: o } = await res.json();
    expect(o.artists.map((a: { id: string }) => a.id)).toEqual([C2, C1]); // by name: Kilo, Nova
    expect(rowOf(o, C1)).toMatchObject({
      name: 'Nova', songs: 2, restricted: 0,
      columns: { demos: 1, development: 0, selected: 1 },
      nextRelease: { id: R1, title: 'Midnight EP', state: 'draft', targetDate: null },
    });
    expect(rowOf(o, C2)).toMatchObject({ name: 'Kilo', songs: 1, columns: { demos: 1, development: 0, selected: 0 }, nextRelease: null });
    expect(o.totals).toMatchObject({ artists: 2, songs: 3, restricted: 0 });
    expect(o.releasesReady).toBe(true);
    // masters, demos and loops are recordings, not songs; other orgs and the producer are absent
    expect(JSON.stringify(o)).not.toMatch(/L2 artist|CRM artist|Producer song|L2 song/);
  });

  it('A&R sees the same as the owner', async () => {
    current = AR;
    const { overview: o } = await (await overview()).json();
    expect(o.totals).toMatchObject({ artists: 2, songs: 3 });
  });

  it('marketing: an in-review song on a release is finished (counted); a Kilo inbox song is restricted, a number only (D4)', async () => {
    current = MKT;
    const { overview: o } = await (await overview()).json();
    expect(rowOf(o, C1)).toMatchObject({ songs: 2, restricted: 0 });
    expect(rowOf(o, C2)).toMatchObject({ songs: 0, restricted: 1, columns: { demos: 0, development: 0, selected: 0 } });
    expect(o.totals).toMatchObject({ songs: 2, restricted: 1 });
    expect(JSON.stringify(o)).not.toContain('Kilo demo');
  });

  it('with the release cancelled marketing loses the in-review song, and Nova has no next release', async () => {
    db.tables.releases[0].state = 'cancelled';
    current = MKT;
    const { overview: o } = await (await overview()).json();
    expect(rowOf(o, C1)).toMatchObject({ songs: 1, restricted: 1, nextRelease: null });
    expect(JSON.stringify(o)).not.toContain('Dawn');
  });

  it('a member limited to Kilo sees only Kilo: no Nova row, no Nova song in the totals, no Nova release', async () => {
    current = AR_C2;
    const res = await overview();
    expect(res.status).toBe(200);
    const { overview: o } = await res.json();
    expect(o.artists.map((a: { id: string }) => a.id)).toEqual([C2]);
    expect(o.totals).toMatchObject({ artists: 1, songs: 1, restricted: 0 });
    expect(o.totals.stages).toEqual([{ stage: 'inbox', label: 'Inbox', count: 1 }]);
    expect(JSON.stringify(o)).not.toMatch(/Nova|Midnight|"stage":"selected"/);
  });

  it('a member limited to no artists gets an empty roster, not an error', async () => {
    db.tables.member_artist_scopes = [];
    current = AR_C2;
    const { overview: o } = await (await overview()).json();
    expect(o.artists).toEqual([]);
    expect(o.totals).toMatchObject({ artists: 0, songs: 0 });
  });

  it('a stranger, another org’s owner and no session are refused', async () => {
    current = STRANGER;
    expect((await overview()).status).toBe(403);
    current = X;
    expect((await overview()).status).toBe(403);
    current = null;
    expect((await overview()).status).toBe(401);
  });

  it('another org’s owner reads only their own org’s numbers', async () => {
    current = X;
    const { overview: o } = await (await overview(L2)).json();
    expect(o.artists.map((a: { id: string }) => a.id)).toEqual([D1]);
    expect(rowOf(o, D1)).toMatchObject({ songs: 1 }); // XS1 only; none of L's
  });

  it('before migration 144 the next release reads as not ready, not as a 500', async () => {
    missingTables = new Set(['releases', 'release_items']);
    current = OWN;
    const res = await overview();
    expect(res.status).toBe(200);
    const { overview: o } = await res.json();
    expect(o.releasesReady).toBe(false);
    expect(rowOf(o, C1)).toMatchObject({ nextRelease: null });
  });
});

describe('the Overview agrees with each artist\'s workspace', () => {
  it.each([['owner', OWN], ['marketing', MKT], ['scoped A&R', AR_C2]])('%s: songs, restricted and stage counts equal the workspace\'s', async (_name, user) => {
    current = user;
    const { overview: o } = await (await overview()).json();
    const { GET } = await import('../artists/[contactId]/workspace/route');
    for (const a of o.artists as { id: string; songs: number; restricted: number; stages: { stage: string; count: number }[] }[]) {
      const res = await GET(new NextRequest(`http://x/api/org/${L}/artists/${a.id}/workspace`), { params: Promise.resolve({ orgId: L, contactId: a.id }) });
      expect(res.status).toBe(200);
      const { workspace: w } = await res.json();
      expect(a.songs).toBe(w.songs.length);
      expect(a.restricted).toBe(w.restrictedSongs);
      const { stageCounts } = await import('@/lib/labelos/org-workspace');
      expect(a.stages).toEqual(stageCounts(w.songs));
    }
  });
});

describe('PostgREST\'s row cap', () => {
  it('does not undercount when a response is silently truncated: reads are paged', async () => {
    // 2500 more songs in Nova's project, against a database that never returns more than 1000 rows.
    for (let i = 0; i < 2500; i++) {
      const id = `50000000-0000-4000-8001-${String(i).padStart(12, '0')}`;
      db.tables.tracks.push(track(id, L, 'song', `Bulk ${i}`, 'in_development'));
      db.tables.project_tracks.push({ project_id: LP1, track_id: id, position: 100 + i });
    }
    db.maxRows = 1000;
    current = OWN;
    const { overview: o } = await (await overview()).json();
    expect(rowOf(o, C1)).toMatchObject({ songs: 2502, columns: { demos: 1, development: 2500, selected: 1 } });
    expect(o.totals.songs).toBe(2503);
  });
});
