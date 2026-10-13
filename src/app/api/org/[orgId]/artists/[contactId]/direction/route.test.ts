/**
 * Creative direction (LABEL-26) through the REAL lib/auth/org-access,
 * direction(-store) and activity against an in-memory database that
 * evaluates filters, so a leak (an internal reference to an artist-role
 * member, another artist's, another org's) is a failing assertion.
 *
 *   L (label): artists C1 (Nova), C2 (Kilo). LP1: Nova's project with song S1
 *     (finished: selected) and a demo S3 (inbox — working material), file F1
 *     (artwork, normal), F2 (contract, restricted), F3 (artwork on Kilo's Inbox).
 *     Members: OWN (owner), AR (A&R, whole org), MKT (marketing, whole org),
 *     AR_C2 (A&R scoped to Kilo), ART (roster artist Nova, role `artist`).
 *   L2: owner X, artist CX.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const AR = u(2);
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
const S1 = t(1); // Nova's finished song
const S3 = t(3); // Nova's demo (working material)
const S2 = t(2); // Kilo's song
const XS1 = t(9);
const F1 = '60000000-0000-4000-8000-000000000001';
const F2 = '60000000-0000-4000-8000-000000000002';
const F3 = '60000000-0000-4000-8000-000000000003';
const R_PUBLIC = '70000000-0000-4000-8000-000000000001';
const R_INTERNAL = '70000000-0000-4000-8000-000000000002';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({
  org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [],
});
const song = (id: string, org: string, title: string, stage: string) => ({ id, org_id: org, user_id: null, type: 'song', title, song_stage: stage });
const asset = (id: string, project: string, kind: string, sensitivity: string, label: string) => ({
  id, org_id: L, project_id: project, kind, sensitivity, label, file_name: `${label}.png`, url: 'r2://priv/x', mime: 'image/png', size_bytes: 10, position: 0, in_portal: false, portal_at: null, created_at: '2026-10-01', created_by: OWN,
});
const ref = (id: string, contact: string, over: Record<string, unknown>) => ({
  id, org_id: L, contact_id: contact, kind: 'note', title: 'T', note: 'n', url: null, track_id: null, asset_id: null,
  visibility: 'artist', position: 0, created_by: OWN, created_at: '2026-10-01', updated_at: '2026-10-01', ...over,
});

const route = () => import('./route');
const refs = () => import('../references/route');
const item = () => import('../references/[referenceId]/route');
const choices = () => import('../references/choices/route');
const base = (org: string, c: string) => `https://app.test/api/org/${org}/artists/${c}`;
const p = (c: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ orgId: L, contactId: c, referenceId: '', ...extra }) });
const send = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

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
        { project_id: LP1, track_id: S3, position: 1 },
        { project_id: LP2, track_id: S2, position: 0 },
        { project_id: XP1, track_id: XS1, position: 0 },
      ],
      tracks: [song(S1, L, 'Midnight', 'selected'), song(S3, L, 'Midnight demo', 'inbox'), song(S2, L, 'Dawn', 'selected'), song(XS1, L2, 'Xen single', 'inbox')],
      project_assets: [asset(F1, LP1, 'artwork', 'normal', 'Mood board'), asset(F2, LP1, 'contract', 'restricted', 'Deal'), asset(F3, LP2, 'artwork', 'normal', 'Kilo cover')],
      artist_direction: [],
      artist_references: [],
      activity_events: [],
      release_items: [],
      song_beats: [],
      track_links: [],
      user_profiles: [],
    },
  };
});

describe('GET direction', () => {
  it('returns the structured document and the references, built field by field', async () => {
    db.tables.artist_direction.push({ contact_id: C1, org_id: L, direction: { sound: 'Dusty drums', secret: 'x' }, updated_by: OWN, updated_at: '2026-10-02' });
    db.tables.artist_references.push(ref(R_PUBLIC, C1, { title: 'Mood', kind: 'note', note: 'Late night drives' }));
    current = AR;
    const res = await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.direction).toEqual({ sound: 'Dusty drums' });
    expect(body.references).toHaveLength(1);
    expect(Object.keys(body.references[0]).sort()).toEqual(['assetId', 'createdAt', 'file', 'host', 'id', 'kind', 'note', 'position', 'title', 'trackId', 'trackTitle', 'url', 'visibility']);
    expect(JSON.stringify(body)).not.toContain(L);
    expect(body.permissions).toEqual({ write: true, internal: true });
  });

  it('an INTERNAL reference is absent for the roster artist — not counted either — and present for the team', async () => {
    db.tables.artist_references.push(ref(R_PUBLIC, C1, { title: 'Open note' }), ref(R_INTERNAL, C1, { title: 'Candid A&R read', visibility: 'internal', position: 1 }));
    current = ART;
    const asArtist = await (await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).json();
    expect(asArtist.references.map((r: { title: string }) => r.title)).toEqual(['Open note']);
    expect(asArtist.restrictedReferences).toBe(0);
    expect(asArtist.permissions.internal).toBe(false);
    expect(JSON.stringify(asArtist)).not.toContain('Candid');
    for (const user of [OWN, AR, MKT]) {
      current = user;
      const body = await (await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).json();
      expect(body.references.map((r: { title: string }) => r.title), user).toEqual(['Open note', 'Candid A&R read']);
    }
  });

  it('an unknown visibility value is treated as internal (allowlist)', async () => {
    db.tables.artist_references.push(ref(R_INTERNAL, C1, { title: 'Odd', visibility: 'friends' }));
    current = ART;
    const body = await (await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).json();
    expect(body.references).toEqual([]);
  });

  it('a scoped member sees only their artists: another artist, another org, a producer id and a stranger are 404', async () => {
    current = AR_C2;
    expect((await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).status).toBe(404);
    expect((await (await route()).GET(send(`${base(L, C2)}/direction`, 'GET'), p(C2))).status).toBe(200);
    current = ART;
    expect((await (await route()).GET(send(`${base(L, C2)}/direction`, 'GET'), p(C2))).status).toBe(404);
    current = AR;
    expect((await (await route()).GET(send(`${base(L, CX)}/direction`, 'GET'), p(CX))).status).toBe(404);
    current = STRANGER;
    expect((await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).status).toBe(404);
    current = null;
    expect((await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).status).toBe(401);
  });

  it('a track the member may not read is counted as restricted, never titled', async () => {
    db.tables.artist_references.push(ref(R_PUBLIC, C1, { kind: 'track', title: 'Demo ref', note: null, track_id: S3 }));
    current = MKT; // marketing: finished music only (D4)
    const mkt = await (await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).json();
    expect(mkt.references).toEqual([]);
    expect(mkt.restrictedReferences).toBe(1);
    current = AR;
    const ar = await (await (await route()).GET(send(`${base(L, C1)}/direction`, 'GET'), p(C1))).json();
    expect(ar.references[0]).toMatchObject({ kind: 'track', trackId: S3, trackTitle: 'Midnight demo' });
  });
});

describe('PUT direction', () => {
  it('saves the document, records an event naming fields, and a repeat save writes nothing', async () => {
    current = AR;
    const put = async (direction: Record<string, unknown>) => (await route()).PUT(send(`${base(L, C1)}/direction`, 'PUT', { direction }), p(C1));
    const first = await put({ sound: '  Dusty drums  ', keywords: ['Soul', 'soul', 'Dusty'] });
    expect(first.status).toBe(200);
    expect(db.tables.artist_direction[0]).toMatchObject({ contact_id: C1, org_id: L, direction: { sound: 'Dusty drums', keywords: ['Soul', 'Dusty'] }, updated_by: AR });
    expect(db.tables.activity_events).toHaveLength(1);
    expect(db.tables.activity_events[0]).toMatchObject({ verb: 'direction.updated', artist_id: C1 });
    expect(JSON.stringify(db.tables.activity_events[0])).not.toContain('Dusty');
    const again = await put({ sound: 'Dusty drums', keywords: ['Soul', 'Dusty'] });
    expect(again.status).toBe(200);
    expect(db.tables.activity_events).toHaveLength(1);
    const changed = await put({ sound: 'Dusty drums', keywords: ['Soul', 'Dusty'], avoid: 'Trap hi-hats' });
    expect(changed.status).toBe(200);
    expect(db.tables.activity_events[1].payload).toMatchObject({ fields: ['avoid'] });
  });

  it('refuses an oversized field, an unknown key and a non-writer, and another artist direction is 404', async () => {
    current = AR;
    const bad = await (await route()).PUT(send(`${base(L, C1)}/direction`, 'PUT', { direction: { sound: 'x'.repeat(601) } }), p(C1));
    expect(bad.status).toBe(400);
    const unknown = await (await route()).PUT(send(`${base(L, C1)}/direction`, 'PUT', { direction: { wiki: 'x' } }), p(C1));
    expect(unknown.status).toBe(400);
    current = MKT;
    expect((await (await route()).PUT(send(`${base(L, C1)}/direction`, 'PUT', { direction: { sound: 'x' } }), p(C1))).status).toBe(403);
    current = AR_C2;
    expect((await (await route()).PUT(send(`${base(L, C1)}/direction`, 'PUT', { direction: { sound: 'x' } }), p(C1))).status).toBe(404);
    expect(db.tables.artist_direction).toEqual([]);
  });
});

describe('references', () => {
  const add = async (user: string, contact: string, body: unknown) => {
    current = user;
    return (await refs()).POST(send(`${base(L, contact)}/references`, 'POST', body), p(contact));
  };

  it('adds a link, a note, a track and a file; the title defaults from the pointer; events carry the kind only', async () => {
    expect((await add(AR, C1, { kind: 'link', title: 'Playlist', url: 'https://open.spotify.com/playlist/1', note: 'the lane' })).status).toBe(201);
    expect((await add(AR, C1, { kind: 'note', title: 'Tone', note: 'Warm, close, unhurried' })).status).toBe(201);
    const track = await add(AR, C1, { kind: 'track', track_id: S1 });
    expect(track.status).toBe(201);
    expect((await track.json()).reference).toMatchObject({ kind: 'track', title: 'Midnight', trackTitle: 'Midnight' });
    const file = await add(AR, C1, { kind: 'file', asset_id: F1 });
    expect(file.status).toBe(201);
    expect((await file.json()).reference.file.downloadUrl).toBe(`/api/org/${L}/projects/${LP1}/assets/${F1}/download`);
    expect(db.tables.artist_references.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(db.tables.activity_events.map((e) => e.verb)).toEqual(Array(4).fill('reference.added'));
    expect(JSON.stringify(db.tables.activity_events)).not.toContain('Warm');
    expect(db.tables.activity_events.every((e) => e.visibility === 'artist')).toBe(true);
  });

  it('refuses what a reference may not point at: http, javascript:, restricted files, another artist\'s project files are fine but another org\'s are not', async () => {
    for (const url of ['http://a.com/x', 'javascript:alert(1)', 'https://user:pw@a.com/x', 'not a url']) {
      expect((await add(AR, C1, { kind: 'link', title: 'x', url })).status, url).toBe(400);
    }
    expect((await add(AR, C1, { kind: 'file', asset_id: F2 })).status).toBe(404); // restricted contract
    expect((await add(AR, C1, { kind: 'track', track_id: XS1 })).status).toBe(404); // another org's track
    expect((await add(AR, C1, { kind: 'track', track_id: S1, url: 'https://a.com' })).status).toBe(400);
    expect((await add(AR, C1, { kind: 'note', title: 'x' })).status).toBe(400);
    expect((await add(MKT, C1, { kind: 'track', track_id: S3 })).status).toBe(403); // marketing cannot write at all
    expect(db.tables.artist_references).toEqual([]);
  });

  it('a track the writer cannot open is 404 (D4), and a scoped writer cannot reference outside their artists', async () => {
    expect((await add(AR_C2, C2, { kind: 'track', track_id: S1 })).status).toBe(404); // Nova's song, Kilo-scoped member
    expect((await add(AR_C2, C2, { kind: 'file', asset_id: F1 })).status).toBe(404);
    expect((await add(AR_C2, C2, { kind: 'file', asset_id: F3 })).status).toBe(201);
    expect((await add(AR_C2, C1, { kind: 'note', title: 'x', note: 'y' })).status).toBe(404);
  });

  it('an internal reference needs a team role; its event is internal', async () => {
    expect((await add(AR, C1, { kind: 'note', title: 'Candid', note: 'hmm', visibility: 'internal' })).status).toBe(201);
    expect(db.tables.activity_events[0].visibility).toBe('internal');
    // The roster artist holds catalog.write (their own material) but is not the team: no internal reference.
    expect((await add(ART, C1, { kind: 'note', title: 'x', note: 'y', visibility: 'internal' })).status).toBe(403);
    expect((await add(ART, C1, { kind: 'note', title: 'Mine', note: 'y' })).status).toBe(201);
  });

  it('PATCH / DELETE: edit and remove; an internal one is a 404 for the roster artist, who does hold catalog.write', async () => {
    db.tables.artist_references.push(ref(R_PUBLIC, C1, { title: 'Open', kind: 'link', note: null, url: 'https://a.com/x' }), ref(R_INTERNAL, C1, { title: 'Candid', visibility: 'internal', position: 1 }));
    current = AR;
    const patch = (id: string, body: unknown) => item().then((m) => m.PATCH(send(`${base(L, C1)}/references/${id}`, 'PATCH', body), p(C1, { referenceId: id })));
    const del = (id: string) => item().then((m) => m.DELETE(send(`${base(L, C1)}/references/${id}`, 'DELETE'), p(C1, { referenceId: id })));
    expect((await patch(R_PUBLIC, { title: 'Renamed', url: 'https://b.com/y' })).status).toBe(200);
    expect(db.tables.artist_references.find((r) => r.id === R_PUBLIC)).toMatchObject({ title: 'Renamed', url: 'https://b.com/y' });
    expect((await patch(R_PUBLIC, { url: 'http://b.com' })).status).toBe(400);
    expect((await patch(R_INTERNAL, { note: null })).status).toBe(400); // a note needs its note

    current = ART; // role `artist` holds catalog.write; that is not the team
    expect((await patch(R_INTERNAL, { title: 'seen' })).status).toBe(404);
    expect((await del(R_INTERNAL)).status).toBe(404);
    expect((await patch(R_PUBLIC, { visibility: 'internal' })).status).toBe(403);
    expect(db.tables.artist_references).toHaveLength(2);
    expect(db.tables.artist_references.find((r) => r.id === R_INTERNAL)).toMatchObject({ title: 'Candid' });

    current = AR;
    expect((await del(R_INTERNAL)).status).toBe(200);
    expect(db.tables.artist_references.map((r) => r.id)).toEqual([R_PUBLIC]);
    expect(db.tables.activity_events.at(-1)).toMatchObject({ verb: 'reference.removed', visibility: 'internal' });
  });

  it('a reference of another artist or another org is 404 under this artist\'s path', async () => {
    db.tables.artist_references.push(ref(R_PUBLIC, C2, { title: 'Kilo ref' }));
    current = AR;
    const res = await (await item()).DELETE(send(`${base(L, C1)}/references/${R_PUBLIC}`, 'DELETE'), p(C1, { referenceId: R_PUBLIC }));
    expect(res.status).toBe(404);
    expect(db.tables.artist_references).toHaveLength(1);
  });
});

describe('choices', () => {
  it('lists tracks the member may read and the artist\'s visual files — nothing restricted, nothing foreign', async () => {
    current = AR;
    const get = async (qs: string, c = C1) => (await (await choices()).GET(send(`${base(L, c)}/references/choices?${qs}`, 'GET'), p(c))).json();
    const tracks = await get('kind=track&q=midnight');
    expect(tracks.tracks.map((x: { id: string }) => x.id).sort()).toEqual([S1, S3].sort());
    expect(JSON.stringify(tracks)).not.toContain('Xen');
    const files = await get('kind=file');
    expect(files.files.map((f: { id: string }) => f.id)).toEqual([F1]);
    current = AR_C2;
    const scoped = await get('kind=track&q=', C2);
    expect(scoped.tracks.map((x: { id: string }) => x.id)).toEqual([S2]);
    current = MKT;
    expect((await (await choices()).GET(send(`${base(L, C1)}/references/choices?kind=file`, 'GET'), p(C1))).status).toBe(403);
    current = AR;
    expect((await (await choices()).GET(send(`${base(L, C1)}/references/choices?kind=x`, 'GET'), p(C1))).status).toBe(400);
  });
});
