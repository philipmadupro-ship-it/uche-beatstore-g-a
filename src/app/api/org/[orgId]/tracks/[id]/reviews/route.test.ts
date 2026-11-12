/**
 * GET / PUT /api/org/[orgId]/tracks/[id]/reviews (LABEL-25), through the REAL
 * lib/auth/org-access, song-review(-store) and activity against an in-memory
 * database. The scenario is the stage route's (same cast).
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
      song_reviews: [],
      user_profiles: [
        { user_id: OWN, display_name: 'Owner' },
        { user_id: AR, display_name: 'Ada' },
      ],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function put(as: string | null, org: string, id: string, body: unknown) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/tracks/${id}/reviews`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.PUT(req, { params: Promise.resolve({ orgId: org, id }) });
}
async function list(as: string | null, org: string, id: string) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const req = new NextRequest(`https://app.test/api/org/${org}/tracks/${id}/reviews`);
  return mod.GET(req, { params: Promise.resolve({ orgId: org, id }) });
}
const rows = () => db.tables.song_reviews;
const events = () => db.tables.activity_events;

describe('PUT my review', () => {
  it('two reviewers\' ratings coexist (acceptance)', async () => {
    expect((await put(AR, L, S1, { rating: 4, verdict: 'shortlist' })).status).toBe(200);
    expect((await put(OWN, L, S1, { rating: 2, note: 'not for us' })).status).toBe(200);
    expect(rows()).toHaveLength(2);
    const byUser = Object.fromEntries(rows().map((r) => [r.reviewer_id, r]));
    expect(byUser[AR]).toMatchObject({ rating: 4, verdict: 'shortlist', track_id: S1, org_id: L });
    expect(byUser[OWN]).toMatchObject({ rating: 2, note: 'not for us' });
    expect(byUser[OWN].verdict ?? null).toBeNull();
  });

  it('rewrites MY row in place and keeps what the patch leaves out; null clears', async () => {
    await put(AR, L, S1, { rating: 4, verdict: 'hold', note: 'hook' });
    await put(AR, L, S1, { rating: 5 });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ rating: 5, verdict: 'hold', note: 'hook' });
    await put(AR, L, S1, { verdict: null });
    expect(rows()[0]).toMatchObject({ rating: 5, verdict: null, note: 'hook' });
  });

  it('writes only the columns the request named: a rating and a note in flight cannot undo each other', async () => {
    const { upsertMyReview } = await import('@/lib/labelos/song-review-store');
    const { createServiceClient } = await import('@/lib/auth/ownership');
    const admin = createServiceClient();
    await put(AR, L, S1, { rating: 4, verdict: 'hold' });
    // Both saves read the same base (no note yet); each writes back only its own column.
    await upsertMyReview(admin, { orgId: L, trackId: S1, userId: AR, columns: { note: 'late note' } });
    await upsertMyReview(admin, { orgId: L, trackId: S1, userId: AR, columns: { rating: 5 } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ rating: 5, verdict: 'hold', note: 'late note' });
  });

  it('refuses a review that would be empty (400) and bad input (400)', async () => {
    await put(AR, L, S1, { rating: 3 });
    expect((await put(AR, L, S1, { rating: null })).status).toBe(400);
    expect((await put(AR, L, S1, {})).status).toBe(400);
    expect((await put(AR, L, S1, { rating: 6 })).status).toBe(400);
    expect((await put(AR, L, S1, { verdict: 'love' })).status).toBe(400);
    expect((await put(AR, L, S1, { rating: 3, reviewer_id: OWN })).status).toBe(400);
    expect(rows()[0].rating).toBe(3);
  });

  it('records song.reviewed with a summary and never the note text', async () => {
    await put(AR, L, S1, { rating: 4, verdict: 'shortlist', note: 'a secret opinion' });
    expect(events()).toHaveLength(1);
    const e = events()[0];
    expect(e).toMatchObject({ verb: 'song.reviewed', actor_id: AR, org_id: L, visibility: 'artist', song_id: S1 });
    expect(e.payload).toEqual({ rating: 4, verdict: 'shortlist', noted: true });
    expect(JSON.stringify(e)).not.toContain('secret opinion');
  });

  it('a roster artist cannot review (403), marketing neither; nothing is written', async () => {
    expect((await put(ART, L, S1, { rating: 5 })).status).toBe(403);
    expect((await put(MKT, L, S1, { rating: 5 })).status).toBe(403);
    expect(rows()).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it('is 404 outside the member\'s scope, for another org, a producer song, a non-member and a non-song', async () => {
    expect((await put(AR_C2, L, S1, { rating: 3 })).status).toBe(404); // Nova's song, scoped to Kilo
    expect((await put(AR_C2, L, S2, { rating: 3 })).status).toBe(200);
    expect((await put(AR, L, XS1, { rating: 3 })).status).toBe(404);
    expect((await put(X, L2, S1, { rating: 3 })).status).toBe(404);
    expect((await put(OWN, L, PS1, { rating: 3 })).status).toBe(404);
    expect((await put(STRANGER, L, S1, { rating: 3 })).status).toBe(404);
    expect((await put(OWN, L, B1, { rating: 3 })).status).toBe(404);
    expect((await put(null, L, S1, { rating: 3 })).status).toBe(401);
    expect(rows()).toHaveLength(1);
  });
});

describe('GET reviews', () => {
  beforeEach(async () => {
    await put(AR, L, S1, { rating: 4, verdict: 'shortlist', note: 'love the hook' });
    await put(OWN, L, S1, { rating: 2, verdict: 'pass' });
    await put(AR_C2, L, S2, { rating: 5 });
  });

  it('the song\'s artist sees every review, rating, verdict and note (D5) — and cannot add one', async () => {
    const res = await list(ART, L, S1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews.map((r: { reviewer: string }) => r.reviewer).sort()).toEqual(['Ada', 'Owner']);
    expect(body.reviews.find((r: { reviewer: string }) => r.reviewer === 'Ada')).toMatchObject({ rating: 4, verdict: 'shortlist', note: 'love the hook', mine: false });
    expect(body.summary).toMatchObject({ count: 2, rated: 2, average: 3 });
    expect(body.canReview).toBe(false);
  });

  it('another artist of the same label gets 404 and nothing (acceptance)', async () => {
    // Kilo's roster artist: a different scope
    db.tables.org_members.push(member(u(9), 'artist', [], 'artists'));
    db.tables.member_artist_scopes.push({ org_id: L, user_id: u(9), contact_id: C2 });
    const res = await list(u(9), L, S1);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('love the hook');
    expect((await list(u(9), L, S2)).status).toBe(200);
  });

  it('a scoped A&R sees their artist\'s song only; a whole-org A&R sees all; mine is flagged', async () => {
    expect((await list(AR_C2, L, S1)).status).toBe(404);
    expect((await (await list(AR_C2, L, S2)).json()).reviews).toHaveLength(1);
    const own = await (await list(AR, L, S1)).json();
    expect(own.reviews.filter((r: { mine: boolean }) => r.mine)).toHaveLength(1);
    expect(own.canReview).toBe(true);
  });

  it('a member with no review ability (marketing) is refused: 403, no ratings', async () => {
    const res = await list(MKT, L, S1);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('love the hook');
  });

  it('other orgs, non-members and anonymous callers get nothing', async () => {
    expect((await list(X, L2, S1)).status).toBe(404);
    expect((await list(X, L, S1)).status).toBe(404);
    expect((await list(STRANGER, L, S1)).status).toBe(404);
    expect((await list(null, L, S1)).status).toBe(401);
    expect((await list(OWN, L, PS1)).status).toBe(404);
  });
});
