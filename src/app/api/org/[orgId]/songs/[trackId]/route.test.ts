/**
 * PATCH + GET metadata (LABEL-53), through the REAL lib/auth/org-access,
 * track-metadata, track-metadata-store and activity against an in-memory
 * database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project with song S1
 *     (inbox), its master M1 (song-type, no stage, linked as `master`) and a
 *     demo D1 (working material). LP2: Kilo's Inbox with S2.
 *   Members: owner, A&R (catalog.write + release.write), producer function
 *     (catalog.write only), marketing (read-only), A&R scoped to C2, roster
 *     artist C1. L2: song XS1. The producer's own track PS1 (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
const PRD = u(3);
const MKT = u(4);
const AR_C2 = u(5);
const ART = u(6);
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
const D1 = t(3);
const S2 = t(4);
const XS1 = t(5);
const PS1 = t(6);

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

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}
function track(id: string, org: string | null, type: string, title: string, stage: string | null = null) {
  return { id, org_id: org, user_id: org ? null : OWN, type, title, song_stage: stage, metadata_updated_at: null };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(AR, 'member', ['a_and_r']),
        member(PRD, 'member', ['producer']),
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
        { project_id: LP1, track_id: M1, position: 1 },
        { project_id: LP1, track_id: D1, position: 2 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight', 'inbox'),
        track(M1, L, 'song', 'Midnight (master)'),
        track(D1, L, 'beat', 'Demo'),
        track(S2, L, 'song', 'Dawn', 'inbox'),
        track(XS1, L2, 'song', 'Xen single', 'inbox'),
        track(PS1, null, 'song', 'Producer song'),
      ],
      track_links: [
        { from_track_id: S1, to_track_id: M1, relation: 'master', position: 0 },
        { from_track_id: S1, to_track_id: D1, relation: 'demo', position: 1 },
      ],
      song_beats: [],
      release_items: [],
      activity_events: [],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function patch(as: string | null, org: string, id: string, body: unknown) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/songs/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.PATCH(req, { params: Promise.resolve({ orgId: org, trackId: id }) });
}
async function load(as: string | null, org: string, id: string) {
  current = as;
  const mod = (await import('./metadata/route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/songs/${id}/metadata`), { params: Promise.resolve({ orgId: org, trackId: id }) });
}
const row = (id: string) => db.tables.tracks.find((r) => r.id === id)!;

describe('GET metadata', () => {
  it('returns the values, the token and what this member may write', async () => {
    const res = await load(AR, L, S1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ trackId: S1, kind: 'song', updatedAt: null });
    expect(body.values.title).toBe('Midnight');
    expect(body.writable).toContain('isrc');
    const producer = await (await load(PRD, L, S1)).json();
    expect(producer.writable).toContain('genre');
    expect(producer.writable).not.toContain('isrc');
    // A roster artist writes the creative fields of their own song, never the ISRC.
    const artist = await (await load(ART, L, S1)).json();
    expect(artist.writable).toContain('genre');
    expect(artist.writable).not.toContain('isrc');
    // An in-development song is not marketing's to see (D4).
    expect((await load(MKT, L, S1)).status).toBe(404);
  });

  it('is 404 for a producer track, another org, out of scope and a signed-out caller is refused', async () => {
    expect((await load(OWN, L, PS1)).status).toBe(404);
    expect((await load(X, L, S1)).status).toBe(404);
    expect((await load(AR_C2, L, S1)).status).toBe(404);
    expect((await load(null, L, S1)).status).toBeGreaterThanOrEqual(401);
  });

  it('marks a recording as a recording and hides working material from marketing', async () => {
    expect((await (await load(OWN, L, M1)).json()).kind).toBe('recording');
    expect((await load(MKT, L, D1)).status).toBe(404);
  });
});

describe('PATCH', () => {
  it('sets an ISRC on the recording through the editor, normalised, and records field names only', async () => {
    const res = await patch(AR, L, M1, { expected: null, isrc: 'gb-aaa-26-00001', notes: 'private words about the mix' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toEqual(['isrc', 'notes']);
    expect(row(M1).isrc).toBe('GBAAA2600001');
    expect(row(M1).metadata_updated_at).toBe(body.updatedAt);
    const ev = db.tables.activity_events.find((e) => e.verb === 'recording.metadata_updated')!;
    expect(ev).toBeTruthy();
    expect(ev.payload).toEqual({ fields: ['isrc', 'notes'] });
    expect(JSON.stringify(ev)).not.toContain('private words');
    expect(JSON.stringify(ev)).not.toContain('GBAAA2600001');
  });

  it('403 for the ISRC without release.write (producer function, roster artist)', async () => {
    expect((await patch(PRD, L, S1, { expected: null, isrc: 'GBAAA2600001' })).status).toBe(403);
    expect((await patch(PRD, L, S1, { expected: null, genre: 'Pop' })).status).toBe(200);
    expect((await patch(ART, L, S1, { expected: null, isrc: 'GBAAA2600001' })).status).toBe(403);
    expect(row(S1).isrc).toBeUndefined();
  });

  it('404 across orgs, outside scope, for a producer track and for hidden working material', async () => {
    for (const [who, org, id] of [[X, L, S1], [OWN, L2, S1], [AR_C2, L, S1], [OWN, L, PS1], [MKT, L, D1]] as const) {
      expect((await patch(who, org, id, { expected: null, genre: 'x' })).status, `${who} ${id}`).toBe(404);
    }
    expect(row(PS1).genre).toBeUndefined();
  });

  it('400 names the field; nothing is written', async () => {
    const res = await patch(AR, L, S1, { expected: null, isrc: 'nope', genre: 'Pop' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'isrc' });
    expect(row(S1).genre).toBeUndefined();
    expect((await patch(AR, L, S1, { expected: null, title: '  ' })).status).toBe(400);
    expect((await patch(AR, L, S1, { expected: null, surprise: 1 })).status).toBe(400);
  });

  it('409 with the current values when the row changed since the editor loaded', async () => {
    const first = await (await patch(AR, L, S1, { expected: null, genre: 'Pop' })).json();
    const stale = await patch(OWN, L, S1, { expected: null, genre: 'Rock' });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.values.genre).toBe('Pop');
    expect(body.updatedAt).toBe(first.updatedAt);
    expect(row(S1).genre).toBe('Pop');
    // With the fresh token the same edit lands.
    expect((await patch(OWN, L, S1, { expected: first.updatedAt, genre: 'Rock' })).status).toBe(200);
    expect(row(S1).genre).toBe('Rock');
  });

  it('a request that changes nothing writes and records nothing', async () => {
    const res = await patch(AR, L, S1, { expected: null, title: 'Midnight' });
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toEqual([]);
    expect(db.tables.activity_events).toHaveLength(0);
    expect(row(S1).metadata_updated_at).toBeNull();
  });

  it('clears a field with null', async () => {
    const a = await (await patch(AR, L, S1, { expected: null, p_line: '℗ 2026 Label' })).json();
    expect(row(S1).p_line).toBe('℗ 2026 Label');
    expect((await patch(AR, L, S1, { expected: a.updatedAt, p_line: null })).status).toBe(200);
    expect(row(S1).p_line).toBeNull();
  });
});
