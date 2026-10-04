/**
 * The org artist workspace, song detail and org project reads (LABEL-17),
 * run through the REAL lib/auth/org-access and lib/labelos/org-workspace-store
 * against an in-memory database that evaluates every filter, so a missing
 * org filter or scope check returns the wrong rows and fails here.
 *
 *   L (label): artists C1 (Nova) and C2 (Kilo).
 *     LP1 = Nova's project (project_contacts). In it: S1 (selected song) with
 *     a master S1M, a demo S1D and a loop LO1 linked from it; S3 (in review).
 *     LP2 = Kilo's Inbox with S2 (inbox).
 *     Release R1 (Nova, project LP1): 1. S1, 2. S3.
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
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) q[m] = () => q;
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

async function workspace(contactId: string, org = L) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://x/api/org/${org}/artists/${contactId}/workspace`), { params: Promise.resolve({ orgId: org, contactId }) });
}
async function song(trackId: string, org = L) {
  const { GET } = await import('../../../songs/[trackId]/route');
  return GET(new NextRequest(`http://x/api/org/${org}/songs/${trackId}`), { params: Promise.resolve({ orgId: org, trackId }) });
}
async function project(id: string, org = L) {
  const { GET } = await import('../../../projects/[id]/route');
  return GET(new NextRequest(`http://x/api/org/${org}/projects/${id}`), { params: Promise.resolve({ orgId: org, id }) });
}

describe('GET …/artists/[contactId]/workspace', () => {
  it('the owner gets the artist, their projects, songs (newest first) and titled releases', async () => {
    current = OWN;
    const res = await workspace(C1);
    expect(res.status).toBe(200);
    const { workspace: w } = await res.json();
    expect(w.contact).toMatchObject({ id: C1, name: 'Nova' });
    expect(w.projects).toEqual([{ id: LP1, name: 'Nova EP', cover_url: null, status: 'in_progress', isInbox: false, songs: 2 }]);
    expect(w.songs.map((s: { id: string }) => s.id)).toEqual([S1, S3]); // masters / demos are recordings, not songs
    expect(w.restrictedSongs).toBe(0);
    expect(w.releasesReady).toBe(true);
    expect(w.releases).toHaveLength(1);
    expect(w.releases[0].items).toEqual([
      { position: 1, songTrackId: S1, title: 'Midnight', restricted: false },
      { position: 2, songTrackId: S3, title: 'Dawn', restricted: false },
    ]);
    expect(w.permissions).toEqual({ write: true, working: true, finished: true });
  });

  it('a song on a release that is not cancelled is finished material, so marketing sees it (06 §2.3)', async () => {
    current = MKT;
    const { workspace: w } = await (await workspace(C1)).json();
    expect(w.songs.map((s: { id: string }) => s.id)).toEqual([S1, S3]);
    expect(w.restrictedSongs).toBe(0);
    expect(w.releases[0].items[1]).toMatchObject({ songTrackId: S3, title: 'Dawn', restricted: false });
    expect(w.permissions).toEqual({ write: false, working: false, finished: true });
  });

  it('marketing does not see an in-review song on no release: counted, and its release slot stays untitled (D4, 07 §3.4)', async () => {
    db.tables.releases[0].state = 'cancelled';
    current = MKT;
    const { workspace: w } = await (await workspace(C1)).json();
    expect(w.songs.map((s: { id: string }) => s.id)).toEqual([S1]);
    expect(w.restrictedSongs).toBe(1);
    expect(w.releases[0].items[1]).toEqual({ position: 2, songTrackId: S3, title: null, restricted: true });
    expect(JSON.stringify(w)).not.toContain('Dawn');
  });

  it('a member limited to Kilo gets 404 on Nova, and their own artist works', async () => {
    current = AR_C2;
    expect((await workspace(C1)).status).toBe(404);
    const res = await workspace(C2);
    expect(res.status).toBe(200);
    const { workspace: w } = await res.json();
    expect(w.projects).toEqual([expect.objectContaining({ id: LP2, isInbox: true, songs: 1 })]);
    expect(w.releases).toEqual([]);
  });

  it('a producer contact, another org’s artist and a bad id are 404; a stranger and no session are refused', async () => {
    current = OWN;
    expect((await workspace(PC1)).status).toBe(404);
    expect((await workspace(D1)).status).toBe(404);
    expect((await workspace(D1, L2)).status).toBe(404);
    expect((await workspace('not-a-uuid')).status).toBe(404);
    current = STRANGER;
    expect((await workspace(C1)).status).toBe(404);
    current = null;
    expect((await workspace(C1)).status).toBe(401);
  });

  it('before migration 144 the releases read as not ready, not as a 500', async () => {
    missingTables = new Set(['releases', 'release_items']);
    current = OWN;
    const res = await workspace(C1);
    expect(res.status).toBe(200);
    const { workspace: w } = await res.json();
    expect(w.releasesReady).toBe(false);
    expect(w.releases).toEqual([]);
    expect(w.songs.map((s: { id: string }) => s.id)).toEqual([S1, S3]);
  });
});

describe('GET …/songs/[trackId]', () => {
  it('A&R hears every recording of the song: mix, master, demo, loop', async () => {
    current = AR;
    const res = await song(S1);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.song).toMatchObject({ id: S1, title: 'Midnight', stage: 'selected' });
    expect(d.recordings.map((r: { trackId: string; label: string }) => [r.trackId, r.label])).toEqual([
      [S1, 'Mix'], [S1M, 'Master'], [S1D, 'Demo'], [LO1, 'Loop'],
    ]);
    expect(d.restrictedRecordings).toBe(0);
    expect(d.artists).toEqual([{ id: C1, name: 'Nova' }]);
    expect(d.projects).toEqual([{ id: LP1, name: 'Nova EP' }]);
    expect(d.releases).toEqual([{ id: R1, title: 'Midnight EP', state: 'draft' }]);
  });

  it('marketing gets the mix and the master only; demo and loop are restricted and unnamed (D4)', async () => {
    current = MKT;
    const d = await (await song(S1)).json();
    expect(d.recordings.map((r: { trackId: string }) => r.trackId)).toEqual([S1, S1M]);
    expect(d.restrictedRecordings).toBe(2);
    expect(JSON.stringify(d)).not.toMatch(/Pad loop|\(demo\)/);
  });

  it('marketing gets 404 on a working song, as PostgREST would show it nothing', async () => {
    db.tables.releases[0].state = 'cancelled';
    current = MKT;
    expect((await song(S3)).status).toBe(404);
  });

  it('a master, a loop, a producer track, another org’s song and an out-of-scope song are 404', async () => {
    current = OWN;
    expect((await song(S1M)).status).toBe(404);
    expect((await song(LO1)).status).toBe(404);
    expect((await song(PT1)).status).toBe(404);
    expect((await song(XS1)).status).toBe(404);
    current = AR_C2;
    expect((await song(S1)).status).toBe(404);
    expect((await song(S2)).status).toBe(200);
  });

  it('a scoped member does not get a recording that sits in no project they can see', async () => {
    db.tables.project_tracks = db.tables.project_tracks.filter((p) => p.track_id !== LO1);
    db.tables.project_tracks.push({ project_id: LP2, track_id: S1, position: 1 });
    db.tables.member_artist_scopes.push({ org_id: L, user_id: AR_C2, contact_id: C2 });
    current = AR_C2;
    const d = await (await song(S1)).json();
    // S1 is reachable through Kilo's inbox; its master/demo/loop sit only in Nova's project (or none).
    expect(d.recordings.map((r: { trackId: string }) => r.trackId)).toEqual([S1]);
    expect(d.restrictedRecordings).toBe(3);
    expect(d.artists).toEqual([{ id: C2, name: 'Kilo' }]);
    expect(d.releases).toEqual([]);
  });
});

describe('GET …/projects/[id]', () => {
  it('lists the project’s artists and visible songs; out of scope is 404', async () => {
    current = MKT;
    const d = await (await project(LP1)).json();
    expect(d.project).toMatchObject({ id: LP1, name: 'Nova EP', isInbox: false });
    expect(d.artists).toEqual([{ id: C1, name: 'Nova' }]);
    expect(d.songs.map((s: { id: string }) => s.id)).toEqual([S1, S3]);
    current = AR_C2;
    expect((await project(LP1)).status).toBe(404);
    expect((await project(XP1)).status).toBe(404);
  });
});
