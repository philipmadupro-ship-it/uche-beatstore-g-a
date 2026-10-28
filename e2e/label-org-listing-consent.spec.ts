/**
 * Artist consent on store listing (LABEL-71) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true, migration 186 included).
 * What mocks cannot prove: the real tables and guards, that a label member's
 * and the artist's OWN JWT read nothing of the consent table, that the public
 * routes stop serving the instant a `no` is written, and the whole journey
 * through the pages — nobody seeds a consent with the service key.
 *
 * Cast: PRODUCER is the store owner and owns the label LAB (connected to the
 * artist org ART). ARTIST_A owns ART — the artist Ari, by D1. BUYER is an
 * ADMIN (manager) of ART who lists the release. ARTIST_B is nobody's artist
 * and belongs to neither org.
 *
 *   1  the manager lists Ari's release from the page: the artist is asked
 *      (one notification, none for the manager), the public store serves it
 *   2  Ari opens the question from the bell, says no: it is off the store in
 *      the same step, the public API answers 404, both events are audit rows
 *   3  the manager cannot list it again (409, field consent) and the page says
 *      why; the store owner cannot override it; strangers cannot answer
 *   4  Ari says yes; the manager lists again; it is public again
 *   5  the store owner sees it under "Releases from connected artists" and
 *      Unlists: 404 publicly, the artist org's own row untouched, a veto row in
 *      LAB; Allow again lifts it
 *   6  RLS: the artist's, the manager's and the label owner's own JWTs read
 *      none of listing_consents / store_listing_vetoes
 *
 * Screenshots go to e2e-artifacts/LABEL-71/ (not committed).
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const LAB = randomUUID();
const ART = randomUUID();
const LAB_SLUG = `night-shift-${run}`;
const ART_SLUG = `ari-${run}`;
const LAB_CONTACT = randomUUID();
const SONG = randomUUID();
const TITLE = `Ari EP ${run}`;
const SHOTS = path.join(process.cwd(), 'e2e-artifacts', 'LABEL-71');

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const artist = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const manager = { id: BUYER_ID, email: 'buyer@local.test' };
const stranger = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const api = `/api/org/${ART}`;
const ids: { release?: string; contact?: string } = {};

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

/** A PostgREST read with the person's OWN JWT: row level security decides, not the app. */
async function asUser(request: APIRequestContext, u: { id: string; email: string }, p: string) {
  const res = await request.fetch(`${REST}/${p}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(u.id, u.email)}` } });
  return { status: res.status(), text: await res.text() };
}

async function as(browser: Browser, baseURL: string, u: { id: string; email: string }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport });
  const c = sessionCookie(u.id, u.email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

type EventRow = { verb: string; audit: boolean; visibility: string; actor_id: string | null; org_id: string };
const events = async (request: APIRequestContext, release: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,visibility,actor_id,org_id&release_id=eq.${release}&order=created_at`)) as EventRow[];
const releaseRow = async (request: APIRequestContext) =>
  ((await rest(request, 'GET', `releases?select=store_listed,store_playback&id=eq.${ids.release}`)) as { store_listed: boolean; store_playback: string }[])[0];
const publicStatus = async (request: APIRequestContext) => (await request.get(`/api/store/releases/${ids.release}`)).status();

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await rest(request, 'POST', 'organizations', [
    { id: LAB, name: `Night Shift ${run}`, slug: LAB_SLUG, kind: 'label', created_by: PRODUCER_ID },
    { id: ART, name: `Ari ${run}`, slug: ART_SLUG, kind: 'artist', created_by: ARTIST_A_ID },
  ]);
  await rest(request, 'POST', 'org_members', [
    { org_id: LAB, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ART, user_id: ARTIST_A_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ART, user_id: BUYER_ID, role: 'admin', functions: [], scope: 'org', invited_by: ARTIST_A_ID },
  ]);
  // An artist org is created with its one roster artist (the artist themselves).
  const contacts = (await rest(request, 'GET', `contacts?select=id&org_id=eq.${ART}`)) as { id: string }[];
  ids.contact = contacts[0].id;
  await rest(request, 'PATCH', `contacts?id=eq.${ids.contact}`, { name: `Ari ${run}`, category: 'artist' });
  // The connection: asked, then accepted (a label roster contact stands for the artist).
  const conn = (await rest(request, 'POST', 'org_connections', { label_org_id: LAB, artist_org_id: ART, initiated_by: 'label', requested_by: PRODUCER_ID })) as { id: string }[];
  await rest(request, 'POST', 'contacts', { id: LAB_CONTACT, org_id: LAB, user_id: null, name: `Ari ${run}`, category: 'artist' });
  await rest(request, 'PATCH', `org_connections?id=eq.${conn[0].id}`, { status: 'active', label_contact_id: LAB_CONTACT, accepted_by: ARTIST_A_ID, accepted_at: new Date().toISOString() });
  await rest(request, 'POST', 'tracks', { id: SONG, org_id: ART, user_id: null, created_by: ARTIST_A_ID, title: `Song ${run}`, type: 'song', song_stage: 'selected', audio_url: '/uploads/none.wav', duration_seconds: 6 });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=in.(${LAB},${ART})`);
});

