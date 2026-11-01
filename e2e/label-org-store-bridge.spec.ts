/**
 * Released → store bridge (LABEL-42) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true,
 * migration 158 included). What mocks cannot prove: an owner enters an album
 * that is already out through the page, it is listed through the page, a
 * stranger on /store sees it and PLAYS it (a real <audio> past 0 s) at 1440 and
 * 390 px, an unreleased release is refused with 409 by the real route and
 * rules, unlisting takes it off the public API, and every step leaves its
 * audit row.
 *
 * Cast: PRODUCER is the store owner and the owner of their personal producer
 * org (made here, dated 2000 so it is the "oldest studio" the store resolves
 * to whatever other specs left behind). ARTIST_A is an A&R in it: release.write,
 * not an owner. The "stranger" is an anonymous browser context.
 *
 * Playback is `full` here: without R2 there is no private bucket to hold a
 * preview clip, and full songs are streamed by the server from a lossy
 * full-length derivative cut with ffmpeg into data/orgs/<org>/derivatives
 * (LABEL-72) — never from the master.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ARTIST_A_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `studio-${run}`;
const NOVA = randomUUID();
const SONG_1 = randomUUID();
const SONG_2 = randomUUID();
const ALBUM = `Night Shift ${run}`;
const UPLOADS = path.join(process.cwd(), 'public', 'uploads');
const FILES = [SONG_1, SONG_2].map((id) => `labelos-e2e-bridge-${run}-${id.slice(0, 4)}.wav`);

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** A few seconds of a quiet tone: a real, decodable WAV the browser can play. */
function wav(seconds = 6, rate = 8000): Buffer {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const aAndR = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const api = `/api/org/${ORG}`;
const ids: Record<string, string> = {};

type EventRow = { verb: string; audit: boolean; visibility: string; actor_id: string | null; release_id: string | null };
const events = async (request: APIRequestContext, release: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,visibility,actor_id,release_id&release_id=eq.${release}&order=created_at`)) as EventRow[];

interface AudioState { src: string; paused: boolean; time: number }
const audios = (page: Page): Promise<AudioState[]> =>
  page.evaluate(() => Array.from(document.querySelectorAll('audio')).map((a) => ({ src: a.currentSrc || a.src, paused: a.paused, time: a.currentTime })));

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(UPLOADS, { recursive: true });
  // Fixtures of an earlier, interrupted run (public/ is served statically and must stay clean; also git-ignored).
  for (const f of fs.readdirSync(UPLOADS)) if (f.startsWith('labelos-e2e-bridge-')) fs.rmSync(path.join(UPLOADS, f), { force: true });
  for (const f of FILES) fs.writeFileSync(path.join(UPLOADS, f), wav());
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Studio ${run}`, slug: SLUG, kind: 'producer', created_by: PRODUCER_ID, created_at: '2000-01-01T00:00:00Z' });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'tracks', [SONG_1, SONG_2].map((id, i) => ({
    id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: i === 0 ? `First Light ${run}` : `Second Wind ${run}`, type: 'song',
    song_stage: 'selected', audio_url: `/uploads/${FILES[i]}`, duration_seconds: 6,
  })));
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
  for (const f of FILES) fs.rmSync(path.join(UPLOADS, f), { force: true });
});

test('1 · an unreleased release cannot be listed: 409 from the real route, nothing public', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const created = await ctx.request.post(`${api}/releases`, { data: { title: `Draft ${run}`, contact_id: NOVA, type: 'single' } });
  expect(created.status(), await created.text()).toBe(201);
  ids.draft = (await created.json()).release.id;
  await ctx.request.post(`${api}/releases/${ids.draft}/items`, { data: { song_track_id: SONG_1 } });

  const res = await ctx.request.put(`${api}/releases/${ids.draft}/store`, { data: { listed: true } });
  expect(res.status()).toBe(409);
  expect((await res.json()).field).toBe('state');
  const row = ((await rest(request, 'GET', `releases?select=store_listed&id=eq.${ids.draft}`)) as { store_listed: boolean }[])[0];
  expect(row.store_listed).toBe(false);
  expect((await events(request, ids.draft)).map((e) => e.verb)).not.toContain('release.store_listed');
  const pub = await request.get(`/api/store/releases/${ids.draft}`);
  expect(pub.status()).toBe(404);
  await ctx.close();
});

