/**
 * Structured filters and saved views (LABEL-37) end to end against a REAL
 * database (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * What mocks cannot prove: the migration-161 table with its policy that says
 * no, a shared view recomputed for each viewer through the real org-access,
 * scope and D4, and the Music page drawing exactly the viewer's rows.
 *
 * Cast: the producer owns the label. ARTIST_A is a_and_r (whole org).
 * ARTIST_B is a_and_r scoped to Kilo only. Nova has two songs (one without a
 * cover), Kilo one (without a cover).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, ANON_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `views-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();
const NOVA_BARE = randomUUID();
const NOVA_COVERED = randomUUID();
const KILO_BARE = randomUUID();

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

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const aAndR = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const scoped = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const api = `/api/org/${ORG}`;
const ids: Record<string, string> = {};
const song = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', song_stage: 'in_review', cover_url: null, audio_url: `/uploads/labelos-e2e-${id}.mp3`, ...over,
});
const sorted = (xs: string[]) => [...xs].sort();

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Views Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_B_ID, contact_id: KILO });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA },
    { id: KILO_INBOX, org_id: ORG, user_id: null, name: `Inbox · Kilo ${run}`, inbox_for_contact_id: KILO },
  ]);
  await rest(request, 'POST', 'tracks', [
    song(NOVA_BARE, 'Nova Bare'),
    song(NOVA_COVERED, 'Nova Covered', { cover_url: 'https://cdn.example.test/c.jpg' }),
    song(KILO_BARE, 'Kilo Bare'),
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: NOVA_BARE, position: 0 },
    { project_id: NOVA_INBOX, track_id: NOVA_COVERED, position: 1 },
    { project_id: KILO_INBOX, track_id: KILO_BARE, position: 0 },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · the owner shares a "missing artwork" view and one that names Nova', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const missing = await ctx.request.post(`${api}/views`, {
    data: { subject: 'songs', name: `Missing artwork ${run}`, shared: true, definition: { v: 1, subject: 'songs', filter: { missing: ['artwork'] } } },
  });
  expect(missing.status(), await missing.text()).toBe(201);
  ids.missing = (await missing.json()).view.id;
  const nova = await ctx.request.post(`${api}/views`, {
    data: { subject: 'songs', name: `Nova work ${run}`, shared: true, definition: { v: 1, subject: 'songs', filter: { artistIds: [NOVA] } } },
  });
  expect(nova.status(), await nova.text()).toBe(201);
  ids.nova = (await nova.json()).view.id;

  const owner = await (await ctx.request.get(`${api}/views/run?view=${ids.missing}`)).json();
  expect(sorted(owner.result.rows.map((r: { id: string }) => r.id))).toEqual(sorted([NOVA_BARE, KILO_BARE]));
  await ctx.close();
});

test('2 · the same view, run by a member limited to Kilo, shows only Kilo’s songs — and nothing about the rest', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, scoped.id, scoped.email);
  const res = await ctx.request.get(`${api}/views/run?view=${ids.missing}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.result.rows.map((r: { id: string }) => r.id)).toEqual([KILO_BARE]);
  expect(body.result.total).toBe(1);
  expect(JSON.stringify(body)).not.toMatch(new RegExp(`${NOVA_BARE}|${NOVA_COVERED}|${NOVA}|Nova`));

  // The whole-org A&R sees what the owner sees.
  const wide = await as(browser, baseURL!, aAndR.id, aAndR.email);
  const all = await (await wide.request.get(`${api}/views/run?view=${ids.missing}`)).json();
  expect(sorted(all.result.rows.map((r: { id: string }) => r.id))).toEqual(sorted([NOVA_BARE, KILO_BARE]));
  await wide.close();
  await ctx.close();
});

test('3 · a shared view that names Nova does not exist for the Kilo-scoped member', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, scoped.id, scoped.email);
  const list = await (await ctx.request.get(`${api}/views?subject=songs`)).json();
  expect(list.views.map((v: { id: string }) => v.id)).toEqual([ids.missing]);
  expect(JSON.stringify(list)).not.toMatch(new RegExp(`Nova|${NOVA}`));
  expect((await ctx.request.get(`${api}/views/run?view=${ids.nova}`)).status()).toBe(404);
  // Naming her in an ad-hoc filter gets them nothing of hers, and the definition echoed back has her dropped.
  const f = Buffer.from(JSON.stringify({ v: 1, subject: 'songs', filter: { artistIds: [NOVA] } })).toString('base64url');
  const adhoc = await (await ctx.request.get(`${api}/views/run?f=${f}`)).json();
  expect(adhoc.result.rows).toEqual([]);
  expect(JSON.stringify(adhoc.definition)).not.toContain(NOVA);
  expect(adhoc.narrowed).toBe(true);
  await ctx.close();
});

test('4 · the table is closed to the API roles: a member’s own JWT reads and writes nothing', async ({ request }) => {
  const token = userToken(scoped.id, scoped.email);
  const headers = { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const read = await request.fetch(`${REST}/org_saved_views?select=id,definition`, { headers });
  // Privileges revoked: PostgREST answers 401/403 (permission denied), never rows.
  expect([401, 403]).toContain(read.status());
  expect(await read.text()).not.toContain(NOVA);
  const write = await request.fetch(`${REST}/org_saved_views`, {
    method: 'POST',
    headers,
    data: JSON.stringify({ org_id: ORG, created_by: scoped.id, subject: 'songs', name: 'forged', definition: { v: 1, subject: 'songs', filter: {} }, shared: true }),
  });
  expect([401, 403]).toContain(write.status());
  const rows = (await rest(request, 'GET', `org_saved_views?org_id=eq.${ORG}&select=name`)) as { name: string }[];
  expect(rows.map((r) => r.name).sort()).toEqual([`Missing artwork ${run}`, `Nova work ${run}`].sort());
});

test('5 · the Music page draws the viewer’s rows from the saved view, with chips', async ({ browser, baseURL }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const ownerPage = await owner.newPage();
  await ownerPage.goto(`/o/${SLUG}/music?view=${ids.missing}`);
  await expect(ownerPage.getByTestId(`music-row-${NOVA_BARE}`)).toBeVisible();
  await expect(ownerPage.getByTestId(`music-row-${KILO_BARE}`)).toBeVisible();
  await expect(ownerPage.getByTestId(`music-row-${NOVA_COVERED}`)).toHaveCount(0);
  await expect(ownerPage.getByTestId('filter-chip')).toHaveText(['Missing artwork']);

  // Removing the chip drops the view and shows every song.
  await ownerPage.getByLabel('Remove filter Missing artwork').click();
  await expect(ownerPage.getByTestId(`music-row-${NOVA_COVERED}`)).toBeVisible();
  await owner.close();

  const member = await as(browser, baseURL!, scoped.id, scoped.email);
  const page = await member.newPage();
  await page.goto(`/o/${SLUG}/music?view=${ids.missing}`);
  await expect(page.getByTestId(`music-row-${KILO_BARE}`)).toBeVisible();
  await expect(page.getByTestId(`music-row-${NOVA_BARE}`)).toHaveCount(0);
  await expect(page.getByTestId('music-count')).toHaveText(/1 song/);
  await expect(page.locator('body')).not.toContainText('Nova');
  await member.close();
});

test('6 · taking the view down and deleting it', async ({ browser, baseURL, request }) => {
  // The A&R (not the author, not an admin) cannot change or delete the owner's shared view.
  const wide = await as(browser, baseURL!, aAndR.id, aAndR.email);
  expect((await wide.request.patch(`${api}/views/${ids.missing}`, { data: { name: 'mine now' } })).status()).toBe(403);
  expect((await wide.request.delete(`${api}/views/${ids.missing}`)).status()).toBe(403);
  await wide.close();

  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const del = await owner.request.delete(`${api}/views/${ids.nova}`);
  expect(del.status(), await del.text()).toBe(200);
  const left = (await rest(request, 'GET', `org_saved_views?org_id=eq.${ORG}&select=id`)) as { id: string }[];
  expect(left.map((r) => r.id)).toEqual([ids.missing]);

  // Every mutation left a view.* event that carries neither a name nor a filter.
  const events = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=like.view.*&select=verb,visibility,payload,artist_id`)) as { verb: string; visibility: string; payload: Record<string, unknown>; artist_id: string | null }[];
  expect(events.map((e) => e.verb).sort()).toEqual(['view.created', 'view.created', 'view.deleted']);
  for (const e of events) {
    expect(e.visibility).toBe('internal');
    expect(e.artist_id).toBeNull();
    expect(JSON.stringify(e.payload)).not.toMatch(/Nova|Missing|artistIds|missing/);
  }
  await owner.close();
});
