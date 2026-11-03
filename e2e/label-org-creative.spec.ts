/**
 * The artistic direction workspace and the optional creative approval gate (LABEL-68) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true). What mocks cannot prove: migration 194's check
 * and functions accept a creative approval, the owner's switch is audited in the database, the workspace reads what the
 * earlier tasks stored, and delivery really waits for the creative approval once it is on.
 *
 * Nothing the feature adds is seeded with the service key: the OWNER switches the gate on in the settings screen, the
 * release page's Creative row is asked and answered on the page, and delivery is attempted from the page. The service key
 * seeds the cast (org, members, an artist, songs, a draft release with one track) and reads stored rows back.
 *
 * Cast: the producer owns the label; ARTIST_A is the artistic director (function `artistic_director`); the seed BUYER is
 * marketing (no creative.read); ARTIST_B is a roster artist scoped to Nova (can never hold creative.*).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `creative-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const SONG_IN = randomUUID();
const SONG_SEL = randomUUID();
const SONG_SEL2 = randomUUID();
const RELEASE = randomUUID();

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

const shots = 'e2e-artifacts/LABEL-68';
mkdirSync(shots, { recursive: true });

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const director = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const marketing = { id: BUYER_ID, email: 'buyer@local.test' };
const rosterArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const orgSettings = async (request: APIRequestContext) =>
  ((await rest(request, 'GET', `organizations?id=eq.${ORG}&select=settings`)) as { settings: Record<string, unknown> }[])[0].settings;
const gateEvents = async (request: APIRequestContext) =>
  (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.creative_gate.changed&select=audit,visibility,payload,actor_id&order=created_at`)) as { audit: boolean; visibility: string; payload: Record<string, unknown>; actor_id: string }[];

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Creative Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['artistic_director'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', [{ org_id: ORG, user_id: ARTIST_B_ID, contact_id: NOVA }]);
  await rest(request, 'POST', 'projects', { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', [
    { id: SONG_IN, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Midnight', type: 'song', song_stage: 'inbox', audio_url: `/uploads/labelos-e2e-${SONG_IN}.mp3` },
    { id: SONG_SEL, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Dusk', type: 'song', song_stage: 'selected', audio_url: `/uploads/labelos-e2e-${SONG_SEL}.mp3` },
    { id: SONG_SEL2, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Dawn', type: 'song', song_stage: 'selected', audio_url: `/uploads/labelos-e2e-${SONG_SEL2}.mp3` },
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: SONG_IN, position: 0 },
    { project_id: NOVA_INBOX, track_id: SONG_SEL, position: 1 },
    { project_id: NOVA_INBOX, track_id: SONG_SEL2, position: 2 },
  ]);
  await rest(request, 'POST', 'releases', { id: RELEASE, org_id: ORG, project_id: NOVA_INBOX, contact_id: NOVA, title: `Autumn ${run}`, created_by: PRODUCER_ID });
  await rest(request, 'POST', 'release_items', { release_id: RELEASE, org_id: ORG, position: 1, song_track_id: SONG_SEL, master_track_id: SONG_SEL });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · off by default: the workspace says creative approval is not required, and the release has no Creative gate', async ({ browser, baseURL, request }) => {
  expect((await orgSettings(request)).creative_gate).toBeUndefined();
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/creative`);
  await expect(page.getByRole('heading', { name: 'Artistic direction' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('creative-gate-off')).toContainText('not required');
  await expect(page.getByTestId('creative-stat-open')).toHaveCount(0);
  await expect(page.getByTestId(`creative-artist-${NOVA}`)).toBeVisible();
  await expect(page.getByTestId(`creative-artist-${KILO}`)).toBeVisible();
  await expect(page.getByTestId(`creative-songs-${NOVA}`)).toHaveText('3 songs');
  await expect(page.getByTestId(`creative-waiting-${NOVA}`)).toContainText('1 waiting for review');
  await page.screenshot({ path: `${shots}/workspace-gate-off-owner-1440.png`, fullPage: true });

  await page.goto(`/o/${SLUG}/releases/${RELEASE}`);
  await expect(page.getByTestId('release-gates')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('release-gate-creative')).toHaveCount(0);
  await expect(page.getByTestId('org-approval-creative')).toHaveCount(0);
  await ctx.close();
});

test('2 · the owner switches creative approval on in settings, and the database records it once', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/creative`);
  await page.getByRole('link', { name: /switch it on in settings/i }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/settings/organization`));
  const box = page.getByLabel(/require creative approval/i);
  await expect(box).toBeVisible({ timeout: 60_000 });
  await expect(box).not.toBeChecked();
  await box.click();
  await expect(box).toBeChecked({ timeout: 30_000 });
  await page.screenshot({ path: `${shots}/settings-creative-switch-owner-1440.png`, fullPage: true });

  expect((await orgSettings(request)).creative_gate).toBe('on');
  const events = await gateEvents(request);
  expect(events).toEqual([{ audit: true, visibility: 'internal', payload: { from: 'off', to: 'on' }, actor_id: PRODUCER_ID }]);
  // It survives a reload.
  await page.reload();
  await expect(page.getByLabel(/require creative approval/i)).toBeChecked({ timeout: 60_000 });
  await ctx.close();
});

test('3 · only the owner has the switch: the artistic director and a stranger are refused by the route', async ({ browser, baseURL, request }) => {
  const dir = await as(browser, baseURL!, director.id, director.email);
  expect((await dir.request.put(`/api/org/${ORG}/settings/creative-gate`, { data: { enabled: false } })).status()).toBe(403);
  const mkt = await as(browser, baseURL!, marketing.id, marketing.email);
  expect((await mkt.request.put(`/api/org/${ORG}/settings/creative-gate`, { data: { enabled: false } })).status()).toBe(403);
  expect((await orgSettings(request)).creative_gate).toBe('on');
  expect(await gateEvents(request)).toHaveLength(1);
  await dir.close();
  await mkt.close();
});

test('4 · the artistic director opens the workspace, writes a direction, and sees the release waiting for them', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, director.id, director.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/creative`);
  await expect(page.getByTestId('creative-gate-on')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('creative-stat-open-value')).toHaveText('1');
  await expect(page.getByTestId(`creative-nodirection-${NOVA}`)).toHaveText('No direction written yet.');
  await expect(page.getByTestId(`creative-release-status-${RELEASE}`)).toHaveText('Not asked yet');
  // The entry lives in the Artists hub of the top bar.
  await page.getByRole('button', { name: /^artists/i }).first().click();
  await expect(page.getByRole('link', { name: 'Artistic direction' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The direction is written where it is edited (the artist's Direction tab, LABEL-26), then read here.
  const put = await ctx.request.put(`/api/org/${ORG}/artists/${NOVA}/direction`, { data: { direction: { sound: 'Dusty drums, close vocals', next: 'The autumn EP', keywords: ['Soul', 'Dusty'] } } });
  expect(put.status(), await put.text()).toBe(200);
  await page.reload();
  const nova = page.getByTestId(`creative-artist-${NOVA}`);
  await expect(nova).toContainText('Dusty drums, close vocals');
  await expect(nova).toContainText('The autumn EP');
  await expect(nova).toContainText('Soul');
  await page.screenshot({ path: `${shots}/workspace-gate-on-director-1440.png`, fullPage: true });
  await page.getByTestId(`creative-open-direction-${NOVA}`).click();
  await expect(page).toHaveURL(new RegExp(`/artists/${NOVA}\\?tab=direction`));
  await ctx.close();
});

test('5 · the release page asks for the creative approval, the director gives it, and delivery waits for it', async ({ browser, baseURL, request }) => {
  const ownerCtx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ownerCtx.newPage();
  await page.goto(`/o/${SLUG}/releases/${RELEASE}`);
  await expect(page.getByTestId('release-gate-creative')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('release-gate-creative')).toHaveAttribute('data-status', 'not_started');

  // Ask the artistic director, on the page.
  const row = page.getByTestId('org-approval-creative');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTestId('org-approval-ask').click();
  await row.getByRole('button', { name: 'Who should approve' }).click();
  // Options are sorted by name, then id: the owner's id sorts after the director's seed id, so the director is the one to pick.
  await page.getByRole('option').first().click();
  await row.getByTestId('org-approval-send-request').click();
  await expect(row.getByTestId('org-approval-pending')).toBeVisible({ timeout: 30_000 });
  // The dropdown lists every holder of creative.approve (the owner and the director): whoever was picked, it must be the director for the next step.
  const asked = (await rest(request, 'GET', `approvals?release_id=eq.${RELEASE}&gate=eq.creative&decision=eq.requested&select=approver_id`)) as { approver_id: string }[];
  expect(asked).toEqual([{ approver_id: ARTIST_A_ID }]);
  await page.reload();
  await expect(page.getByTestId('release-gate-creative')).toHaveAttribute('data-status', 'awaiting_approval', { timeout: 60_000 });
  await page.screenshot({ path: `${shots}/release-creative-asked-owner-1440.png`, fullPage: true });

  // The director answers, on the page. A request addressed to them is what opens "Approve".
  const dirCtx = await as(browser, baseURL!, director.id, director.email);
  const dp = await dirCtx.newPage();
  await dp.goto(`/o/${SLUG}/releases/${RELEASE}`);
  const drow = dp.getByTestId('org-approval-creative');
  await expect(drow).toBeVisible({ timeout: 60_000 });
  const approve = drow.getByTestId('org-approval-approve');
  await expect(approve).toBeEnabled({ timeout: 30_000 });
  await approve.click();
  await expect(drow.getByTestId('org-approval-chip-creative')).toHaveText('Approved', { timeout: 30_000 });

  const rows = (await rest(request, 'GET', `approvals?release_id=eq.${RELEASE}&gate=eq.creative&select=decision,actor_id&order=created_at`)) as { decision: string; actor_id: string }[];
  expect(rows.map((r) => r.decision)).toEqual(['requested', 'approved']);
  expect(rows[1].actor_id).toBe(ARTIST_A_ID);

  // The workspace now shows it creatively approved, and the page's gate row agrees.
  await dp.goto(`/o/${SLUG}/creative`);
  await expect(dp.getByTestId(`creative-release-status-${RELEASE}`)).toHaveText('Creatively approved', { timeout: 60_000 });
  await expect(dp.getByTestId('creative-stat-open-value')).toHaveText('0');
  await dp.screenshot({ path: `${shots}/workspace-approved-director-1440.png`, fullPage: true });
  await page.reload();
  await expect(page.getByTestId('release-gate-creative')).toHaveAttribute('data-status', 'approved', { timeout: 60_000 });
  await dirCtx.close();
  await ownerCtx.close();
});

test('6 · changing the running order after the approval makes it stale in the workspace and on the release', async ({ browser, baseURL }) => {
  // A second track added through the release's own tracklist route (as the owner): what was approved no longer matches.
  const ownerCtx = await as(browser, baseURL!, owner.id, owner.email);
  const add = await ownerCtx.request.post(`/api/org/${ORG}/releases/${RELEASE}/items`, { data: { song_track_id: SONG_SEL2 } });
  expect(add.status(), await add.text()).toBe(201);
  await ownerCtx.close();
  const ctx = await as(browser, baseURL!, director.id, director.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/creative`);
  await expect(page.getByTestId(`creative-release-status-${RELEASE}`)).toHaveText('Changed since approved', { timeout: 60_000 });
  await expect(page.getByTestId('creative-stat-open-value')).toHaveText('1');
  await page.goto(`/o/${SLUG}/releases/${RELEASE}`);
  await expect(page.getByTestId('release-gate-creative')).toHaveAttribute('data-status', 'stale', { timeout: 60_000 });
  await ctx.close();
});

test('7 · who cannot open it: marketing and a roster artist get a real 404 and no nav entry; the route is 403', async ({ browser, baseURL }) => {
  for (const who of [marketing, rosterArtist]) {
    const ctx = await as(browser, baseURL!, who.id, who.email);
    const page = await ctx.newPage();
    const res = await page.goto(`/o/${SLUG}/creative`);
    expect(res?.status(), who.email).toBe(404);
    expect((await ctx.request.get(`/api/org/${ORG}/creative`)).status(), who.email).toBe(403);
    await ctx.close();
  }
  // And the nav entry is absent for a member who can open other pages of the org (marketing reads the catalogue).
  {
    const ctx = await as(browser, baseURL!, marketing.id, marketing.email);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}/artists`);
    await page.getByRole('button', { name: /^artists/i }).first().click();
    await expect(page.getByRole('link', { name: 'Music' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Artistic direction' })).toHaveCount(0);
    await ctx.close();
  }
});

test('8 · at phone width the workspace has no horizontal scroll', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const c = sessionCookie(director.id, director.email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/creative`);
  await expect(page.getByTestId('creative-workspace')).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${shots}/workspace-director-390.png`, fullPage: true });
  await ctx.close();
});

test('9 · the owner switches it off again: the Creative row and chips go, the rows are kept, and readiness is as before', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/organization`);
  const box = page.getByLabel(/require creative approval/i);
  await expect(box).toBeChecked({ timeout: 60_000 });
  await box.click();
  await expect(box).not.toBeChecked({ timeout: 30_000 });
  expect((await orgSettings(request)).creative_gate).toBe('off');
  await page.goto(`/o/${SLUG}/releases/${RELEASE}`);
  await expect(page.getByTestId('release-gates')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('release-gate-creative')).toHaveCount(0);
  const kept = (await rest(request, 'GET', `approvals?release_id=eq.${RELEASE}&gate=eq.creative&select=id`)) as unknown[];
  expect(kept).toHaveLength(2);
  const events = await gateEvents(request);
  expect(events.map((e) => e.payload)).toEqual([{ from: 'off', to: 'on' }, { from: 'on', to: 'off' }]);
  await ctx.close();
});