test('2 · "already released" is the owner’s: an A&R is refused, the owner enters the album through the page', async ({ browser, baseURL, request }) => {
  const rd = await as(browser, baseURL!, aAndR.id, aAndR.email);
  const refused = await rd.request.post(`${api}/releases`, { data: { title: 'x', contact_id: NOVA, release_date: '2019-05-17', imported_released: true } });
  expect(refused.status()).toBe(403);
  await rd.close();

  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases`);
  await page.getByTestId('release-import-open').click({ timeout: 90_000 });
  await page.getByTestId('release-import-title').fill(ALBUM);
  await page.getByTestId('release-import-date').fill('2019-05-17');
  await page.getByTestId('release-import-submit').click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/releases/[0-9a-f-]{36}$`), { timeout: 60_000 });
  ids.album = page.url().split('/').pop()!;
  await expect(page.getByTestId('release-detail')).toHaveAttribute('data-state', 'delivered');

  const row = ((await rest(request, 'GET', `releases?select=state,imported_released,release_date,store_listed&id=eq.${ids.album}`)) as Record<string, unknown>[])[0];
  expect(row).toMatchObject({ state: 'delivered', imported_released: true, release_date: '2019-05-17', store_listed: false });
  const evs = await events(request, ids.album);
  const imported = evs.find((e) => e.verb === 'release.imported')!;
  expect(imported).toMatchObject({ audit: true, visibility: 'internal', actor_id: PRODUCER_ID });

  // The tracklist of an import is entered after the fact, through the real routes.
  for (const song of [SONG_1, SONG_2]) {
    const add = await ctx.request.post(`${api}/releases/${ids.album}/items`, { data: { song_track_id: song } });
    expect(add.status(), await add.text()).toBe(201);
  }
  await ctx.close();
});

