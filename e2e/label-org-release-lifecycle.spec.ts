/**
 * The delivered-release lifecycle and the draft-song class (LABEL-56) end to
 * end against a REAL database (scripts/local-db, LABEL_OS_ENABLED=true).
 * What mocks cannot prove: migration 193's CHECK accepts `withdrawn` and the
 * route's conditional UPDATE claims it through PostgREST; the withdrawal and
 * its audit event are one outcome; the page offers Withdraw (not Cancel) on a
 * delivered release and the server's own words come back when it is refused;
 * and a song on a DRAFT release is working for marketing (route AND database
 * row rule) until the release is delivered.
 *
 * Cast: the producer owns the label and delivers with the owner's override;
 * ARTIST_A is a_and_r (release.write); the seed BUYER is marketing (reads, no
 * release.write, finished audio only).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ARTIST_A_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `lifecycle-${run}`;
const NOVA = randomUUID();
const SONG = randomUUID();
const SHOTS = 'e2e-artifacts/LABEL-56';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);
mkdirSync(SHOTS, { recursive: true });

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
const marketing = { id: BUYER_ID, email: 'buyer@local.test' };
const api = `/api/org/${ORG}`;
const ids: Record<string, string> = {};

type EventRow = { verb: string; audit: boolean; visibility: string; actor_id: string | null; payload: Record<string, unknown> };
const events = async (request: APIRequestContext, verb: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,visibility,actor_id,payload&verb=eq.${verb}&release_id=eq.${ids.release}`)) as EventRow[];
const releaseRow = async (request: APIRequestContext) =>
  ((await rest(request, 'GET', `releases?select=state,delivered_at,delivered_to,store_listed&id=eq.${ids.release}`)) as Record<string, unknown>[])[0];

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Lifecycle Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'tracks', {
    id: SONG, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${SONG}.mp3`,
  });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID].join(',')})`);
});

test('1 · a song on a DRAFT release is working: marketing is refused its audio and its row until the release is delivered', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const created = await ctx.request.post(`${api}/releases`, { data: { title: `Midnight EP ${run}`, contact_id: NOVA, type: 'single' } });
  expect(created.status(), await created.text()).toBe(201);
  ids.release = (await created.json()).release.id;
  const add = await ctx.request.post(`${api}/releases/${ids.release}/items`, { data: { song_track_id: SONG } });
  expect(add.status(), await add.text()).toBe(201);

  const mkt = await as(browser, baseURL!, marketing.id, marketing.email);
  const audio = `${api}/audio/${SONG}?variant=wav`;
  const row = async () =>
    (await (await request.get(`${REST}/tracks?select=id&id=eq.${SONG}`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, marketing.email)}` },
    })).json()) as unknown[];
  // Draft: working — the route (403 at D4) and the database row rule agree.
  expect((await mkt.request.get(audio)).status()).toBe(403);
  expect(await row()).toEqual([]);
  // The song's A&R (working audio) is unaffected: past D4 to the file lookup.
  const ar = await as(browser, baseURL!, aAndR.id, aAndR.email);
  expect((await ar.request.get(audio)).status()).toBe(404);

  // Deliver through the REAL route (owner override: the gates are not all satisfied).
  const deliver = await ctx.request.post(`${api}/releases/${ids.release}/deliver`, { data: { distributor: 'DistroKid', override: true, override_note: 'e2e: lifecycle' } });
  expect(deliver.status(), await deliver.text()).toBe(200);
  expect((await mkt.request.get(audio)).status()).toBe(404); // past D4: finished now (an mp3-only song has no wav file)
  expect(await row()).toEqual([{ id: SONG }]);
  await ctx.close();
  await mkt.close();
  await ar.close();
});

test('2 · a delivered release is not cancelled or deleted: the answers say withdraw it instead', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const cancel = await ctx.request.patch(`${api}/releases/${ids.release}`, { data: { state: 'cancelled' } });
  expect(cancel.status()).toBe(409);
  expect((await cancel.json()).error).toMatch(/only a draft can be cancelled.*withdraw it instead/i);
  const del = await ctx.request.delete(`${api}/releases/${ids.release}`);
  expect(del.status()).toBe(409);
  expect((await del.json()).error).toMatch(/only a draft.*withdraw it instead/i);
  expect(await releaseRow(request)).toMatchObject({ state: 'delivered' });
  await ctx.close();
});

for (const [label, size] of [['1440 px', { width: 1440, height: 900 }], ['390 px', { width: 390, height: 844 }]] as const) {
  test(`3 · marketing has no Withdraw; the owner withdraws from the page at ${label} and the record stays`, async ({ browser, baseURL, request }) => {
    const reset = label === '1440 px';
    // At 390 px the same flow runs on a second delivered release (the first was withdrawn at 1440 px).
    if (!reset) {
      const ctx0 = await as(browser, baseURL!, producer.id, producer.email);
      const second = await ctx0.request.post(`${api}/releases`, { data: { title: `Second ${run}`, contact_id: NOVA, type: 'single' } });
      ids.release = (await second.json()).release.id;
      const d = await ctx0.request.post(`${api}/releases/${ids.release}/deliver`, { data: { distributor: 'DistroKid', override: true, override_note: 'e2e: lifecycle 390' } });
      expect(d.status(), await d.text()).toBe(200);
      await ctx0.close();
    }

    const mktCtx = await as(browser, baseURL!, marketing.id, marketing.email);
    const mktPage = await mktCtx.newPage();
    await mktPage.setViewportSize(size);
    await mktPage.goto(`/o/${SLUG}/releases/${ids.release}`);
    await expect(mktPage.getByTestId('release-delivered')).toBeVisible({ timeout: 90_000 });
    await expect(mktPage.getByTestId('release-withdraw-open')).toHaveCount(0);
    await mktCtx.close();

    const ctx = await as(browser, baseURL!, producer.id, producer.email);
    const page = await ctx.newPage();
    await page.setViewportSize(size);
    await page.goto(`/o/${SLUG}/releases/${ids.release}`);
    await expect(page.getByTestId('release-state')).toHaveText(/Delivered/, { timeout: 90_000 });
    // Cancel is a draft's: it is not in the menu of a delivered release.
    await expect(page.getByText('Cancel release')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/delivered-${size.width}.png`, fullPage: true });
    await page.getByTestId('release-withdraw-open').click();
    await page.getByTestId('release-withdraw-note').fill('wrong master sent');
    await page.screenshot({ path: `${SHOTS}/withdraw-panel-${size.width}.png`, fullPage: true });
    const button = page.getByTestId('release-withdraw');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByTestId('release-withdrawn')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('release-state')).toHaveText(/Withdrawn/);
    await expect(page.getByTestId('release-withdraw-open')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/withdrawn-${size.width}.png`, fullPage: true });

    // The record stays; the withdrawal is one internal audit event with the reason.
    expect(await releaseRow(request)).toMatchObject({ state: 'withdrawn', delivered_to: 'DistroKid', store_listed: false });
    const withdrawn = await events(request, 'release.withdrawn');
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({ audit: true, visibility: 'internal', actor_id: PRODUCER_ID });
    expect(withdrawn[0].payload).toMatchObject({ wasListed: false, unlisted: false, note: 'wrong master sent' });

    // A repeat is a 409 and writes no second event; it cannot be delivered or cancelled again either.
    const again = await ctx.request.post(`${api}/releases/${ids.release}/withdraw`, { data: {} });
    expect(again.status()).toBe(409);
    expect((await events(request, 'release.withdrawn'))).toHaveLength(1);
    expect((await ctx.request.post(`${api}/releases/${ids.release}/deliver`, { data: { distributor: 'x' } })).status()).toBe(409);
    expect((await ctx.request.patch(`${api}/releases/${ids.release}`, { data: { state: 'draft' } })).status()).toBe(409);

    // The board lists it under Withdrawn.
    await page.goto(`/o/${SLUG}/releases`);
    await page.getByTestId('release-filter-withdrawn').click();
    await expect(page.getByTestId('release-row-stage').first()).toHaveText('Withdrawn', { timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/board-withdrawn-${size.width}.png`, fullPage: true });
    await ctx.close();
  });
}

test('4 · a withdrawn release went out: its song keeps the class it earned', async ({ browser, baseURL, request }) => {
  const mkt = await as(browser, baseURL!, marketing.id, marketing.email);
  const audio = `${api}/audio/${SONG}?variant=wav`;
  // SONG is on the first release (withdrawn at 1440 px): still finished.
  const [rel] = (await rest(request, 'GET', `release_items?select=release_id,releases(state)&song_track_id=eq.${SONG}`)) as { releases: { state: string } }[];
  expect(rel.releases.state).toBe('withdrawn');
  expect((await mkt.request.get(audio)).status()).toBe(404);
  await mkt.close();
});
