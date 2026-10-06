/**
 * GET /api/org/[orgId]/ar (LABEL-25) through the REAL org-access and inbox
 * store against an in-memory database.
 *   L: artists Nova (C1), Kilo (C2). Nova's project LP1 holds S1 (inbox, older),
 *   S4 (in_review), S5 (passed: not in the inbox), a beat and a master. Kilo's
 *   Inbox LP2 holds S2. Members: owner, A&R (whole org), A&R scoped to Kilo,
 *   marketing, roster artist Nova.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1), AR = u(2), MKT = u(3), AR_C2 = u(5), ART = u(6), STRANGER = u(8);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1), S2 = t(2), S4 = t(4), S5 = t(5), B1 = t(6), WIP = t(7);

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org') => ({ org_id: L, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const track = (id: string, type: string, title: string, stage: string | null, created: string) => ({ id, org_id: L, user_id: null, type, title, song_stage: stage, created_at: created });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }],
      org_members: [member(OWN, 'owner'), member(AR, 'member', ['a_and_r']), member(MKT, 'member', ['marketing']), member(AR_C2, 'member', ['a_and_r'], 'artists'), member(ART, 'artist', [], 'artists')],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [{ id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' }, { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' }],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 }, { project_id: LP1, track_id: S4, position: 1 }, { project_id: LP1, track_id: S5, position: 2 },
        { project_id: LP1, track_id: B1, position: 3 }, { project_id: LP1, track_id: WIP, position: 4 }, { project_id: LP2, track_id: S2, position: 0 },
      ],
      tracks: [
        track(S1, 'song', 'Midnight', 'inbox', '2026-10-01T10:00:00Z'),
        track(S2, 'song', 'Dawn', 'inbox', '2026-10-02T10:00:00Z'),
        track(S4, 'song', 'Noon', 'in_review', '2026-10-01T12:00:00Z'),
        track(S5, 'song', 'Gone', 'passed', '2026-09-01T10:00:00Z'),
        track(B1, 'beat', 'Beat', null, '2026-09-01T10:00:00Z'),
        track(WIP, 'song', 'Working', 'inbox', '2026-10-03T10:00:00Z'),
      ],
      track_links: [{ from_track_id: WIP, to_track_id: B1, relation: 'demo' }, { from_track_id: B1, to_track_id: WIP, relation: 'demo' }],
      song_beats: [],
      release_items: [],
      user_profiles: [],
      song_reviews: [
        { org_id: L, track_id: S1, reviewer_id: AR, rating: 4, verdict: 'shortlist', note: 'mine' },
        { org_id: L, track_id: S1, reviewer_id: OWN, rating: 2, verdict: null, note: null },
      ],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function get(as: string | null, org = L) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/ar`), { params: Promise.resolve({ orgId: org }) });
}

describe('GET the inbox', () => {
  it('lists inbox and in_review songs only, oldest first, with artist, my review and the summary', async () => {
    const body = await (await get(AR)).json();
    expect(body.songs.map((s: { id: string }) => s.id)).toEqual([S1, S4, S2, WIP]);
    const s1 = body.songs[0];
    expect(s1).toMatchObject({ title: 'Midnight', stage: 'inbox', artist: { name: 'Nova' }, project: { name: 'Nova EP' } });
    expect(s1.mine).toEqual({ rating: 4, verdict: 'shortlist', note: 'mine' });
    expect(s1.summary).toMatchObject({ count: 2, rated: 2, average: 3 });
    expect(body.songs[2].artist).toMatchObject({ name: 'Kilo' });
    expect(body.canReview).toBe(true);
  });

  it('a member scoped to Kilo sees only Kilo\'s songs', async () => {
    const body = await (await get(AR_C2)).json();
    expect(body.songs.map((s: { id: string }) => s.id)).toEqual([S2]);
  });

  it('the song\'s artist sees their songs, can read but not review', async () => {
    const body = await (await get(ART)).json();
    expect(body.songs.map((s: { id: string }) => s.id)).toEqual([S1, S4, WIP]); // her own working material too (D4: audio.working, own)
    expect(body.canReview).toBe(false);
  });

  it('D4: marketing may not read working songs — counted as restricted, never named', async () => {
    const body = await (await get(MKT)).json();
    expect(body.songs).toEqual([]);
    expect(body.restricted).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('Midnight');
  });

  it('refuses a stranger and an anonymous caller', async () => {
    expect((await get(STRANGER)).status).toBe(403);
    expect((await get(null)).status).toBe(401);
  });
});
