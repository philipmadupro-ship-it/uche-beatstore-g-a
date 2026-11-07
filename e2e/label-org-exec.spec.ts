/**
 * The executive (CEO) dashboard (LABEL-67) end to end against a REAL database (scripts/local-db: Postgres + PostgREST + RLS,
 * LABEL_OS_ENABLED=true). What mocks cannot prove: the page is gated by the same persona table as the nav, the numbers are the
 * rows the earlier tasks stored, D4 keeps an inbox demo off a finished-music-only reader, and the CSV is audited in the database
 * before it is served.
 *
 * Cast: the producer owns the label; ARTIST_A is the executive (function `executive`); the seed BUYER is marketing (no exec.read);
 * ARTIST_B is a roster artist (never). Nothing the feature adds is seeded: the cast, songs, a draft release and two tasks are.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `exec-${run}`;
const NOVA = randomUUID();
const NOVA_INBOX = randomUUID();
const SONG_IN = randomUUID();
const SONG_SEL = randomUUID();
const SONG_LOOSE = randomUUID(); // in no project: a whole-org reader still counts it
const RELEASE = randomUUID();
const RELEASE_TITLE = `=Autumn ${run}`; // a leading "=" proves the CSV guard on a real row

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

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

const shots = 'e2e-artifacts/LABEL-67';
mkdirSync(shots, { recursive: true });

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const exec = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const marketing = { id: BUYER_ID, email: 'buyer@local.test' };
const rosterArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const exportEvents = async (request: APIRequestContext) =>
  (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.exec.exported&select=audit,visibility,payload,actor_id&order=created_at`)) as { audit: boolean; visibility: string; payload: Record<string, unknown>; actor_id: string }[];

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Exec Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['executive'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [{ id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' }]);
  await rest(request, 'POST', 'member_artist_scopes', [{ org_id: ORG, user_id: ARTIST_B_ID, contact_id: NOVA }]);
  await rest(request, 'POST', 'projects', { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', [
    { id: SONG_IN, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Midnight', type: 'song', song_stage: 'inbox', audio_url: `/uploads/labelos-e2e-${SONG_IN}.mp3` },
    { id: SONG_LOOSE, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Loose end', type: 'song', song_stage: 'inbox', audio_url: `/uploads/labelos-e2e-${SONG_LOOSE}.mp3` },
    { id: SONG_SEL, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Dusk', type: 'song', song_stage: 'selected', audio_url: `/uploads/labelos-e2e-${SONG_SEL}.mp3` },
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: SONG_IN, position: 0 },
    { project_id: NOVA_INBOX, track_id: SONG_SEL, position: 1 },
  ]);
  await rest(request, 'POST', 'releases', { id: RELEASE, org_id: ORG, project_id: NOVA_INBOX, contact_id: NOVA, title: RELEASE_TITLE, target_date: '2026-12-05', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'release_items', { release_id: RELEASE, org_id: ORG, position: 1, song_track_id: SONG_SEL, master_track_id: SONG_SEL });
  await rest(request, 'POST', 'tasks', [
    { org_id: ORG, title: 'Clear the master', assignee_id: PRODUCER_ID, created_by: PRODUCER_ID, due_at: '2026-01-01T00:00:00Z' },
    { org_id: ORG, title: 'Brief the press', assignee_id: BUYER_ID, created_by: PRODUCER_ID, due_at: null },
  ]);
});

test.afterAll(async ({ request }) => {
  // Migration 195: an org is deleted only by the purge, 30 days after it was scheduled.
  await rest(request, 'PATCH', `organizations?id=eq.${ORG}`, { deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

for (const vp of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
  test(`1 · the executive sees every section at ${vp.name}px, the inbox demo is counted but never named, nothing overflows`, async ({ browser, baseURL }) => {
    const ctx = await as(browser, baseURL!, exec.id, exec.email);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/o/${SLUG}/exec`);
    await expect(page.getByTestId('exec-dashboard')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Executive' })).toBeVisible();
    // Pipeline counts every song in scope; the inbox demo is a number here, never a title (D4 stays on top songs).
    await expect(page.locator('[data-stage="selected"] [data-testid="pipeline-count"]')).toHaveText('1');
    await expect(page.locator('[data-stage="inbox"] [data-testid="pipeline-count"]')).toHaveText('2');
    await expect(page.getByTestId('exec-dashboard')).not.toContainText('Midnight');
    await expect(page.getByTestId('exec-dashboard')).not.toContainText('Loose end');
    // Releases by month and the blocked list carry the draft release (an unfinished release is blocked).
    await expect(page.locator('[data-month="2026-12"] [data-testid="month-total"]')).toHaveText('1');
    await expect(page.getByTestId('blocked-row').filter({ hasText: RELEASE_TITLE })).toBeVisible();
    // Task load: counts per department, no title.
    await expect(page.getByTestId('exec-tasks')).toContainText('Management');
    await expect(page.getByTestId('exec-tasks')).toContainText('1 overdue');
    await expect(page.getByTestId('exec-tasks')).not.toContainText('Clear the master');
    await expect(page.getByTestId('exec-money')).toBeVisible();
    await expect(page.getByTestId('exec-top')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
    // The layout can clip rather than scroll, so also hold every section inside the viewport.
    const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-testid^="exec-"]')].map((el) => el.getBoundingClientRect().right)));
    expect(right, 'every section ends inside the viewport').toBeLessThanOrEqual(vp.width);
    await page.screenshot({ path: `${shots}/exec-${vp.name}.png`, fullPage: true });
    await ctx.close();
  });
}

test('2 · people without exec.read get a 404 page and a refused route', async ({ browser, baseURL, request }) => {
  for (const who of [marketing, rosterArtist]) {
    const ctx = await as(browser, baseURL!, who.id, who.email);
    const page = await ctx.newPage();
    const res = await page.goto(`/o/${SLUG}/exec`);
    expect(res?.status(), who.email).toBe(404);
    const api = await ctx.request.get(`/api/org/${ORG}/exec`);
    expect(api.status(), who.email).toBe(404);
    const csv = await ctx.request.get(`/api/org/${ORG}/exec?format=csv`);
    expect(csv.status(), who.email).toBe(404);
    await ctx.close();
  }
  expect(await exportEvents(request)).toEqual([]);
});

test('3 · the CSV is formula-guarded and audited in the database', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, exec.id, exec.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/exec`);
  await expect(page.getByTestId('exec-dashboard')).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exec-export').click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${SLUG}-executive-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('"section","name","detail","count","amount_minor","currency"');
  expect(csv).toContain(`"'${RELEASE_TITLE}"`);
  expect(csv).not.toContain('Clear the master');
  const events = await exportEvents(request);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ audit: true, visibility: 'internal', actor_id: exec.id });
  expect(JSON.stringify(events[0].payload)).not.toContain(RELEASE_TITLE);
  await ctx.close();
});

test('4 · the owner reads it too', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/o/${SLUG}/exec`);
  await expect(page.getByTestId('exec-dashboard')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-stage="inbox"] [data-testid="pipeline-count"]')).toHaveText('2');
  await ctx.close();
});
