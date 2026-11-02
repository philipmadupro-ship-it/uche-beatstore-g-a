/**
 * The PUBLIC press-kit entrance (LABEL-66): /api/press/[token] and its photo
 * route, through the real route code against an in-memory database. What is
 * proved, for a visitor holding only a link:
 *
 *   - one 404 for every way a link can fail, with the same body;
 *   - EMBARGO: before it lifts, only the title, artist, the pre-embargo line and
 *     marked photos — no date, bio, tracklist, links or audio — decided on every
 *     request (and `no-store`); it lifts by itself;
 *   - AUDIO: only for a released release that the store itself would play, only
 *     through the store's own stream URLs; nothing for unreleased music;
 *   - no private reference (r2://, orgs/, org ids, hashes, other contacts) in any
 *     JSON the page receives;
 *   - photos stream through the route, re-checked per request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { hashPressToken, newPressToken } from '@/lib/labelos/press-token';

const L = '10000000-0000-4000-8000-000000000001';
const REL = '70000000-0000-4000-8000-000000000001';
const LP = '40000000-0000-4000-8000-0000000000a1';
const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const KIT = '50000000-0000-4000-8000-0000000000f1';
const PH1 = '51000000-0000-4000-8000-0000000000a1'; // marked pre-embargo
const PH2 = '51000000-0000-4000-8000-0000000000a2'; // not marked
const A1 = '60000000-0000-4000-8000-0000000000a1';
const A2 = '60000000-0000-4000-8000-0000000000a2';
const SONG = '80000000-0000-4000-8000-0000000000a1';
const ITEM = '90000000-0000-4000-8000-0000000000a1';
const SHARE = '52000000-0000-4000-8000-0000000000a1';

let db: MemoryDb;
let allowed = true;
let storeRelease: unknown = null;
const stream = vi.fn(async () => new Response('IMGBYTES', { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=9999' } }));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => allowed, clientIp: () => '203.0.113.9', rateLimit: () => true }));
vi.mock('@/lib/storage/project-assets', () => ({ streamProjectAsset: (...a: unknown[]) => (stream as (...x: unknown[]) => Promise<Response>)(...a) }));
vi.mock('@/lib/labelos/store-listing-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/labelos/store-listing-store')>()),
  loadPublicRelease: async () => storeRelease,
}));

const pageRoute = () => import('./route');
const photoRoute = () => import('./assets/[photoId]/route');
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();
const dateOnly = (offsetDays: number) => day(offsetDays).slice(0, 10);

let TOKEN = '';
function seed(over: { embargo?: string | null; releaseDate?: string | null; state?: string } = {}) {
  TOKEN = newPressToken();
  db = {
    unique: {},
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null, settings: {} }],
      org_entitlements: [],
      contacts: [
        { id: C1, org_id: L, name: 'Nova', category: 'artist', email: 'nova@example.com' },
        { id: C2, org_id: L, name: 'Pat Press', category: 'press', email: 'pat@example.com' },
      ],
      releases: [{
        id: REL, org_id: L, project_id: LP, contact_id: C1, title: 'Night Shift', type: 'single', label_name: 'Label L', primary_genre: 'Pop',
        release_date: over.releaseDate === undefined ? dateOnly(-5) : over.releaseDate, state: over.state ?? 'delivered', imported_released: false, upc: '123456789012',
      }],
      release_items: [{ id: ITEM, org_id: L, release_id: REL, position: 1, song_track_id: SONG, master_track_id: SONG, version_title: null, explicit: false }],
      tracks: [{ id: SONG, org_id: L, title: 'Night Shift', audio_url: 'r2://private/orgs/x/master.wav' }],
      press_kits: [{
        id: KIT, org_id: L, release_id: REL, headline: 'Nova returns', bio: 'A secret-free bio.', pre_embargo_note: 'Coming soon',
        embargo_at: over.embargo === undefined ? null : over.embargo, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      }],
      press_kit_links: [{ id: '53000000-0000-4000-8000-000000000001', org_id: L, kit_id: KIT, label: 'Instagram', url: 'https://instagram.com/nova', position: 0 }],
      press_kit_photos: [
        { id: PH1, org_id: L, kit_id: KIT, asset_id: A1, caption: 'Cover shoot', pre_embargo: true, position: 0 },
        { id: PH2, org_id: L, kit_id: KIT, asset_id: A2, caption: null, pre_embargo: false, position: 1 },
      ],
      press_kit_shares: [{ id: SHARE, org_id: L, kit_id: KIT, token_hash: hashPressToken(TOKEN), label: 'Pitchfork', expires_at: null, revoked_at: null, view_count: 0, last_viewed_at: null }],
      project_assets: [
        { id: A1, org_id: L, project_id: LP, kind: 'photo', sensitivity: 'normal', mime: 'image/png', file_name: 'a1.png', url: 'r2://private/project-assets/a1' },
        { id: A2, org_id: L, project_id: LP, kind: 'artwork', sensitivity: 'normal', mime: 'image/jpeg', file_name: 'a2.jpg', url: 'r2://private/project-assets/a2' },
      ],
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  allowed = true;
  storeRelease = null;
  stream.mockClear();
  seed();
});

async function page(token: string = TOKEN) {
  const { GET } = await pageRoute();
  return GET(new NextRequest(`https://app.test/api/press/${token}`), { params: Promise.resolve({ token }) });
}
async function photo(photoId: string, token: string = TOKEN) {
  const { GET } = await photoRoute();
  return GET(new NextRequest(`https://app.test/api/press/${token}/assets/${photoId}`), { params: Promise.resolve({ token, photoId }) });
}
const storeHit = (over: Record<string, unknown> = {}) => ({
  release: { id: REL },
  items: [{ id: ITEM, position: 1, title: 'Night Shift', version_title: null, explicit: false, duration_seconds: 181 }],
  row: { id: REL, title: 'Night Shift', type: 'single', label_name: 'Label L', primary_genre: 'Pop', release_date: dateOnly(-5), imported_released: false, store_listed_at: day(-4), store_playback: 'preview', has_artwork: false, artist_name: 'Nova', out: true },
  ...over,
});
const NO_LEAK = ['r2://', 'orgs/', 'private', 'token_hash', 'org_id', 'user_id', 'nova@example.com', 'pat@example.com', 'Pat Press', '123456789012', hashPressToken(TOKEN)];
const expectNoLeak = (body: unknown) => {
  const s = JSON.stringify(body);
  for (const leak of NO_LEAK) expect(s, leak).not.toContain(leak);
};

describe('one 404 for every failure', () => {
  const gone = async (res: Response) => {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  };
  it('malformed, unknown, revoked, expired, deleted org, unlicensed org, withdrawn / cancelled release, missing tables', async () => {
    await gone(await page('short'));
    await gone(await page(newPressToken()));
    db.tables.press_kit_shares[0].revoked_at = day(-1);
    await gone(await page());
    seed();
    db.tables.press_kit_shares[0].expires_at = day(-1);
    await gone(await page());
    seed();
    db.tables.organizations[0].deleted_at = day(-1);
    await gone(await page());
    seed();
    db.tables.org_entitlements.push({ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null, setup_done: true });
    await gone(await page());
    seed();
    db.tables.organizations[0].settings = { departments_off: ['pr'] };
    await gone(await page());
    for (const state of ['withdrawn', 'cancelled']) {
      seed({ state });
      await gone(await page());
    }
    seed();
    db.tables.releases = [];
    await gone(await page());
  });
  it('an expired link answers the moment it expires, a live one with an expiry still works', async () => {
    db.tables.press_kit_shares[0].expires_at = day(1);
    expect((await page()).status).toBe(200);
    db.tables.press_kit_shares[0].expires_at = day(-0.0001);
    expect((await page()).status).toBe(404);
  });
  it('is 429 when the limiter says so, and says nothing else', async () => {
    allowed = false;
    expect((await page()).status).toBe(429);
    expect((await photo(PH1)).status).toBe(429);
  });
});

describe('embargo', () => {
  it('before it lifts: the title, the artist, the line and the marked photos — nothing else', async () => {
    seed({ embargo: day(3), releaseDate: dateOnly(10) });
    const res = await page();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body).toEqual({
      press: { state: 'embargoed', title: 'Night Shift', artist: 'Nova', note: 'Coming soon', photos: [{ id: PH1, url: `/api/press/${TOKEN}/assets/${PH1}`, caption: 'Cover shoot' }] },
    });
    expectNoLeak(body);
    const s = JSON.stringify(body);
    for (const hidden of ['bio', 'instagram', 'Label L', 'Pop', 'audio', 'tracklist', dateOnly(10), 'Nova returns']) expect(s, hidden).not.toContain(hidden);
  });
  it('shows no audio before the embargo lifts even for released music the store plays', async () => {
    seed({ embargo: day(3) });
    storeRelease = storeHit();
    expect(JSON.stringify(await (await page()).json())).not.toContain('/api/store/releases');
  });
  it('lifts by itself, with no stored change, and is not cached across the moment', async () => {
    seed({ embargo: day(0.0001) });
    expect((await (await page()).json()).press.state).toBe('embargoed');
    db.tables.press_kits[0].embargo_at = day(-0.0001);
    const res = await page();
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect((await res.json()).press.state).toBe('live');
  });
  it('the owner moving the embargo out again hides it on the next request', async () => {
    seed({ embargo: null });
    expect((await (await page()).json()).press.state).toBe('live');
    db.tables.press_kits[0].embargo_at = day(2);
    expect((await (await page()).json()).press.state).toBe('embargoed');
  });
});

describe('the live page', () => {
  it('carries the one-sheet fields and nothing private', async () => {
    const res = await page();
    const body = await res.json();
    expect(body.press).toMatchObject({
      state: 'live', title: 'Night Shift', artist: 'Nova', type: 'single', label: 'Label L', genre: 'Pop', released: true,
      headline: 'Nova returns', bio: 'A secret-free bio.', links: [{ label: 'Instagram', url: 'https://instagram.com/nova' }],
      tracklist: [{ position: 1, title: 'Night Shift', explicit: false }], listen: null,
    });
    expect(body.press.photos.map((p: { id: string }) => p.id)).toEqual([PH1, PH2]);
    expectNoLeak(body);
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('counts the view', async () => {
    await page();
    await page();
    expect(db.tables.press_kit_shares[0].view_count).toBe(2);
  });
});

describe('audio', () => {
  it('a released release the store plays: the store’s own stream URLs, nothing else', async () => {
    storeRelease = storeHit();
    const body = await (await page()).json();
    expect(body.press.listen).toEqual({ tracks: [{ id: ITEM, title: 'Night Shift', audioUrl: `/api/store/releases/${REL}/audio/${ITEM}`, durationSeconds: 181 }] });
    expectNoLeak(body);
  });
  it('a release that is not out yet has no audio, even as a store teaser', async () => {
    for (const releaseDate of [dateOnly(7), null]) {
      seed({ releaseDate });
      storeRelease = storeHit();
      const body = await (await page()).json();
      expect(body.press.state).toBe('live');
      expect(body.press.listen, String(releaseDate)).toBeNull();
      expect(JSON.stringify(body)).not.toMatch(/audio|\/api\/store/);
    }
  });
  it('a draft release has no audio', async () => {
    seed({ state: 'draft' });
    storeRelease = storeHit();
    expect((await (await page()).json()).press.listen).toBeNull();
  });
  it('a released release that is not on the store has no audio (the store said no)', async () => {
    storeRelease = null;
    expect((await (await page()).json()).press.listen).toBeNull();
  });
  it('a bad stream URL from upstream is dropped, never forwarded', async () => {
    storeRelease = storeHit({ items: [{ id: ITEM, position: 1, title: 'x', version_title: null, explicit: false, duration_seconds: 1 }] });
    const body = await (await page()).json();
    expect(JSON.stringify(body.press.listen)).not.toMatch(/r2:|orgs\//);
  });
});

describe('photos', () => {
  it('stream through the route with no-store headers and no presigned URL', async () => {
    const res = await photo(PH1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('IMGBYTES');
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(stream).toHaveBeenCalledTimes(1);
    expect((stream.mock.calls[0] as unknown[])[1]).toBe('r2://private/project-assets/a1');
  });
  it('during the embargo only a marked photo streams; the rest is 404', async () => {
    seed({ embargo: day(2) });
    expect((await photo(PH1)).status).toBe(200);
    expect((await photo(PH2)).status).toBe(404);
    expect(stream).toHaveBeenCalledTimes(1);
  });
  it('is re-checked on each request: restricted later, an SVG, another project, a revoked link', async () => {
    db.tables.project_assets[0].sensitivity = 'restricted';
    expect((await photo(PH1)).status).toBe(404);
    seed();
    db.tables.project_assets[0].mime = 'image/svg+xml';
    expect((await photo(PH1)).status).toBe(404);
    seed();
    db.tables.project_assets[0].project_id = '40000000-0000-4000-8000-0000000000ff';
    expect((await photo(PH1)).status).toBe(404);
    seed();
    db.tables.press_kit_shares[0].revoked_at = day(-1);
    expect((await photo(PH1)).status).toBe(404);
    expect(stream).not.toHaveBeenCalled();
  });
  it('a photo of another kit, a malformed id and a malformed token are 404', async () => {
    expect((await photo('51000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await photo('nope')).status).toBe(404);
    expect((await photo(PH1, 'short')).status).toBe(404);
  });
});

describe('without migration 184 or Supabase', () => {
  it('is the same 404', async () => {
    db.tables = { ...db.tables };
    delete (db.tables as Record<string, unknown>).press_kit_shares;
    const res = await page();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