test('1 · the manager lists Ari’s release from the page; Ari is asked, the manager is not, and the store serves it', async ({ browser, baseURL, request }) => {
  const mgr = await as(browser, baseURL!, manager);
  // Setup, through the real routes: an album already out, with its song.
  const created = await mgr.request.post(`${api}/releases`, { data: { title: TITLE, contact_id: ids.contact, type: 'ep', release_date: '2019-05-17', imported_released: true } });
  expect(created.status(), await created.text()).toBe(201);
  ids.release = (await created.json()).release.id;
  const add = await mgr.request.post(`${api}/releases/${ids.release}/items`, { data: { song_track_id: SONG } });
  expect(add.status(), await add.text()).toBe(201);

  const page = await mgr.newPage();
  await page.goto(`/o/${ART_SLUG}/releases/${ids.release}`);
  const card = page.getByTestId('release-store');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('release-store-state')).toHaveText(/Not on the store/);
  await page.getByTestId('release-store-list').click();
  await expect(card).toHaveAttribute('data-listed', 'true', { timeout: 60_000 });
  await expect(page.getByTestId('release-store-asked')).toContainText('1 artist was asked');
  await expect(page.getByTestId('release-store-consent')).toHaveAttribute('data-status', 'waiting');
  await expect(page.getByTestId('release-store-consent-artist')).toHaveAttribute('data-state', 'proposed');
  await page.screenshot({ path: path.join(SHOTS, '1-manager-listed-1440.png'), fullPage: true });

  const consent = (await rest(request, 'GET', `listing_consents?select=state,artist_contact_id,proposed_by&release_id=eq.${ids.release}`)) as Record<string, string>[];
  expect(consent).toEqual([{ state: 'proposed', artist_contact_id: ids.contact, proposed_by: BUYER_ID }]);
  // One question, to the artist; the asker is never told of their own ask.
  const bell = (await rest(request, 'GET', `notifications?select=user_id,kind,org_id,body&org_id=eq.${ART}&kind=eq.listing_proposed`)) as Record<string, string>[];
  expect(bell).toEqual([{ user_id: ARTIST_A_ID, kind: 'listing_proposed', org_id: ART, body: TITLE }]);
  const listed = (await events(request, ids.release!)).find((e) => e.verb === 'release.store_listed')!;
  expect(listed).toMatchObject({ audit: true, actor_id: BUYER_ID });
  // Silence is not a no: it serves while the artist decides.
  expect(await publicStatus(request)).toBe(200);
  await mgr.close();
});

