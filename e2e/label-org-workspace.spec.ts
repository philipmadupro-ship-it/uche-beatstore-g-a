/**
 * Org artist workspace, song view and project page (LABEL-17) end to end
 * against a REAL database (scripts/local-db: Postgres + PostgREST + RLS,
 * LABEL_OS_ENABLED=true). What mocks cannot prove: migration 145 lets the
 * org write ownerless #44 rows the workspace reads, the scoped member's
 * 404 holds on the real pages and routes, and what a role may not hear is
 * absent from the payload while the page says "restricted".
 *
 * The producer owns a label with artists Nova and Kilo. Nova has a song
 * "Midnight" (selected: its own mix plus a master and a demo linked from it)
 * and a release. The seed BUYER is an A&R member limited to Nova, later
 * switched to marketing (the whole org, finished audio only).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `workspace-${run}`;
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
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Workspace Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
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

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1 · the owner's workspace tabs work at ${viewport.width}px`, async ({ browser, baseURL }) => {
    const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test', viewport);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}/artists/${NOVA}`);
    const ws = page.getByTestId('org-artist-workspace');
    await expect(ws).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Nova ${run}`);

    for (const name of ['Projects', 'Songs', 'Releases', 'Files', 'Overview']) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
    await page.getByRole('tab', { name: /^Songs/ }).click();
    await expect(page.getByTestId(`ows-song-${SONG}`)).toContainText('Midnight');
    await expect(page.getByTestId(`ows-song-${SONG}`)).toContainText('Selected');
    await expect(page.getByTestId(`ows-song-${WIP}`)).toContainText('In development');
    await expect(page.getByTestId('ows-songs-restricted')).toHaveCount(0);
    await ctx.close();
  });

  test(`2 · A/B switches between two recordings without leaving the page at ${viewport.width}px`, async ({ browser, baseURL }) => {
    const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test', viewport);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}/songs/${SONG}`);
    await expect(page.getByTestId('org-song')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('org-song-stage')).toHaveText('Selected');
    const url = page.url();

    const recs = page.locator('[data-testid^="org-rec-"]');
    expect(await recs.count()).toBeGreaterThanOrEqual(2);
    const first = recs.nth(0).getByRole('button', { name: /^(Play|Pause) / });
    const second = recs.nth(1).getByRole('button', { name: /^(Play|Pause) / });
    const ab = page.getByTestId('org-song-ab');

    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(ab).toContainText('A/B · A');
    await ab.click();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(ab).toContainText('A/B · B');
    await ab.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(ab).toContainText('A/B · A');
    expect(page.url()).toBe(url);
    await ctx.close();
  });
}

test('3 · an artist-scoped member opens Nova and gets 404 for everything of Kilo', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const api = ctx.request;
  expect((await api.get(`/api/org/${ORG}/artists/${NOVA}/workspace`)).status()).toBe(200);
  expect((await api.get(`/api/org/${ORG}/songs/${SONG}`)).status()).toBe(200);
  expect((await api.get(`/api/org/${ORG}/projects/${NOVA_INBOX}`)).status()).toBe(200);
  expect((await api.get(`/api/org/${ORG}/artists/${KILO}/workspace`)).status()).toBe(404);
  expect((await api.get(`/api/org/${ORG}/songs/${KILO_SONG}`)).status()).toBe(404);
  expect((await api.get(`/api/org/${ORG}/projects/${KILO_INBOX}`)).status()).toBe(404);

  const page = await ctx.newPage();
  expect((await page.goto(`/o/${SLUG}/artists/${NOVA}`))!.status()).toBe(200);
  await expect(page.getByTestId('org-artist-workspace')).toBeVisible({ timeout: 30_000 });
  for (const path of [`artists/${KILO}`, `songs/${KILO_SONG}`, `projects/${KILO_INBOX}`]) {
    expect((await page.goto(`/o/${SLUG}/${path}`))!.status(), path).toBe(404);
  }
  // The roster card of Nova links to the workspace.
  await page.goto(`/o/${SLUG}/artists`);
  await expect(page.getByTestId(`artist-card-${NOVA}`)).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

test('4 · marketing sees finished music only; the rest says "restricted", not empty', async ({ browser, baseURL, request }) => {
  await rest(request, 'DELETE', `member_artist_scopes?user_id=eq.${BUYER_ID}`);
  await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, { functions: ['marketing'], scope: 'org' });

  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const body = await (await ctx.request.get(`/api/org/${ORG}/artists/${NOVA}/workspace`)).json();
  const text = JSON.stringify(body);
  expect(text).toContain('Midnight');
  expect(text).not.toContain('Sketch');

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/artists/${NOVA}?tab=songs`);
  await expect(page.getByTestId(`ows-song-${SONG}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`ows-song-${WIP}`)).toHaveCount(0);
  await expect(page.getByTestId('ows-songs-restricted')).toContainText('restricted');

  // The song page: the demo is working material, absent and named as restricted.
  await page.goto(`/o/${SLUG}/songs/${SONG}`);
  await expect(page.getByTestId('org-song')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`org-rec-${DEMO}`)).toHaveCount(0);
  await expect(page.getByTestId('org-song-restricted')).toContainText('restricted');
  // An in-development song is not reachable by id.
  expect((await page.goto(`/o/${SLUG}/songs/${WIP}`))!.status()).toBe(404);
  await ctx.close();
});