test('3 · the owner puts it on the store from the page, with full songs', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.album}`);
  const card = page.getByTestId('release-store');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('release-store-state')).toHaveText(/Not on the store/);
  await page.getByTestId('release-store-playback-full').click();
  await page.getByTestId('release-store-list').click();
  await expect(card).toHaveAttribute('data-listed', 'true', { timeout: 60_000 });

  const row = ((await rest(request, 'GET', `releases?select=store_listed,store_listed_at,store_playback&id=eq.${ids.album}`)) as Record<string, unknown>[])[0];
  expect(row).toMatchObject({ store_listed: true, store_playback: 'full' });
  expect(row.store_listed_at).toBeTruthy();
  const listed = (await events(request, ids.album)).find((e) => e.verb === 'release.store_listed')!;
  expect(listed).toMatchObject({ audit: true, visibility: 'artist', actor_id: PRODUCER_ID });

  // The tracklist is held while it is on the store.
  const locked = await ctx.request.post(`${api}/releases/${ids.album}/items`, { data: { song_track_id: SONG_1 } });
  expect(locked.status()).toBe(409);
  await ctx.close();
});

for (const [label, size] of [['1440 px', { width: 1440, height: 900 }], ['390 px', { width: 390, height: 844 }]] as const) {
  test(`4 · a stranger finds the album on /store at ${label}, opens it and hears it`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/store`);
    const strip = page.getByTestId('releases-strip');
    await expect(strip).toBeVisible({ timeout: 90_000 });
    const tile = strip.getByTestId('release-tile').filter({ hasText: ALBUM });
    await expect(tile).toBeVisible();
    await expect(tile).toContainText('Released');
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/store/releases/${ids.album}$`));
    await expect(page.getByRole('heading', { name: ALBUM })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('released-badge')).toBeVisible();
    await expect(page.getByTestId('release-tracklist').locator('li')).toHaveCount(2);
    // Nothing on the page is for sale.
    await expect(page.getByText(/Buy|Add to cart/i)).toHaveCount(0);

    await page.getByTestId('release-play-all').click();
    await expect
      .poll(async () => (await audios(page)).some((a) => !a.paused && a.time > 0.3 && a.src.includes(`/api/store/releases/${ids.album}/audio/`)), { timeout: 60_000 })
      .toBe(true);

    // No horizontal scroll at either width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await ctx.close();
  });
}

test('5 · nothing private reaches the public JSON, and a release an artist has a say on is never cached (LABEL-71)', async ({ request }) => {
  const list = await request.get('/api/store/releases');
  expect(list.status()).toBe(200);
  // Listing asked the album's artist (a `proposed` consent row), so the list holds a consent-governed release:
  // doc 26 serves that no-store, so an artist's no is never held by an edge cache.
  expect(list.headers()['cache-control']).toBe('no-store');
  const text = await list.text();
  expect(text).toContain(ALBUM);
  const detail = await request.get(`/api/store/releases/${ids.album}`);
  const body = await detail.text();
  expect(body).not.toMatch(new RegExp(`${ORG}|${SONG_1}|/uploads/|r2://|user_id|org_id`));
  const item = (JSON.parse(body) as { tracks: { id: string }[] }).tracks[0];
  const audio = await request.get(`/api/store/releases/${ids.album}/audio/${item.id}`, { headers: { range: 'bytes=0-99' } });
  // LABEL-72: always a bounded partial of the derivative, whatever was asked — the master is never what is streamed.
  expect(audio.status()).toBe(206);
  expect(audio.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);
  expect(audio.headers()['content-type']).toBe('audio/mpeg');
  for (const range of [undefined, 'bytes=0-']) {
    const res = await request.get(`/api/store/releases/${ids.album}/audio/${item.id}`, range ? { headers: { range } } : undefined);
    expect(res.status(), String(range)).toBe(206);
    expect(res.headers()['content-range']).toMatch(/^bytes 0-\d+\/\d+$/);
    expect((await res.body()).length).toBeLessThanOrEqual(1024 * 1024);
  }
  expect((await request.get(`/api/store/releases/${ids.album}/audio/${item.id}`, { headers: { range: 'bytes=99999999-' } })).status()).toBe(416);
  expect(Buffer.from(await audio.body()).subarray(0, 4).toString('latin1')).not.toBe('RIFF'); // an MP3, not the WAV master
  // An org song id is not a handle: only items are.
  expect((await request.get(`/api/store/releases/${ids.album}/audio/${SONG_1}`)).status()).toBe(404);
});

test('6 · unlisting takes it off the store at once and leaves its audit row', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.album}`);
  const card = page.getByTestId('release-store');
  await expect(card).toHaveAttribute('data-listed', 'true', { timeout: 90_000 });
  await page.getByTestId('release-store-unlist').click();
  await expect(card).toHaveAttribute('data-listed', 'false', { timeout: 60_000 });

  const list = await request.get('/api/store/releases');
  expect(await list.text()).not.toContain(ALBUM);
  expect((await request.get(`/api/store/releases/${ids.album}`)).status()).toBe(404);
  const unlisted = (await events(request, ids.album)).find((e) => e.verb === 'release.store_unlisted')!;
  expect(unlisted).toMatchObject({ audit: true, visibility: 'artist', actor_id: PRODUCER_ID });

  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await sp.goto(`${baseURL}/store/releases/${ids.album}`);
  await expect(sp.getByText('This release is not on the store.')).toBeVisible({ timeout: 60_000 });
  await stranger.close();
  await ctx.close();
});

test('7 · withdrawing a listed release takes it off the store in the same step, leaves both audit rows and cannot be undone by listing (LABEL-56)', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const relist = await ctx.request.put(`${api}/releases/${ids.album}/store`, { data: { listed: true } });
  expect(relist.status(), await relist.text()).toBe(200);
  expect(await (await request.get('/api/store/releases')).text()).toContain(ALBUM);

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.album}`);
  await page.getByTestId('release-withdraw-open').click();
  await expect(page.getByTestId('release-withdraw-panel')).toContainText(/comes off the store/);
  await page.getByTestId('release-withdraw').click();
  await expect(page.getByTestId('release-withdrawn')).toBeVisible({ timeout: 60_000 });

  const row = ((await rest(request, 'GET', `releases?select=state,store_listed,store_listed_at,store_playback&id=eq.${ids.album}`)) as Record<string, unknown>[])[0];
  expect(row).toMatchObject({ state: 'withdrawn', store_listed: false, store_listed_at: null, store_playback: 'preview' });
  expect(await (await request.get('/api/store/releases')).text()).not.toContain(ALBUM);
  expect((await request.get(`/api/store/releases/${ids.album}`)).status()).toBe(404);
  const verbs = (await events(request, ids.album)).map((e) => e.verb);
  expect(verbs.filter((v) => v === 'release.withdrawn')).toHaveLength(1);
  expect(verbs.filter((v) => v === 'release.store_unlisted').length).toBeGreaterThanOrEqual(2);
  const withdrawn = (await events(request, ids.album)).find((e) => e.verb === 'release.withdrawn')!;
  expect(withdrawn).toMatchObject({ audit: true, visibility: 'internal', actor_id: PRODUCER_ID });

  // A withdrawn release is not listed again (even one entered as already out).
  const again = await ctx.request.put(`${api}/releases/${ids.album}/store`, { data: { listed: true } });
  expect(again.status()).toBe(409);
  expect((await again.json()).field).toBe('state');
  await ctx.close();
});


