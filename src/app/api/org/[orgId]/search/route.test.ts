/**
 * GET /api/org/[orgId]/search (LABEL-36) through the REAL org-access and the
 * real search store against an in-memory database whose `search_tsv`
 * emulates migration 159's generated columns.
 *
 *   L: artists Nova (C1, project LP1) and Kilo (C2, Inbox LP2). Songs: S1 and
 *   S3 "Runnin …" in LP1 (S1 inbox, S3 selected), S2 "Runnin Away" in LP2.
 *   S1 has a master M1 (ISRC) and S2 a master M2 (another ISRC); R1 / R2 are
 *   releases in LP1 / LP2 with a UPC each; a producer track and contact share
 *   the word, and so does another org's song.
 * Members: owner, A&R (whole org), A&R scoped to Kilo, marketing, roster
 * artist Nova, a stranger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1), AR = u(2), MKT = u(3), AR_C2 = u(5), ART = u(6), STRANGER = u(8), PRODUCER = u(9);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const C3 = '30000000-0000-4000-8000-0000000000c3'; // a non-roster contact of Nova's circle
const LP1 = '40000000-0000-4000-8000-0000000000a1';
const LP2 = '40000000-0000-4000-8000-0000000000a2';
const XP = '40000000-0000-4000-8000-0000000000b1';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = t(1), S2 = t(2), S3 = t(3), M1 = t(4), M2 = t(5), PT = t(6), XS = t(7);
const R1 = '70000000-0000-4000-8000-000000000001';
const R2 = '70000000-0000-4000-8000-000000000002';
const PARTY1 = '80000000-0000-4000-8000-000000000001'; // credited on S1
const PARTY2 = '80000000-0000-4000-8000-000000000002'; // credited on S2
const F_ART = '90000000-0000-4000-8000-000000000001';
const F_DEAL = '90000000-0000-4000-8000-000000000002';
const F_KILO = '90000000-0000-4000-8000-000000000003';
const F_SESSION = '90000000-0000-4000-8000-000000000004';

const ISRC1 = 'GBAYE0601498';
const ISRC2 = 'USRC17607839';
const UPC1 = '036000291452';
const UPC2 = '012345678905';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const member = (user: string, role: string, functions: string[] = [], scope = 'org') => ({ org_id: L, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const track = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, org_id: L, user_id: null, type: 'song', title, song_stage: 'inbox', isrc: null, iswc: null, ...over });

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
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_C2, contact_id: C2 }, { org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova Runnin', category: 'artist', email: null, label: null, role: null },
        { id: C2, org_id: L, user_id: null, name: 'Kilo Runnin', category: 'artist', email: null, label: null, role: null },
        { id: C3, org_id: L, user_id: null, name: 'Runnin Manager', category: 'manager', email: null, label: null, role: 'Manager' },
        { id: 'p1', org_id: null, user_id: PRODUCER, name: 'Runnin producer contact', category: 'artist', email: null, label: null, role: null },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Runnin EP', description: null, inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox Runnin Kilo', description: null, inbox_for_contact_id: C2 },
        { id: XP, org_id: L2, user_id: null, name: 'Runnin L2', description: null, inbox_for_contact_id: null },
        { id: 'pp', org_id: null, user_id: PRODUCER, name: 'Runnin producer project', description: null, inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 }, { project_id: LP1, track_id: S3, position: 1 }, { project_id: LP1, track_id: M1, position: 2 },
        { project_id: LP2, track_id: S2, position: 0 }, { project_id: LP2, track_id: M2, position: 1 },
      ],
      tracks: [
        track(S1, 'Runnin Home'),
        track(S2, 'Runnin Away'),
        track(S3, 'Runnin Selected', { song_stage: 'selected' }),
        track(M1, 'Master of Home', { type: 'instrumental', song_stage: null, isrc: ISRC1 }),
        track(M2, 'Master of Away', { type: 'instrumental', song_stage: null, isrc: ISRC2 }),
        { id: PT, org_id: null, user_id: PRODUCER, type: 'song', title: 'Runnin producer song', song_stage: null, isrc: null, iswc: null },
        track(XS, 'Runnin L2 song', { org_id: L2 }),
      ],
      track_links: [
        { from_track_id: S1, to_track_id: M1, relation: 'master' },
        { from_track_id: S2, to_track_id: M2, relation: 'master' },
      ],
      song_beats: [],
      release_items: [],
      releases: [
        { id: R1, org_id: L, project_id: LP1, title: 'Runnin Home EP', label_name: null, state: 'draft', upc: UPC1 },
        { id: R2, org_id: L, project_id: LP2, title: 'Runnin Away Single', label_name: null, state: 'draft', upc: UPC2 },
      ],
      parties: [
        { id: PARTY1, org_id: L, display_name: 'Runnin Writer', legal_name: 'Rune Hansen', ipi: '00123456789', kind: 'person' },
        { id: PARTY2, org_id: L, display_name: 'Runnin Engineer', legal_name: null, ipi: null, kind: 'person' },
      ],
      track_collaborators: [
        { org_id: L, track_id: S1, party_id: PARTY1 },
        { org_id: L, track_id: S2, party_id: PARTY2 },
      ],
      project_assets: [
        { id: F_ART, org_id: L, project_id: LP1, kind: 'artwork', sensitivity: 'normal', label: 'Runnin art', file_name: 'art.png' },
        { id: F_DEAL, org_id: L, project_id: LP1, kind: 'contract', sensitivity: 'restricted', label: 'Runnin deal', file_name: 'deal.pdf' },
        { id: F_SESSION, org_id: L, project_id: LP1, kind: 'session', sensitivity: 'normal', label: 'Runnin session', file_name: 'x.zip' },
        { id: F_KILO, org_id: L, project_id: LP2, kind: 'artwork', sensitivity: 'normal', label: 'Runnin Kilo art', file_name: 'k.png' },
      ],
    },
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function search(as: string | null, q: string, org = L) {
  current = as;
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const res = await mod.GET(new NextRequest(`https://app.test/api/org/${org}/search?q=${encodeURIComponent(q)}`), { params: Promise.resolve({ orgId: org }) });
  return { status: res.status, body: await res.json() };
}
const ids = (body: { groups: { group: string; hits: { id: string }[] }[] }, group: string) =>
  (body.groups.find((g) => g.group === group)?.hits ?? []).map((h) => h.id);

describe('GET /api/org/[orgId]/search — text', () => {
  it('whole-org A&R: groups by entity in display order, prefix words, no producer or other-org rows', async () => {
    const { status, body } = await search(AR, 'runn');
    expect(status).toBe(200);
    expect(body.groups.map((g: { group: string }) => g.group)).toEqual(['artists', 'songs', 'releases', 'people', 'projects', 'files']);
    expect(ids(body, 'songs').sort()).toEqual([S1, S2, S3].sort());
    expect(ids(body, 'artists').sort()).toEqual([C1, C2].sort());
    expect(ids(body, 'people').sort()).toEqual([C3, PARTY1, PARTY2].sort()); // the non-roster contact, and the parties (A&R reads rights)
    expect(ids(body, 'projects').sort()).toEqual([LP1, LP2].sort());
    expect(ids(body, 'releases').sort()).toEqual([R1, R2].sort());
    const all = JSON.stringify(body);
    for (const leaked of [PT, XS, XP, 'p1', 'pp', 'Runnin producer', 'Runnin L2']) expect(all).not.toContain(leaked);
  });

  it('every word must match (AND), and the order is best match first', async () => {
    const both = await search(AR, 'runnin home');
    expect(ids(both.body, 'songs')).toEqual([S1]);
    const exact = await search(AR, 'Runnin Home');
    expect(ids(exact.body, 'songs')[0]).toBe(S1);
  });

  it('answers the hits and nothing about the others: no totals, counts, or "hidden" anywhere', async () => {
    const { body } = await search(MKT, 'runnin');
    expect(Object.keys(body).sort()).toEqual(['groups', 'jump', 'schemaReady']);
    expect(JSON.stringify(body)).not.toMatch(/count|total|hidden|restricted|more/i);
  });

  it('a punctuation-only or operator-laden query is harmless', async () => {
    for (const q of ['', '   ', "'; drop table tracks; --", '&|!():*', 'a,b),(c', 'runnin & !home | (x)']) {
      const { status } = await search(AR, q);
      expect(status).toBe(200);
    }
    const { body } = await search(AR, "runnin') or (id.neq.0");
    expect(body.groups).toEqual([]); // every word must match; the injected ones do not
  });

  it('caps each group', async () => {
    for (let i = 0; i < 12; i++) db.tables.tracks.push(track(t(100 + i), `Runnin Extra ${i}`));
    const { body } = await search(AR, 'runnin extra');
    expect(ids(body, 'songs').length).toBeLessThanOrEqual(6);
    expect(ids(body, 'songs').length).toBe(6);
  });
});

describe('LABEL-45 — tokenization and starvation', () => {
  it('a word inside a file name or an address is found: "mix" finds final_mix.wav, "x com" finds a@x.com', async () => {
    db.tables.project_assets.push({ id: 'f-mix', org_id: L, project_id: LP1, kind: 'artwork', sensitivity: 'normal', label: null, file_name: 'final_mix.wav' });
    db.tables.contacts.push({ id: 'c-mail', org_id: L, user_id: null, name: 'Ops', category: 'manager', email: 'a@x.com', label: null, role: null });
    expect(ids((await search(AR, 'mix')).body, 'files')).toEqual(['f-mix']);
    expect(ids((await search(AR, 'x com')).body, 'people')).toEqual(['c-mail']);
  });

  it('a file name stored decomposed (macOS) is found by the composed word a person types', async () => {
    db.tables.project_assets.push({ id: 'f-cafe', org_id: L, project_id: LP1, kind: 'artwork', sensitivity: 'normal', label: '', file_name: 'Cafe\u0301_Mix.wav' });
    expect(ids((await search(AR, 'café')).body, 'files')).toEqual(['f-cafe']);
  });

  it('finds a Hindi title and a Thai title by their own words', async () => {
    db.tables.tracks.push(track(t(300), 'हिन्दी गाना'), track(t(301), 'สวัสดี ชาวโลก'));
    expect(ids((await search(AR, 'हिन्दी')).body, 'songs')).toEqual([t(300)]);
    expect(ids((await search(AR, 'गाना')).body, 'songs')).toEqual([t(300)]);
    expect(ids((await search(AR, 'สวัสดี')).body, 'songs')).toEqual([t(301)]);
  });

  it('a common word does not starve a member who may see only a few of its matches (D4 inside the paging)', async () => {
    for (let i = 0; i < 90; i++) db.tables.tracks.push(track(t(400 + i), `Alpha mix ${String(i).padStart(2, '0')}`));
    db.tables.tracks.push(track(t(600), 'Zed mix one', { song_stage: 'selected' }), track(t(601), 'Zed mix two', { song_stage: 'selected' }));
    const { body } = await search(MKT, 'mix');
    expect(ids(body, 'songs').sort()).toEqual([t(600), t(601)].sort());
    const text = JSON.stringify(body);
    expect(text).not.toContain('Alpha');
    expect(text).not.toMatch(/count|total|hidden|restricted|more/i);
  });

  it('...and an artist-scoped member whose matches are buried under another artist\'s', async () => {
    for (let i = 0; i < 90; i++) db.tables.tracks.push(track(t(700 + i), `Alpha mix ${String(i).padStart(2, '0')}`));
    for (let i = 0; i < 90; i++) db.tables.project_tracks.push({ project_id: LP1, track_id: t(700 + i), position: 10 + i });
    db.tables.tracks.push(track(t(900), 'Zed mix kilo'));
    db.tables.project_tracks.push({ project_id: LP2, track_id: t(900), position: 5 });
    const { body } = await search(AR_C2, 'mix');
    expect(ids(body, 'songs')).toEqual([t(900)]);
  });

  it('when every match is hidden the answer is an empty result, not a hint', async () => {
    for (let i = 0; i < 50; i++) db.tables.tracks.push(track(t(1000 + i), `Beta mix ${i}`));
    const { body } = await search(MKT, 'beta mix');
    expect(body.groups).toEqual([]);
  });
});

describe('artist scope', () => {
  it('a member scoped to Kilo never finds Nova\'s songs, files, project, release or artist', async () => {
    const { body } = await search(AR_C2, 'runnin');
    expect(ids(body, 'songs')).toEqual([S2]);
    expect(ids(body, 'artists')).toEqual([C2]);
    expect(ids(body, 'projects')).toEqual([LP2]);
    expect(ids(body, 'releases')).toEqual([R2]);
    expect(ids(body, 'files')).toEqual([F_KILO]);
    expect(ids(body, 'people')).toEqual([PARTY2]); // the manager is outside their contacts; Writer is credited on Nova's song only
    const all = JSON.stringify(body);
    for (const nova of [S1, S3, M1, C1, LP1, R1, F_ART, F_DEAL, 'Runnin Home', 'Nova']) expect(all).not.toContain(nova);
  });

  it('...even when the exact title is typed', async () => {
    const { body } = await search(AR_C2, 'Runnin Home');
    expect(body.groups.flatMap((g: { hits: { id: string }[] }) => g.hits.map((h) => h.id))).not.toContain(S1);
    expect(ids(body, 'songs')).toEqual([]);
  });

  it('a scoped member with no artists finds nothing', async () => {
    db.tables.member_artist_scopes = db.tables.member_artist_scopes.filter((m) => m.user_id !== AR_C2);
    const { body } = await search(AR_C2, 'runnin');
    expect(body.groups).toEqual([]);
  });

  it('the roster artist finds their own work only', async () => {
    const { body } = await search(ART, 'runnin');
    expect(ids(body, 'songs').sort()).toEqual([S1, S3].sort());
    expect(ids(body, 'artists')).toEqual([C1]);
    expect(JSON.stringify(body)).not.toContain(S2);
  });
});

describe('D4 and file / party permissions', () => {
  it('marketing finds finished material only: the selected song, not the inbox demos', async () => {
    const { body } = await search(MKT, 'runnin');
    expect(ids(body, 'songs')).toEqual([S3]);
    expect(JSON.stringify(body)).not.toContain(S1); // the demo itself is never named
  });

  it('files: kinds and restricted flags are honoured', async () => {
    expect(ids((await search(MKT, 'runnin')).body, 'files')).toEqual([F_ART, F_KILO].sort());
    const ar = ids((await search(AR, 'runnin')).body, 'files');
    expect(ar).toContain(F_SESSION);
    expect(ar).not.toContain(F_DEAL); // restricted: contracts.read
    expect(ids((await search(OWN, 'runnin')).body, 'files')).toContain(F_DEAL);
  });

  it('parties need rights.read, and a scoped member sees only the parties credited in their scope', async () => {
    expect(ids((await search(OWN, 'runnin')).body, 'people').sort()).toEqual([C3, PARTY1, PARTY2].sort());
    expect(ids((await search(AR, 'runnin')).body, 'people').sort()).toEqual([C3, PARTY1, PARTY2].sort());
    expect(ids((await search(AR_C2, 'runnin')).body, 'people')).toEqual([PARTY2]);
    expect(ids((await search(MKT, 'runnin')).body, 'people')).toEqual([C3]); // the contact, no parties
  });

  it('a party is found by its legal name for a rights reader, and the hit shows only the display name', async () => {
    const { body } = await search(OWN, 'hansen');
    expect(ids(body, 'people')).toEqual([PARTY1]);
    expect(JSON.stringify(body)).not.toContain('Rune Hansen');
  });
});

describe('identifier jump', () => {
  it('an ISRC jumps to the recording\'s song (any spelling)', async () => {
    for (const q of [ISRC1, 'GB-AYE-06-01498', 'gb aye 06 01498', `  ${ISRC1}  `]) {
      const { body } = await search(AR, q);
      expect(body.jump).toMatchObject({ group: 'songs', id: S1 });
      expect(body.groups).toEqual([]);
    }
  });

  it('a UPC jumps to the release; an IPI to the party (rights readers only)', async () => {
    expect((await search(AR, UPC1)).body.jump).toMatchObject({ group: 'releases', id: R1 });
    expect((await search(OWN, '001-234-567-89')).body.jump).toMatchObject({ group: 'people', id: PARTY1 });
    expect((await search(MKT, '00123456789')).body.jump).toBeNull();
    expect((await search(AR_C2, '00123456789')).body.jump).toBeNull(); // credited on Nova's song only
  });

  it('an ISWC on a song jumps to it', async () => {
    db.tables.tracks.find((r) => r.id === S3)!.iswc = 'T-034.524.680-1';
    expect((await search(AR, 'T-034.524.680-1')).body.jump).toMatchObject({ group: 'songs', id: S3 });
  });

  it('out of scope or hidden by D4: no jump, and no sign the code exists', async () => {
    const scoped = await search(AR_C2, ISRC1);
    expect(scoped.body).toEqual({ schemaReady: true, jump: null, groups: [] });
    expect(JSON.stringify(scoped.body)).not.toContain(S1);
    expect((await search(AR_C2, UPC1)).body.jump).toBeNull();
    const mkt = await search(MKT, ISRC1); // S1 is an inbox demo; marketing may not read it
    expect(mkt.body.jump).toBeNull();
    expect(JSON.stringify(mkt.body)).not.toContain(S1);
  });

  it('a recording whose song the member cannot read does not reveal the song through its own row', async () => {
    // M2 is Kilo's master; Nova's artist-role member searches its ISRC.
    expect((await search(ART, ISRC2)).body.jump).toBeNull();
  });

  it('another org\'s code and a producer track\'s code never match', async () => {
    db.tables.tracks.push(track(t(200), 'Other', { org_id: L2, isrc: 'FRZ039700001' }));
    db.tables.tracks.push({ id: t(201), org_id: null, user_id: PRODUCER, type: 'song', title: 'P', isrc: 'FRZ039700002', song_stage: null });
    expect((await search(AR, 'FRZ039700001')).body.jump).toBeNull();
    expect((await search(AR, 'FRZ039700002')).body.jump).toBeNull();
  });

  it('a code with a bad check digit is just text', async () => {
    expect((await search(AR, '036000291453')).body).toEqual({ schemaReady: true, jump: null, groups: [] });
  });
});

describe('access', () => {
  it('a stranger is 403, an anonymous caller 401, another org\'s id is refused', async () => {
    expect((await search(STRANGER, 'runnin')).status).toBe(403);
    expect((await search(null, 'runnin')).status).toBe(401);
    expect((await search(AR, 'runnin', L2)).status).toBe(403);
  });
});