test('2 · Ari opens the question from the bell and says no: it is off the store in the same step', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, artist);
  const page = await ctx.newPage();
  await page.goto(`/o/${ART_SLUG}`);
  // The bell: the ask links to Store listings, where the question is answered.
  await page.getByRole('button', { name: /notifications/i }).first().click({ timeout: 90_000 });
  await expect(page.getByText('asked for your say on putting a release on the store').first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('asked for your say on putting a release on the store').first().click();
  await expect(page).toHaveURL(new RegExp(`/o/${ART_SLUG}/releases/store$`), { timeout: 30_000 });
  const row = page.getByTestId('store-asked-row');
  await expect(row).toContainText(TITLE);
  await expect(row).toHaveAttribute('data-state', 'proposed');
  await page.screenshot({ path: path.join(SHOTS, '2-artist-asked-1440.png'), fullPage: true });

  await page.getByTestId('store-asked-no').click();
  await page.getByRole('button', { name: 'Say no', exact: true }).click();
  await expect(row).toHaveAttribute('data-state', 'no', { timeout: 30_000 });
  await expect(row).toContainText('off the store, until you say yes');
  await page.screenshot({ path: path.join(SHOTS, '2-artist-said-no-1440.png'), fullPage: true });

  expect(await releaseRow(request)).toMatchObject({ store_listed: false, store_playback: 'preview' });
  expect(await publicStatus(request)).toBe(404);
  const evs = await events(request, ids.release!);
  expect(evs.find((e) => e.verb === 'listing.consent_decided')).toMatchObject({ audit: true, visibility: 'internal', actor_id: ARTIST_A_ID, org_id: ART });
  expect(evs.filter((e) => e.verb === 'release.store_unlisted')).toHaveLength(1);
  const rows = (await rest(request, 'GET', `listing_consents?select=state,decided_by&release_id=eq.${ids.release}`)) as Record<string, string>[];
  expect(rows).toEqual([{ state: 'no', decided_by: ARTIST_A_ID }]);
  await ctx.close();
});

test('3 · after a no it cannot be listed again: the page says why, the route is 409, nobody can answer for Ari', async ({ browser, baseURL, request }) => {
  const mgr = await as(browser, baseURL!, manager);
  const page = await mgr.newPage();
  await page.goto(`/o/${ART_SLUG}/releases/${ids.release}`);
  await expect(page.getByTestId('release-store-blocked')).toContainText('said no', { timeout: 90_000 });
  await expect(page.getByTestId('release-store-consent')).toHaveAttribute('data-status', 'refused');
  await expect(page.getByTestId('release-store-list')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, '3-manager-blocked-1440.png'), fullPage: true });

  const blocked = await mgr.request.put(`${api}/releases/${ids.release}/store`, { data: { listed: true } });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).field).toBe('consent');
  // The manager is an admin, not the artist: not even their yes counts.
  const forged = await mgr.request.put(`${api}/releases/${ids.release}/consent`, { data: { decision: 'yes' } });
  expect(forged.status()).toBe(404);
  await mgr.close();

  const owner = await as(browser, baseURL!, producer);
  expect([403, 404]).toContain((await owner.request.put(`${api}/releases/${ids.release}/store`, { data: { listed: true } })).status());
  expect([403, 404]).toContain((await owner.request.put(`${api}/releases/${ids.release}/consent`, { data: { decision: 'yes' } })).status());
  await owner.close();
  const other = await as(browser, baseURL!, stranger);
  expect([403, 404]).toContain((await other.request.put(`${api}/releases/${ids.release}/consent`, { data: { decision: 'yes' } })).status());
  await other.close();

  expect((await rest(request, 'GET', `listing_consents?select=state&release_id=eq.${ids.release}`)) as unknown).toEqual([{ state: 'no' }]);
  expect(await publicStatus(request)).toBe(404);
});

test('4 · Ari says yes at 390 px; the manager can list again and it is public again', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, artist, { width: 390, height: 844 });
  const page = await ctx.newPage();
  await page.goto(`/o/${ART_SLUG}/releases/store`);
  const row = page.getByTestId('store-asked-row');
  await expect(row).toHaveAttribute('data-state', 'no', { timeout: 90_000 });
  await page.screenshot({ path: path.join(SHOTS, '4-artist-no-390.png'), fullPage: true });
  await page.getByTestId('store-asked-yes').click();
  await expect(row).toHaveAttribute('data-state', 'yes', { timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, '4-artist-yes-390.png'), fullPage: true });
  await ctx.close();

  const mgr = await as(browser, baseURL!, manager);
  const page2 = await mgr.newPage();
  await page2.goto(`/o/${ART_SLUG}/releases/${ids.release}`);
  const card = page2.getByTestId('release-store');
  await page2.getByTestId('release-store-list').click({ timeout: 90_000 });
  await expect(card).toHaveAttribute('data-listed', 'true', { timeout: 60_000 });
  await expect(page2.getByTestId('release-store-consent')).toHaveAttribute('data-status', 'agreed');
  expect(await publicStatus(request)).toBe(200);
  await mgr.close();
});

