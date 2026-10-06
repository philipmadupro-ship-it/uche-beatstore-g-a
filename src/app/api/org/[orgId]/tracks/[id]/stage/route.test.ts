/**
 * POST /api/org/[orgId]/tracks/[id]/stage (LABEL-24), through the REAL
 * lib/auth/org-access, song-stage, song-stage-store and activity against an
 * in-memory database.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project (project_contacts
 *     C1) with song S1 (inbox), a beat B1 and a song-type master M1 (no stage).
 *     LP2: Kilo's Inbox with song S2. S3: a song in no project.
 *     Members: owner, A&R, marketing (read-only), A&R scoped to C2, roster
 *     artist C1 (Nova).
 *   L2: song XS1. The producer: song PS1 (org_id NULL).
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
const B1 = t(2);
const M1 = t(3);
const S2 = t(4);
const S3 = t(5);
const XS1 = t(6);
const PS1 = t(7);

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
  return { id, org_id: org, user_id: org ? null : OWN, type, title, song_stage: stage };
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
        { project_id: LP1, track_id: B1, position: 1 },
        { project_id: LP1, track_id: M1, position: 2 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [
        track(S1, L, 'song', 'Midnight', 'inbox'),
        track(B1, L, 'beat', 'Beat'),
        track(M1, L, 'song', 'Midnight (master)'),
        track(S2, L, 'song', 'Dawn', 'inbox'),
        track(S3, L, 'song', 'Loose', 'inbox'),
        track(XS1, L2, 'song', 'Xen single', 'inbox'),
        track(PS1, null, 'song', 'Producer song'),
      ],
      track_links: [],
      song_beats: [],
      release_items: [],
      activity_events: [],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function move(as: string | null, org: string, id: string, body: unknown) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/tracks/${id}/stage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ orgId: org, id }) });
}
const stageOf = (id: string) => db.tables.tracks.find((r) => r.id === id)!.song_stage;
const events = () => db.tables.activity_events;

describe('legal moves', () => {
  it('walks a song along the pipeline: inbox → in_review → shortlisted → in_development → selected', async () => {
    for (const [from, to] of [['inbox', 'in_review'], ['in_review', 'shortlisted'], ['shortlisted', 'in_development'], ['in_development', 'selected']]) {
      const res = await move(OWN, L, S1, { to, from });
      expect(res.status, `${from} → ${to}`).toBe(200);
      expect(await res.json()).toMatchObject({ song: { id: S1, stage: to }, from, to });
      expect(stageOf(S1)).toBe(to);
    }
  });

  it('answers with what the next menu offers', async () => {
    const body = await (await move(OWN, L, S1, { to: 'in_review' })).json();
    expect(body.allowed).toEqual(['shortlisted', 'passed', 'on_hold', 'archived']);
  });

  it('works without `from` (the table and the compare-and-set still apply)', async () => {
    expect((await move(AR, L, S1, { to: 'passed' })).status).toBe(200);
    expect(stageOf(S1)).toBe('passed');
    expect((await move(AR, L, S1, { to: 'in_review' })).status).toBe(200); // a passed demo is revisited
  });
});

describe('illegal moves are 409', () => {
  it('names from and to, and changes nothing', async () => {
    const res = await move(OWN, L, S1, { to: 'selected' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('A song cannot move from Inbox to Selected');
    expect(body).toMatchObject({ from: 'inbox', to: 'selected' });
    expect(stageOf(S1)).toBe('inbox');
    expect(events()).toHaveLength(0);
  });

  it('every pair outside the table is refused, from every stage', async () => {
    const { SONG_STAGES, STAGE_TRANSITIONS } = await import('@/lib/labelos/song-stage');
    for (const from of SONG_STAGES) {
      for (const to of SONG_STAGES) {
        db.tables.tracks.find((r) => r.id === S1)!.song_stage = from;
        const res = await move(OWN, L, S1, { to });
        expect(res.status, `${from} → ${to}`).toBe(STAGE_TRANSITIONS[from].includes(to) ? 200 : 409);
      }
    }
  });

  it('refuses a move to the stage it is already in', async () => {
    expect((await move(OWN, L, S1, { to: 'inbox' })).status).toBe(409);
  });

  it('refuses `released`, which is derived and not a stage (400, before anything is read)', async () => {
    expect((await move(OWN, L, S1, { to: 'released' })).status).toBe(400);
    expect((await move(OWN, L, S1, { to: 'in_review', extra: 1 })).status).toBe(400);
    expect(stageOf(S1)).toBe('inbox');
  });
});

describe('two people moving one song', () => {
  it('a stale screen loses: `from` is no longer the stage → 409, nothing changed', async () => {
    expect((await move(OWN, L, S1, { to: 'in_review', from: 'inbox' })).status).toBe(200);
    const res = await move(AR, L, S1, { to: 'passed', from: 'inbox' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/now In review, not Inbox/);
    expect(stageOf(S1)).toBe('in_review');
    expect(events()).toHaveLength(1);
  });

  it('at the same moment exactly one wins, and one event is written', async () => {
    const [a, b] = await Promise.all([move(OWN, L, S1, { to: 'in_review', from: 'inbox' }), move(AR, L, S1, { to: 'in_review', from: 'inbox' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(stageOf(S1)).toBe('in_review');
    expect(events()).toHaveLength(1);
  });

  it('the write is compare-and-set on the stage the request read', async () => {
    const { moveSongStage } = await import('@/lib/labelos/song-stage-store');
    const admin = memoryAdmin(db).client as never;
    expect(await moveSongStage(admin, { orgId: L, trackId: S1, from: 'inbox', to: 'in_review' })).toBe(true);
    expect(await moveSongStage(admin, { orgId: L, trackId: S1, from: 'inbox', to: 'passed' })).toBe(false);
    expect(stageOf(S1)).toBe('in_review');
  });
});

describe('a roster artist (role artist)', () => {
  it('may hand their own song over: inbox → in_review', async () => {
    const res = await move(ART, L, S1, { to: 'in_review' });
    expect(res.status).toBe(200);
    expect((await res.json()).allowed).toEqual([]);
    expect(events()[0]).toMatchObject({ actor_id: ART, verb: 'song.stage_changed' });
  });

  it('may not do anything else with it: 409', async () => {
    for (const to of ['passed', 'archived']) expect((await move(ART, L, S1, { to })).status, `inbox → ${to}`).toBe(409);
    db.tables.tracks.find((r) => r.id === S1)!.song_stage = 'in_review';
    for (const to of ['shortlisted', 'passed', 'on_hold', 'archived', 'inbox']) expect((await move(ART, L, S1, { to })).status, `in_review → ${to}`).toBe(409);
    expect(stageOf(S1)).toBe('in_review');
  });

  it('cannot move another artist\'s song: 404', async () => {
    expect((await move(ART, L, S2, { to: 'in_review' })).status).toBe(404);
    expect(stageOf(S2)).toBe('inbox');
  });
});

describe('who may move a song (catalog.write in scope)', () => {
  it('a member scoped to other artists gets 404, not 403, and nothing moves', async () => {
    expect((await move(AR_C2, L, S1, { to: 'in_review' })).status).toBe(404);
    expect(stageOf(S1)).toBe('inbox');
    expect((await move(AR_C2, L, S2, { to: 'in_review' })).status).toBe(200);
  });

  it('a read-only member (marketing) gets 403', async () => {
    expect((await move(MKT, L, S1, { to: 'in_review' })).status).toBe(403);
    expect(stageOf(S1)).toBe('inbox');
  });

  it('a non-member, another org\'s member and a signed-out caller cannot', async () => {
    expect((await move(STRANGER, L, S1, { to: 'in_review' })).status).toBe(404);
    expect((await move(X, L, S1, { to: 'in_review' })).status).toBe(404);
    expect((await move(null, L, S1, { to: 'in_review' })).status).toBe(401);
  });

  it('a producer track, another org\'s song and an unknown id are 404', async () => {
    expect((await move(OWN, L, PS1, { to: 'in_review' })).status).toBe(404);
    expect((await move(OWN, L, XS1, { to: 'in_review' })).status).toBe(404);
    expect((await move(OWN, L, t(99), { to: 'in_review' })).status).toBe(404);
    expect((await move(OWN, L2, S1, { to: 'in_review' })).status).toBe(404);
    expect((await move(OWN, L, 'not-a-uuid', { to: 'in_review' })).status).toBe(404);
  });

  it('only songs: a beat and a song-type master (no stage) are 404', async () => {
    expect((await move(OWN, L, B1, { to: 'in_review' })).status).toBe(404);
    expect((await move(OWN, L, M1, { to: 'in_review' })).status).toBe(404);
    expect(db.tables.tracks.find((r) => r.id === B1)!.song_stage).toBeNull();
  });
});

describe('song.stage_changed', () => {
  it('records { from, to } with the song, its project and its artist, visible to the artist (D5)', async () => {
    expect((await move(OWN, L, S1, { to: 'in_review' })).status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      org_id: L,
      actor_id: OWN,
      verb: 'song.stage_changed',
      subject_type: 'track',
      subject_id: S1,
      song_id: S1,
      project_id: LP1,
      artist_id: C1,
      payload: { from: 'inbox', to: 'in_review' },
      visibility: 'artist',
    });
  });

  it('files an Inbox song under its inbox artist', async () => {
    await move(OWN, L, S2, { to: 'passed' });
    expect(events()[0]).toMatchObject({ project_id: LP2, artist_id: C2 });
  });

  it('a song in no project still gets its event (for the whole-org feed)', async () => {
    expect((await move(OWN, L, S3, { to: 'in_review' })).status).toBe(200);
    expect(events()[0]).toMatchObject({ song_id: S3, project_id: null, artist_id: null });
  });

  it('is not written when the move is refused', async () => {
    await move(OWN, L, S1, { to: 'selected' });
    await move(MKT, L, S1, { to: 'in_review' });
    expect(events()).toHaveLength(0);
  });
});
