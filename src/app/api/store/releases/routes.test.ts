/**
 * The PUBLIC release routes (LABEL-42): /api/store/releases, /[id], /[id]/audio/[item],
 * /[id]/cover — through the real store-listing rules against an in-memory
 * database. Only the byte streams are stubbed, so the tests can see exactly
 * WHICH stored reference a visitor's request was allowed to open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const P = '10000000-0000-4000-8000-0000000000a1';
const L = '10000000-0000-4000-8000-000000000001';
const PU = '20000000-0000-4000-8000-000000000001';
const CP = '30000000-0000-4000-8000-0000000000c1';
const CL = '30000000-0000-4000-8000-0000000000c2';
const PP = '40000000-0000-4000-8000-0000000000a1';
const PL = '40000000-0000-4000-8000-0000000000a2';
const T1 = '50000000-0000-4000-8000-000000000001';
const T2 = '50000000-0000-4000-8000-000000000002';
const TL = '50000000-0000-4000-8000-000000000003';
const RP = '70000000-0000-4000-8000-000000000001';
const RL = '70000000-0000-4000-8000-000000000002';
const I1 = '80000000-0000-4000-8000-000000000001';
const I2 = '80000000-0000-4000-8000-000000000002';
const IL = '80000000-0000-4000-8000-000000000003';
const ART = '60000000-0000-4000-8000-000000000001';

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
const streamed: string[] = [];
const coverStreamed: string[] = [];

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mem.client.from(t), rpc: (n: string, a: Record<string, unknown>) => mem.client.rpc(n, a) }) }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: async (_req: unknown, src: string) => {
    streamed.push(src);
    return new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } });
  },
}));
vi.mock('@/lib/storage/project-assets', () => ({
  streamProjectAsset: async (_req: unknown, ref: string) => {
    coverStreamed.push(ref);
    return new Response('img', { status: 200, headers: { 'content-type': 'image/png' } });
  },
}));

const release = (id: string, org: string, project: string, contact: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: org, project_id: project, contact_id: contact, title: 'Night Shift', type: 'album', label_name: 'U2C', primary_genre: 'Hip-hop',
  release_date: '2024-02-02', artwork_asset_id: null, state: 'delivered', imported_released: false, store_listed: true,
  store_listed_at: '2026-10-10T00:00:00Z', store_playback: 'full', ...extra,
});

beforeEach(async () => {
  (await import('@/lib/labelos/store-listing-store')).resetStoreOwnerCache();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  delete process.env.R2_PRIVATE_BUCKET_NAME;
  delete process.env.R2_BUCKET_NAME;
  streamed.length = 0;
  coverStreamed.length = 0;
  db = {
    tables: {
      creator_profiles: [{ user_id: PU, display_name: 'Uche', default_artwork_url: null }],
      organizations: [
        { id: P, kind: 'producer', deleted_at: null, created_at: '2026-01-01T00:00:00Z' },
        { id: L, kind: 'label', deleted_at: null, created_at: '2026-01-02T00:00:00Z' },
      ],
      org_members: [{ org_id: P, user_id: PU, role: 'owner' }],
      org_connections: [],
      track_links: [],
      song_beats: [],
      contacts: [{ id: CP, org_id: P, name: 'Nova' }, { id: CL, org_id: L, name: 'Kilo' }],
      projects: [{ id: PP, org_id: P, name: 'x' }, { id: PL, org_id: L, name: 'y' }],
      tracks: [
        { id: T1, org_id: P, type: 'song', song_stage: 'selected', title: 'One', audio_url: '/uploads/orgs/p/tracks/1.wav', preview_url: null, duration_seconds: 100 },
        { id: T2, org_id: P, type: 'song', song_stage: 'selected', title: 'Two', audio_url: '/uploads/orgs/p/tracks/2.wav', preview_url: null, duration_seconds: 90 },
        { id: TL, org_id: L, type: 'song', song_stage: 'selected', title: 'Three', audio_url: '/uploads/orgs/l/tracks/3.wav', preview_url: null, duration_seconds: 90 },
      ],
      releases: [release(RP, P, PP, CP), release(RL, L, PL, CL)],
      release_items: [
        { id: I1, release_id: RP, org_id: P, position: 1, song_track_id: T1, master_track_id: T1, version_title: null, explicit: false },
        { id: I2, release_id: RP, org_id: P, position: 2, song_track_id: T2, master_track_id: T2, version_title: 'Radio', explicit: true },
        { id: IL, release_id: RL, org_id: L, position: 1, song_track_id: TL, master_track_id: TL, version_title: null, explicit: false },
      ],
      project_assets: [{ id: ART, org_id: P, project_id: PP, kind: 'artwork', url: 'local://project-assets/a.png', file_name: 'a.png', mime: 'image/png', sensitivity: 'normal' }],
    },
  };
  mem = memoryAdmin(db);
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const rel = (id: string) => db.tables.releases.find((r) => r.id === id)!;

async function get(path: string, params: Record<string, string>, mod: () => Promise<unknown>) {
  const m = (await mod()) as Record<string, Handler>;
  return m.GET(new NextRequest(`https://app.test${path}`), { params: Promise.resolve(params) });
}
const list = () => get('/api/store/releases', {}, () => import('./route'));
const detail = (id: string) => get(`/api/store/releases/${id}`, { id }, () => import('./[id]/route'));
const audio = (id: string, itemId: string) => get(`/api/store/releases/${id}/audio/${itemId}`, { id, itemId }, () => import('./[id]/audio/[itemId]/route'));
const cover = (id: string) => get(`/api/store/releases/${id}/cover`, { id }, () => import('./[id]/cover/route'));

describe('the list', () => {
  it('shows the store owner’s listed, released release as a tile, and nothing private', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=30/);
    const body = await res.json();
    expect(body.releases).toHaveLength(1);
    expect(body.releases[0]).toMatchObject({ id: RP, title: 'Night Shift', artist: 'Nova', track_count: 2, already_out: false, cover_url: null });
    expect(JSON.stringify(body)).not.toMatch(/org_id|r2:\/\/|\/uploads\/|audio_url|master|user_id/);
  });
  it('an unlisted, draft, future-dated or another org’s release is not in it', async () => {
    rel(RP).store_listed = false;
    expect((await (await list()).json()).releases).toEqual([]);
    Object.assign(rel(RP), { store_listed: true, state: 'draft' });
    expect((await (await list()).json()).releases).toEqual([]);
    Object.assign(rel(RP), { state: 'delivered', release_date: '2999-01-01' });
    expect((await (await list()).json()).releases).toEqual([]);
    // The label's release is listed in the table but is not the store owner's.
    expect(rel(RL).store_listed).toBe(true);
  });
  it('an imported album is in it, flagged already out', async () => {
    Object.assign(rel(RP), { state: 'delivered', imported_released: true, release_date: '2018-03-02' });
    expect((await (await list()).json()).releases[0]).toMatchObject({ already_out: true });
  });
});

describe('the detail', () => {
  it('is the playable tracklist in order with same-origin streams keyed by item', async () => {
    const body = await (await detail(RP)).json();
    expect(body.tracks.map((t: { title: string }) => t.title)).toEqual(['One', 'Two (Radio)']);
    expect(body.tracks[0]).toMatchObject({ id: I1, audio_url: `/api/store/releases/${RP}/audio/${I1}`, preview_url: null, wav_url: null });
    expect(body.release.playback).toBe('full');
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${T1}|${P}|r2://|/uploads/`));
  });
  it('unlisted / unreleased / not the store owner’s / malformed are all the same 404', async () => {
    expect((await detail(RL)).status).toBe(404);
    expect((await detail('nope')).status).toBe(404);
    rel(RP).store_listed = false;
    expect((await detail(RP)).status).toBe(404);
    Object.assign(rel(RP), { store_listed: true, state: 'draft' });
    expect((await detail(RP)).status).toBe(404);
  });
  it('stops being served when the store owner no longer owns the studio', async () => {
    db.tables.org_members = [];
    expect((await detail(RP)).status).toBe(404);
  });
});

describe('the audio', () => {
  it('full mode streams the item’s master through the server and never anything else', async () => {
    const res = await audio(RP, I2);
    expect(res.status).toBe(200);
    expect(streamed).toEqual(['/uploads/orgs/p/tracks/2.wav']);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });
  it('preview mode with no promoted copy is 404 — never the master, never the private clip', async () => {
    rel(RP).store_playback = 'preview';
    db.tables.tracks[0].preview_url = 'r2://priv/orgs/p/previews/1.mp3';
    expect((await audio(RP, I1)).status).toBe(404);
    expect(streamed).toEqual([]);
  });
  it('preview mode streams the promoted public copy', async () => {
    rel(RP).store_playback = 'preview';
    Object.assign(process.env, { R2_ACCOUNT_ID: 'test-account-id', R2_ACCESS_KEY_ID: 'test-access-key', R2_SECRET_ACCESS_KEY: 'test-secret-key', R2_BUCKET_NAME: 'pub', R2_PRIVATE_BUCKET_NAME: 'priv' });
    try {
      const res = await audio(RP, I1);
      expect(res.status).toBe(200);
      expect(streamed).toEqual([`r2://pub/store-releases/${RP}/${T1}`]);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    } finally {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PRIVATE_BUCKET_NAME']) delete process.env[k];
    }
  });
  it('a master in the PUBLIC bucket is refused in full mode (private bucket only)', async () => {
    process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
    db.tables.tracks[0].audio_url = 'r2://pub/anything.wav';
    expect((await audio(RP, I1)).status).toBe(404);
    expect(streamed).toEqual([]);
  });
  it('an item of another release, an unknown item, an unlisted release: 404', async () => {
    expect((await audio(RP, IL)).status).toBe(404);
    expect((await audio(RP, '80000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await audio(RP, T1)).status).toBe(404);
    rel(RP).store_listed = false;
    expect((await audio(RP, I1)).status).toBe(404);
    expect(streamed).toEqual([]);
  });
});

describe('the cover', () => {
  beforeEach(() => {
    rel(RP).artwork_asset_id = ART;
  });
  it('streams the release’s own artwork while it is listed', async () => {
    expect((await cover(RP)).status).toBe(200);
    expect(coverStreamed).toEqual(['local://project-assets/a.png']);
    expect((await (await detail(RP)).json()).release.cover_url).toBe(`/api/store/releases/${RP}/cover`);
  });
  it('a restricted file, a non-image, a file of another project, or an unlisted release is 404', async () => {
    const asset = db.tables.project_assets[0];
    asset.sensitivity = 'restricted';
    expect((await cover(RP)).status).toBe(404);
    asset.sensitivity = 'normal';
    asset.mime = 'application/pdf';
    expect((await cover(RP)).status).toBe(404);
    asset.mime = 'image/png';
    asset.project_id = PL;
    expect((await cover(RP)).status).toBe(404);
    asset.project_id = PP;
    rel(RP).store_listed = false;
    expect((await cover(RP)).status).toBe(404);
    expect(coverStreamed).toEqual([]);
  });
});

describe('review fixes (LABEL-42)', () => {
  it('an item whose recording is a demo is never listed or served, even from a listed release', async () => {
    db.tables.tracks[1].song_stage = 'in_review'; // Two
    const body = await (await detail(RP)).json();
    expect(body.tracks.map((t: { title: string }) => t.title)).toEqual(['One']);
    expect((await audio(RP, I2)).status).toBe(404);
    expect((await audio(RP, I1)).status).toBe(200);
    expect(streamed).toEqual(['/uploads/orgs/p/tracks/1.wav']);
  });

  it('a release whose every item is unfinished is a 404 and not in the strip’s detail', async () => {
    db.tables.tracks[0].song_stage = 'inbox';
    db.tables.tracks[1].song_stage = 'inbox';
    expect((await detail(RP)).status).toBe(404);
  });

  it('the audio route is rate limited per caller and release (429 with Retry-After), and other releases are unaffected', async () => {
    const mod = (await import('./[id]/audio/[itemId]/route')) as unknown as Record<string, Handler>;
    const hit = () =>
      mod.GET(new NextRequest(`https://app.test/api/store/releases/${RP}/audio/${I1}`, { headers: { 'x-forwarded-for': '203.0.113.9' } }), {
        params: Promise.resolve({ id: RP, itemId: I1 }),
      });
    let limited: Response | null = null;
    for (let i = 0; i < 100 && !limited; i += 1) {
      const res = await hit();
      if (res.status === 429) limited = res;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get('retry-after')).toBe('60');
  });

  it('a stale listing (an ended connection) does not crowd real ones out of the list', async () => {
    const artist = '10000000-0000-4000-8000-0000000000a2';
    db.tables.organizations.push({ id: artist, kind: 'artist', deleted_at: null, created_at: '2026-01-03T00:00:00Z' });
    // 30 newer listings of an org that is no longer connected, then the real one.
    for (let i = 0; i < 30; i += 1) {
      db.tables.releases.push(release(`71000000-0000-4000-8000-${String(i).padStart(12, '0')}`, artist, PP, CP, { store_listed_at: `2026-10-12T00:${String(i).padStart(2, '0')}:00Z` }));
    }
    const body = await (await list()).json();
    expect(body.releases.map((r: { id: string }) => r.id)).toEqual([RP]);
  });

  it('the store owner’s side is cached briefly: a change shows once the cache is dropped, while store_listed is read fresh', async () => {
    expect((await detail(RP)).status).toBe(200);
    db.tables.org_members = []; // the owner no longer owns the studio — but the answer is cached for a moment
    expect((await detail(RP)).status).toBe(200);
    (await import('@/lib/labelos/store-listing-store')).resetStoreOwnerCache();
    expect((await detail(RP)).status).toBe(404);
    // And listing state is never cached:
    db.tables.org_members = [{ org_id: P, user_id: PU, role: 'owner' }];
    (await import('@/lib/labelos/store-listing-store')).resetStoreOwnerCache();
    expect((await detail(RP)).status).toBe(200);
    rel(RP).store_listed = false;
    expect((await detail(RP)).status).toBe(404);
  });
});

describe('re-review fixes (LABEL-42)', () => {
  it('a delivery with only a future target date and no release date is not public — list, detail and audio all say no', async () => {
    Object.assign(rel(RP), { release_date: null, target_date: '2999-01-01' });
    expect((await (await list()).json()).releases).toEqual([]);
    expect((await detail(RP)).status).toBe(404);
    expect((await audio(RP, I1)).status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('the tile counts only the items the detail page would show, and a release with none has no tile', async () => {
    db.tables.tracks[1].song_stage = 'in_review';
    const tile = (await (await list()).json()).releases[0];
    expect(tile.track_count).toBe(1);
    expect((await (await detail(RP)).json()).tracks).toHaveLength(1);
    db.tables.tracks[0].song_stage = 'inbox';
    expect((await (await list()).json()).releases).toEqual([]);
  });

  it('the list reads in a fixed number of queries however many releases are listed', async () => {
    const real = mem.client.from.bind(mem.client);
    const reads: string[] = [];
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      reads.push(table);
      return real(table);
    }) as typeof mem.client.from);
    await list(); // warms the owner cache
    reads.length = 0;
    await list();
    const few = reads.length;
    reads.length = 0;
    for (let i = 0; i < 10; i += 1) {
      const id = `72000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      db.tables.releases.push(release(id, P, PP, CP, { store_listed_at: `2026-10-0${i % 9 + 1}T00:00:00Z` }));
      db.tables.release_items.push({ id: `82000000-0000-4000-8000-${String(i).padStart(12, '0')}`, release_id: id, org_id: P, position: 1, song_track_id: T1, master_track_id: T1, version_title: null, explicit: false });
    }
    await list();
    vi.restoreAllMocks();
    expect(reads.length).toBe(few);
  });

  it('a malformed release id is a 404 BEFORE the limiter: random ids mint no buckets and never read 429', async () => {
    const mod = (await import('./[id]/audio/[itemId]/route')) as unknown as Record<string, Handler>;
    for (let i = 0; i < 150; i += 1) {
      const id = `junk-${i}`;
      const res = await mod.GET(new NextRequest(`https://app.test/api/store/releases/${id}/audio/${I1}`, { headers: { 'x-forwarded-for': '203.0.113.50' } }), {
        params: Promise.resolve({ id, itemId: I1 }),
      });
      expect(res.status).toBe(404);
    }
  });

  it('the D4 result is kept for a few seconds, but the release row (listed, state, date) is read fresh', async () => {
    expect((await audio(RP, I1)).status).toBe(200);
    db.tables.tracks[0].song_stage = 'inbox'; // changes a recording’s input: seen after the short cache
    expect((await audio(RP, I1)).status).toBe(200);
    rel(RP).store_listed = false; // changes the release row: seen at once
    expect((await audio(RP, I1)).status).toBe(404);
    rel(RP).store_listed = true;
    (await import('@/lib/labelos/store-listing-store')).resetStoreOwnerCache();
    expect((await audio(RP, I1)).status).toBe(404);
  });
});

describe('round 3 (LABEL-42)', () => {
  const upper = (u: string) => u.toUpperCase();

  it('the audio route lower-cases ids first: letter case shares ONE limiter bucket and ONE cache entry', async () => {
    const mod = (await import('./[id]/audio/[itemId]/route')) as unknown as Record<string, Handler>;
    const hit = (id: string, itemId: string) =>
      mod.GET(new NextRequest(`https://app.test/api/store/releases/${id}/audio/${itemId}`, { headers: { 'x-forwarded-for': '203.0.113.77' } }), {
        params: Promise.resolve({ id, itemId }),
      });
    const real = mem.client.from.bind(mem.client);
    let itemReads = 0;
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      if (table === 'release_items') itemReads += 1;
      return real(table);
    }) as typeof mem.client.from);
    expect((await hit(RP, I1)).status).toBe(200);
    expect((await hit(upper(RP), upper(I1))).status).toBe(200);
    expect(itemReads).toBe(1); // the second request found the first one's cache entry
    vi.restoreAllMocks();
    // 90 per minute in total across both spellings, not 90 each.
    let limited = 0;
    for (let i = 0; i < 100; i += 1) {
      const res = await hit(i % 2 ? upper(RP) : RP, i % 2 ? upper(I1) : I1);
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    expect(limited).toBeLessThanOrEqual(100 - (90 - 2));
  });

  it('detail and cover accept an upper-case id and serve the same release', async () => {
    expect((await detail(upper(RP))).status).toBe(200);
    rel(RP).artwork_asset_id = ART;
    expect((await cover(upper(RP))).status).toBe(200);
  });

  it('a missing item is not cached: once it exists it is served at once', async () => {
    const late = '80000000-0000-4000-8000-0000000000aa';
    expect((await audio(RP, late)).status).toBe(404);
    db.tables.release_items.push({ id: late, release_id: RP, org_id: P, position: 3, song_track_id: T1, master_track_id: T1, version_title: null, explicit: false });
    expect((await audio(RP, late)).status).toBe(200);
  });

  it('empty or unfinished listings are filtered BEFORE the cut: 30 newer tile-less releases do not hide the real one', async () => {
    for (let i = 0; i < 30; i += 1) {
      const id = `73000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      db.tables.releases.push(release(id, P, PP, CP, { store_listed_at: `2026-10-12T00:${String(i).padStart(2, '0')}:00Z` })); // no items at all
    }
    const body = await (await list()).json();
    expect(body.releases.map((r: { id: string }) => r.id)).toEqual([RP]);
  });

  it('reads in chunks of at most 100 ids and pages: 130 listed releases are all counted, none silently dropped', async () => {
    for (let i = 0; i < 130; i += 1) {
      const id = `74000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      db.tables.releases.push(release(id, P, PP, CP, { store_listed_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
      db.tables.release_items.push({ id: `84000000-0000-4000-8000-${String(i).padStart(12, '0')}`, release_id: id, org_id: P, position: 1, song_track_id: T1, master_track_id: T1, version_title: null, explicit: false });
    }
    const { loadPublicReleaseList } = await import('@/lib/labelos/store-listing-store');
    const real = mem.client.from.bind(mem.client);
    let itemReads = 0;
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      if (table === 'release_items') itemReads += 1;
      return real(table);
    }) as typeof mem.client.from);
    const rows = await loadPublicReleaseList(mem.client, new Date(), 200);
    vi.restoreAllMocks();
    expect(rows).toHaveLength(131);
    expect(itemReads).toBeGreaterThanOrEqual(2);
  });

  it('a failed read is a 5xx that nothing caches, never an empty list', async () => {
    const real = mem.client.from.bind(mem.client);
    vi.spyOn(mem.client, 'from').mockImplementation(((table: string) => {
      if (table === 'release_items') {
        const res = { data: null, error: { message: 'boom' } };
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'in', 'eq', 'order', 'range']) q[m] = () => q;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
        return q;
      }
      return real(table);
    }) as typeof mem.client.from);
    const res = await list();
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).not.toHaveProperty('releases');
  });
});