test('8 · a delivered release before its date is a TEASER: previews only, full songs cannot be chosen, and the public sees no whole song (LABEL-72)', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const future = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const created = await ctx.request.post(`${api}/releases`, { data: { title: `Teaser ${run}`, contact_id: NOVA, type: 'single', release_date: future } });
  expect(created.status(), await created.text()).toBe(201);
  ids.teaser = (await created.json()).release.id;
  const add = await ctx.request.post(`${api}/releases/${ids.teaser}/items`, { data: { song_track_id: SONG_2 } });
  expect(add.status(), await add.text()).toBe(201);
  const delivered = await ctx.request.post(`${api}/releases/${ids.teaser}/deliver`, { data: { distributor: 'DistroKid', override: true, override_note: 'e2e teaser' } });
  expect(delivered.status(), await delivered.text()).toBe(200);

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.teaser}`);
  await expect(page.getByTestId('release-store')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('release-store-teaser')).toContainText(future);
  await expect(page.getByTestId('release-store-playback-full')).toBeDisabled();
  await expect(page.getByTestId('release-store-playback-preview')).toHaveAttribute('aria-checked', 'true');

  // The real route refuses full before the date, with the reason, and writes nothing.
  const full = await ctx.request.put(`${api}/releases/${ids.teaser}/store`, { data: { listed: true, playback: 'full' } });
  expect(full.status()).toBe(409);
  expect((await full.json()).field).toBe('playback');
  expect(((await rest(request, 'GET', `releases?select=store_listed&id=eq.${ids.teaser}`)) as { store_listed: boolean }[])[0].store_listed).toBe(false);

  await page.getByTestId('release-store-list').click();
  await expect(page.getByTestId('release-store')).toHaveAttribute('data-listed', 'true', { timeout: 60_000 });
  const row = ((await rest(request, 'GET', `releases?select=store_listed,store_playback&id=eq.${ids.teaser}`)) as Record<string, unknown>[])[0];
  expect(row).toMatchObject({ store_listed: true, store_playback: 'preview' });

  // The public sees the teaser as a preview release; no whole song is reachable (nothing is promoted without R2).
  const detail = await request.get(`/api/store/releases/${ids.teaser}`);
  expect(detail.status()).toBe(200);
  const body = (await detail.json()) as { release: { playback: string }; tracks: { id: string }[] };
  expect(body.release.playback).toBe('preview');
  expect((body.release as { out?: boolean }).out).toBe(false);
  expect((await request.get(`/api/store/releases/${ids.teaser}/audio/${body.tracks[0].id}`)).status()).toBe(404);
  await ctx.close();
});
