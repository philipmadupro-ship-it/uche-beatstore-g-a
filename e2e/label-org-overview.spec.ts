/**
 * Org Overview (LABEL-18) end to end against a REAL database (scripts/local-db:
 * Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true). What mocks cannot prove:
 * the counts come out of real rows through the real scope walk, an
 * artists-scoped member's page and API carry nothing of the other artist, and
 * a song a role may not see is a number on the page, never a title.
 *
 * The producer owns a label with artists Nova (selected "Midnight", in
 * development "Sketch") and Kilo (selected "Kilo Only"). The seed BUYER is an
 * A&R member limited to Nova, later switched to marketing (the whole org,
 * finished audio only).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `overview-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();
const SONG = randomUUID();
const MASTER = randomUUID();
const DEMO = randomUUID();
const KILO_SONG = randomUUID();
const WIP = randomUUID();

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function as(browser: Browser, baseURL: string, id: string, email: string, viewport?: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext(viewport ? { viewport } : undefined);
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const track = (id: string, title: string, stage: string | null, type = 'song') => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type, song_stage: stage, audio_url: `/uploads/labelos-e2e-${id}.mp3`,
});

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Overview Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: BUYER_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA },
    { id: KILO_INBOX, org_id: ORG, user_id: null, name: `Inbox · Kilo ${run}`, inbox_for_contact_id: KILO },
  ]);
  await rest(request, 'POST', 'tracks', [
    track(SONG, 'Midnight', 'selected'),
    track(MASTER, 'Midnight (master)', null),
    track(DEMO, 'Midnight (demo)', null),
    track(WIP, 'Sketch', 'in_development'),
    track(KILO_SONG, 'Kilo Only', 'selected'),
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: SONG, position: 0 },
    { project_id: NOVA_INBOX, track_id: MASTER, position: 1 },
    { project_id: NOVA_INBOX, track_id: DEMO, position: 2 },
    { project_id: NOVA_INBOX, track_id: WIP, position: 3 },
    { project_id: KILO_INBOX, track_id: KILO_SONG, position: 0 },
  ]);
  await rest(request, 'POST', 'track_links', [
    { from_track_id: SONG, to_track_id: MASTER, user_id: null, relation: 'master' },
    { from_track_id: SONG, to_track_id: DEMO, user_id: null, relation: 'demo' },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

const cell = (page: import('@playwright/test').Page, kind: string, id: string) => page.getByTestId(`overview-${kind}-${id}`);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1 · the owner's Overview counts every artist's songs by stage at ${viewport.width}px`, async ({ browser, baseURL }) => {
    const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test', viewport);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}`);
    await expect(page.getByTestId('overview')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
    await expect(page.getByTestId('overview-totals')).toContainText('2 artists · 3 songs');
    // Nova: Midnight selected, Sketch in development. Kilo: Kilo Only selected.
    // (The columns are hidden below md; their text is still in the DOM.)
    await expect(cell(page, 'dev', NOVA)).toHaveText('1');
    await expect(cell(page, 'selected', NOVA)).toHaveText('1');
    await expect(cell(page, 'demos', NOVA)).toHaveText('0');
    await expect(cell(page, 'selected', KILO)).toHaveText('1');
    await expect(cell(page, 'release', NOVA)).toHaveText('—');
    // A row opens the artist's workspace.
    await page.getByRole('link', { name: `Open Nova ${run}` }).click();
    await expect(page.getByTestId('org-artist-workspace')).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });
}

test('2 · an artist-scoped member sees only their artist: no Kilo row, count or title, on the page or in the API', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const body = JSON.stringify(await (await ctx.request.get(`/api/org/${ORG}/overview`)).json());
  expect(body).toContain(`Nova ${run}`);
  expect(body).not.toContain('Kilo');
  expect(body).not.toContain(KILO);

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByTestId('overview')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('overview-totals')).toContainText('1 artist · 2 songs');
  await expect(page.getByTestId(`overview-artist-${NOVA}`)).toBeVisible();
  await expect(page.getByTestId(`overview-artist-${KILO}`)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Kilo');
  await ctx.close();
});

test('3 · marketing: a working song is a "restricted" number on the row, never a title', async ({ browser, baseURL, request }) => {
  await rest(request, 'DELETE', `member_artist_scopes?user_id=eq.${BUYER_ID}`);
  await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, { functions: ['marketing'], scope: 'org' });

  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const body = JSON.stringify(await (await ctx.request.get(`/api/org/${ORG}/overview`)).json());
  expect(body).not.toContain('Sketch');
  expect(body).not.toContain('Midnight');

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByTestId('overview')).toBeVisible({ timeout: 30_000 });
  await expect(cell(page, 'dev', NOVA)).toHaveText('0');
  await expect(cell(page, 'selected', NOVA)).toHaveText('1');
  await expect(page.getByTestId(`overview-restricted-${NOVA}`)).toContainText('1 song restricted');
  await expect(page.locator('body')).not.toContainText('Sketch');
  await ctx.close();
});