test('5 · the store owner unlists it from "Releases from connected artists"; the artist org is not written to; Allow again lifts it', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer);
  const page = await ctx.newPage();
  await page.goto(`/o/${LAB_SLUG}/releases/store`);
  const rowFor = page.getByTestId('store-connected-row').filter({ hasText: TITLE });
  await expect(rowFor).toBeVisible({ timeout: 90_000 });
  await expect(rowFor).toHaveAttribute('data-serving', 'true');
  await expect(page.getByTestId('store-asked-empty')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '5-owner-connected-1440.png'), fullPage: true });

  await rowFor.getByTestId('store-connected-unlist').click();
  await page.getByRole('button', { name: 'Unlist', exact: true }).last().click();
  await expect(rowFor.getByTestId('store-connected-allow')).toBeVisible({ timeout: 30_000 });
  await expect(rowFor).toHaveAttribute('data-serving', 'false');
  await expect(rowFor).toContainText('taken off by you');
  await page.screenshot({ path: path.join(SHOTS, '5-owner-unlisted-1440.png'), fullPage: true });

  expect(await publicStatus(request)).toBe(404);
  // The artist org's release row is untouched; the veto is a row in the LABEL org.
  expect(await releaseRow(request)).toMatchObject({ store_listed: true });
  expect((await rest(request, 'GET', `store_listing_vetoes?select=org_id,vetoed_by&release_id=eq.${ids.release}`)) as unknown).toEqual([{ org_id: LAB, vetoed_by: PRODUCER_ID }]);
  const evs = await events(request, ids.release!);
  expect(evs.filter((e) => e.verb === 'listing.vetoed').map((e) => e.org_id).sort()).toEqual([ART, LAB].sort());
  expect(evs.find((e) => e.verb === 'listing.vetoed')).toMatchObject({ audit: true, visibility: 'internal' });

  // The artist side cannot list it again over the veto.
  const mgr = await as(browser, baseURL!, manager);
  const relist = await mgr.request.put(`${api}/releases/${ids.release}/store`, { data: { listed: true } });
  expect(relist.status()).toBe(409);
  expect((await relist.json()).field).toBe('veto');
  expect(await publicStatus(request)).toBe(404);
  await mgr.close();

  // Only the store owner has the list: ARTIST_B (not a member) and the artist org's owner get nothing.
  const other = await as(browser, baseURL!, artist);
  expect([403, 404]).toContain((await other.request.get(`/api/org/${LAB}/connected-releases`)).status());
  expect([403, 404]).toContain((await other.request.put(`/api/org/${LAB}/connected-releases/${ids.release}`, { data: { listed: false } })).status());
  await other.close();

  await rowFor.getByTestId('store-connected-allow').click();
  await expect(rowFor.getByTestId('store-connected-unlist')).toBeVisible({ timeout: 30_000 });
  expect(await publicStatus(request)).toBe(200);
  expect((await rest(request, 'GET', `store_listing_vetoes?select=release_id&release_id=eq.${ids.release}`)) as unknown).toEqual([]);
  await ctx.close();
});

test('6 · row level security: nobody reads or writes the consent tables with their own JWT', async ({ request }) => {
  for (const who of [artist, manager, producer, stranger]) {
    for (const table of ['listing_consents', 'store_listing_vetoes']) {
      const res = await asUser(request, who, `${table}?select=*`);
      // Privileges are revoked and the one policy says no: an error or nothing, never a row.
      expect(res.text, `${who.email} ${table}`).not.toContain(ids.release!);
    }
  }
  const forge = await request.fetch(`${REST}/listing_consents`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(artist.id, artist.email)}`, 'content-type': 'application/json' },
    data: JSON.stringify({ org_id: ART, release_id: ids.release, artist_contact_id: ids.contact, state: 'yes' }),
  });
  expect(forge.ok()).toBe(false);
});
