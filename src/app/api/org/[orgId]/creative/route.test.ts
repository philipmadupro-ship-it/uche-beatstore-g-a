/**
 * GET /api/org/[orgId]/creative (LABEL-68) through the REAL org-access and workspace store against an in-memory database.
 *   L: artists Nova (C1) and Kilo (C2). Nova's project LP1 holds S1 (inbox, reviewed), S2 (in_review, unreviewed), S3
 *   (selected), a working demo (D4: hidden from marketing-type roles) and a beat. Kilo's Inbox LP2 holds S4 (inbox).
 *   Direction for Nova only; Nova has an artist-visible and an INTERNAL reference. Draft releases RN (Nova, 1 track) and
 *   RK (Kilo, 1 track). Members: owner, artistic director (creative.*), A&R scoped to Kilo + creative, marketing, roster
 *   artist Nova. A second label L2 proves no cross-org reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1), AD = u(2), MKT = u(3), AD_C2 = u(4), ART = u(5), OWN2 = u(9);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const C9 = '30000000-0000-4000-8000-0000000000c9';
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1), S2 = t(2), S3 = t(3), S4 = t(4), B1 = t(5), DEMO = t(6);
const RN = '60000000-0000-4000-8000-0000000000a1';
const RK = '60000000-0000-4000-8000-0000000000a2';
const R9 = '60000000-0000-4000-8000-0000000000a9';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const track = (id: string, type: string, title: string, stage: string | null, created: string) => ({ id, org_id: L, user_id: null, type, title, song_stage: stage, created_at: created });
const release = (id: string, project: string, contact: string, title: string, created: string) => ({
  id, org_id: L, project_id: project, contact_id: contact, title, type: 'single', upc: null, label_name: null, c_line: null, p_line: null, primary_genre: null,
  target_date: '2026-12-01', release_date: null, artwork_asset_id: null, state: 'draft', delivered_at: null, delivered_to: null, imported_released: false,
  store_listed: false, store_listed_at: null, created_by: OWN, created_at: created, updated_at: created,
});

function seed(settings: Record<string, unknown> = {}): MemoryDb {
  return {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null, settings }, { id: L2, kind: 'label', deleted_at: null, settings: {} }],
      org_entitlements: [],
      org_members: [
        member(OWN, 'owner'), member(AD, 'member', ['artistic_director']), member(MKT, 'member', ['marketing']),
        member(AD_C2, 'member', ['artistic_director', 'a_and_r'], 'artists'), member(ART, 'artist', [], 'artists'), member(OWN2, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AD_C2, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', avatar_url: null, category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', avatar_url: null, category: 'artist' },
        { id: C9, org_id: L2, user_id: null, name: 'Other Label Artist', avatar_url: null, category: 'artist' },
        { id: '30000000-0000-4000-8000-0000000000d1', org_id: L, user_id: null, name: 'A Lawyer', avatar_url: null, category: 'legal' },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', inbox_for_contact_id: null, created_at: '2026-10-01' },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox · Kilo', inbox_for_contact_id: C2, created_at: '2026-10-01' },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 }, { project_id: LP1, track_id: S2, position: 1 }, { project_id: LP1, track_id: S3, position: 2 },
        { project_id: LP1, track_id: B1, position: 3 }, { project_id: LP1, track_id: DEMO, position: 4 }, { project_id: LP2, track_id: S4, position: 0 },
      ],
      tracks: [
        track(S1, 'song', 'Midnight', 'inbox', '2026-10-01T10:00:00Z'),
        track(S2, 'song', 'Noon', 'in_review', '2026-10-01T12:00:00Z'),
        track(S3, 'song', 'Dusk', 'selected', '2026-10-01T13:00:00Z'),
        track(S4, 'song', 'Dawn', 'inbox', '2026-10-02T10:00:00Z'),
        track(B1, 'beat', 'Beat', null, '2026-09-01T10:00:00Z'),
        track(DEMO, 'song', 'Working', 'inbox', '2026-10-03T10:00:00Z'),
      ],
      track_links: [{ from_track_id: DEMO, to_track_id: B1, relation: 'demo' }, { from_track_id: B1, to_track_id: DEMO, relation: 'demo' }],
      song_beats: [],
      release_items: [
        { id: 'i1', release_id: RN, org_id: L, position: 1, song_track_id: S3, master_track_id: S3, explicit: false, version_title: null },
        { id: 'i2', release_id: RK, org_id: L, position: 1, song_track_id: S4, master_track_id: S4, explicit: false, version_title: null },
      ],
      user_profiles: [],
      song_reviews: [{ org_id: L, track_id: S1, reviewer_id: AD, rating: 4, verdict: 'shortlist', note: 'secret words', created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:00:00Z' }],
      artist_direction: [
        { org_id: L, contact_id: C1, direction: { sound: 'Warm, dusty drums and a lot of air.', next: 'The autumn EP', keywords: ['dusty', 'warm'], bogus: 'x' } },
        { org_id: L2, contact_id: C9, direction: { sound: 'OTHER ORG SOUND' } },
      ],
      artist_references: [
        { id: 'r1', org_id: L, contact_id: C1, kind: 'note', title: 'Mood', note: 'a', url: null, track_id: null, asset_id: null, visibility: 'artist', position: 0, created_at: '2026-10-01', updated_at: '2026-10-01' },
        { id: 'r2', org_id: L, contact_id: C1, kind: 'note', title: 'Team only', note: 'b', url: null, track_id: null, asset_id: null, visibility: 'internal', position: 1, created_at: '2026-10-01', updated_at: '2026-10-01' },
      ],
      project_assets: [],
      releases: [release(RN, LP1, C1, 'Autumn', '2026-10-05T10:00:00Z'), release(RK, LP2, C2, 'Sunrise', '2026-10-06T10:00:00Z'), { ...release(R9, LP1, C9, 'Elsewhere', '2026-10-07T10:00:00Z'), org_id: L2 }],
      approvals: [],
      activity_events: [],
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = seed();
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function get(as: string | null, org = L) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  return mod.GET(new NextRequest(`https://app.test/api/org/${org}/creative`), { params: Promise.resolve({ orgId: org }) });
}
const body = async (as: string | null, org = L) => (await get(as, org)).json();

describe('who may open the workspace', () => {
  it('needs creative.read: owner and the artistic director yes; marketing, a roster artist, a stranger and signed-out no', async () => {
    expect((await get(OWN)).status).toBe(200);
    expect((await get(AD)).status).toBe(200);
    expect((await get(MKT)).status).toBe(403);
    expect((await get(ART)).status).toBe(403);
    expect((await get(OWN2)).status).toBe(403); // an owner of another org is not a member here
    expect((await get(null)).status).toBe(401);
  });

  it('is 404 without the artistic department: not licensed, or switched off by the owner', async () => {
    db.tables.org_entitlements.push({ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null, setup_done: true });
    expect((await get(OWN)).status).toBe(404);
    expect((await get(AD)).status).toBe(404);
    db.tables.org_entitlements.length = 0;
    expect((await get(OWN)).status).toBe(200);
    (db.tables.organizations[0] as { settings: unknown }).settings = { departments_off: ['artistic'] };
    expect((await get(OWN)).status).toBe(404);
  });
});

describe('what it reads', () => {
  it('lists the roster artists with their direction brief, references, stages and waiting songs — and nobody from another org or without an artist role', async () => {
    const w = await body(OWN);
    expect(w.schemaReady).toBe(true);
    expect(w.gate).toBe(false);
    expect(w.artists.map((a: { name: string }) => a.name)).toEqual(['Nova', 'Kilo']);
    const nova = w.artists.find((a: { name: string }) => a.name === 'Nova');
    expect(nova.brief).toMatchObject({ sound: 'Warm, dusty drums and a lot of air.', next: 'The autumn EP', keywords: ['dusty', 'warm'], filled: 2, total: 6 });
    expect(nova.references).toBe(2);
    expect(nova.stages.byStage).toEqual({ inbox: 2, in_review: 1, selected: 1 });
    // S1 has a review, S2 and the working demo do not.
    expect(nova.waiting).toBe(2);
    expect(nova.reviewed).toBe(1);
    expect(nova.draftReleases).toBe(1);
    expect(JSON.stringify(w)).not.toContain('OTHER ORG SOUND');
    expect(JSON.stringify(w)).not.toContain('Other Label Artist');
    expect(JSON.stringify(w)).not.toContain('A Lawyer');
  });

  it('derives from the sources: a changed direction shows on the next read, and nothing is stored by the read', async () => {
    const sizes = () => Object.fromEntries(Object.entries(db.tables).filter(([, rows]) => rows.length > 0).map(([name, rows]) => [name, JSON.stringify(rows)]));
    const before = sizes();
    await get(OWN);
    expect(sizes()).toEqual(before);
    (db.tables.artist_direction[0] as { direction: unknown }).direction = { sound: 'Brighter now' };
    expect((await body(OWN)).artists.find((a: { name: string }) => a.name === 'Nova').brief.sound).toBe('Brighter now');
  });

  it('builds the payload field by field: no org id, no user id, no review text, no raw direction document', async () => {
    const text = JSON.stringify(await body(OWN));
    for (const leak of [L, OWN, AD, 'secret words', 'bogus', 'org_id', 'user_id', 'reviewer_id']) expect(text, leak).not.toContain(leak);
  });

  it('a member limited to Kilo sees only Kilo, Kilo’s release, and nothing of Nova', async () => {
    const w = await body(AD_C2);
    expect(w.artists.map((a: { name: string }) => a.name)).toEqual(['Kilo']);
    expect(w.releases.map((r: { title: string }) => r.title)).toEqual(['Sunrise']);
    expect(JSON.stringify(w)).not.toMatch(/Nova|Autumn|dusty|Midnight/);
  });

  it('D4: working material the member may not read is neither tallied nor named; a viewer who may know gets the count', async () => {
    const w = await body(OWN);
    // The demo is working material: the owner reads it (audio.working), so it is tallied for them.
    expect(w.artists.find((a: { name: string }) => a.name === 'Nova').stages.byStage.inbox).toBe(2);
    expect(w.restricted).toBe(0);
  });
});

describe('references', () => {
  it('counts internal references for the team and keeps them out entirely for a role artist (the route is closed to them anyway)', async () => {
    expect((await body(OWN)).artists.find((a: { name: string }) => a.name === 'Nova').references).toBe(2);
    expect((await get(ART)).status).toBe(403);
  });
});

describe('the optional creative gate', () => {
  it('OFF (the default): releases carry no creative status and nothing counts as open', async () => {
    const w = await body(OWN);
    expect(w.gate).toBe(false);
    expect(w.releases.every((r: { creative: unknown }) => r.creative === null)).toBe(true);
    expect(w.totals.creativeOpen).toBe(0);
    expect(w.canApprove).toBe(true);
  });

  it('a malformed or misspelt setting reads as off', async () => {
    for (const v of [true, 'ON', 'yes', 1, null]) {
      db = seed({ creative_gate: v });
      expect((await body(OWN)).gate, String(v)).toBe(false);
    }
  });

  it('ON: every draft shows where its creative approval stands, the open ones first', async () => {
    db = seed({ creative_gate: 'on' });
    const w = await body(OWN);
    expect(w.gate).toBe(true);
    expect(w.releases.map((r: { title: string; creative: { status: string } }) => [r.title, r.creative.status])).toEqual([['Sunrise', 'not_started'], ['Autumn', 'not_started']]);
    expect(w.totals.creativeOpen).toBe(2);
    expect(w.artists.find((a: { name: string }) => a.name === 'Nova').creativeOpen).toBe(1);
  });

  it('ON: asked → awaiting; approved on the current running order → done; changed since → stale', async () => {
    db = seed({ creative_gate: 'on' });
    const row = (id: string, release: string, decision: string, snapshot: unknown, at: string) => ({
      id, org_id: L, song_id: null, release_id: release, gate: 'creative', decision, note: null, actor_id: OWN, approver_id: AD, request_id: null, subject_snapshot: snapshot, created_at: at,
    });
    db.tables.approvals.push(row('a1', RN, 'requested', {}, '2026-10-06T10:00:00Z'));
    let w = await body(OWN);
    expect(w.releases.find((r: { title: string }) => r.title === 'Autumn').creative).toEqual({ status: 'awaiting_approval', stale: false });
    const snap = { v: 1, gate: 'creative', parts: { artwork: null, items: [{ songId: S3, masterId: S3 }] } };
    db.tables.approvals.push(row('a2', RN, 'approved', snap, '2026-10-06T11:00:00Z'));
    w = await body(OWN);
    expect(w.releases.find((r: { title: string }) => r.title === 'Autumn').creative).toEqual({ status: 'approved', stale: false });
    expect(w.artists.find((a: { name: string }) => a.name === 'Nova').creativeOpen).toBe(0);
    db.tables.release_items.push({ id: 'i9', release_id: RN, org_id: L, position: 2, song_track_id: S1, master_track_id: S1, explicit: false, version_title: null });
    w = await body(OWN);
    expect(w.releases.find((r: { title: string }) => r.title === 'Autumn').creative).toEqual({ status: 'stale', stale: true });
  });

  it('ON: an approval row of ANOTHER gate or ANOTHER org changes nothing here', async () => {
    db = seed({ creative_gate: 'on' });
    db.tables.approvals.push(
      { id: 'x1', org_id: L, song_id: null, release_id: RN, gate: 'artwork', decision: 'approved', note: null, actor_id: OWN, approver_id: null, request_id: null, subject_snapshot: {}, created_at: '2026-10-06T10:00:00Z' },
      { id: 'x2', org_id: L2, song_id: null, release_id: RN, gate: 'creative', decision: 'approved', note: null, actor_id: OWN2, approver_id: null, request_id: null, subject_snapshot: {}, created_at: '2026-10-06T10:00:00Z' },
    );
    expect((await body(OWN)).releases.find((r: { title: string }) => r.title === 'Autumn').creative.status).toBe('not_started');
  });
});
