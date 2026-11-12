/**
 * Creative direction (LABEL-26) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * What mocks cannot prove: migration 152's rows are accepted by the real
 * tables (CHECK shape, integrity trigger, FKs), and — the point of the task —
 * an INTERNAL reference is invisible to a roster artist through the route,
 * straight from PostgREST with her own JWT (RLS), and on the page she opens.
 *
 * Cast: the producer owns the label; the seed BUYER is an A&R member of the
 * whole org; ARTIST_A is Nova's roster artist, ARTIST_B is Kilo's. Nova has
 * the song "Midnight" (selected) and an artwork file in her Inbox.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `direction-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const MIDNIGHT = randomUUID();
const MOODBOARD = randomUUID();
const CONTRACT = randomUUID();
const OPEN_TITLE = `Late night drives ${run}`;
const SECRET_TITLE = `Candid A&R read ${run}`;

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

/** A PostgREST read with the person's OWN token, the way their browser would: RLS decides. */
async function readAs(request: APIRequestContext, who: { id: string; email: string }, p: string) {
  const res = await request.fetch(`${REST}/${p}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}` } });
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>[];
}
async function writeAs(request: APIRequestContext, who: { id: string; email: string }, method: string, p: string, body: unknown) {
  return request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: JSON.stringify(body),
  });
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const buyer = { id: BUYER_ID, email: 'buyer@local.test' };
const artistA = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const artistB = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

function removeLocalUpload(url: unknown) {
  if (typeof url !== 'string' || !/^\/uploads\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(url)) return;
  fs.rmSync(path.join(process.cwd(), 'public', url), { force: true });
}

const refsOf = async (request: APIRequestContext) =>
  (await rest(request, 'GET', `artist_references?org_id=eq.${ORG}&contact_id=eq.${NOVA}&select=id,kind,title,visibility,track_id,asset_id&order=position`)) as { id: string; kind: string; title: string; visibility: string; track_id: string | null; asset_id: string | null }[];

let internalId = '';

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Direction Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', [
    { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA },
    { org_id: ORG, user_id: ARTIST_B_ID, contact_id: KILO },
  ]);
  await rest(request, 'POST', 'projects', { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', { id: MIDNIGHT, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Midnight', type: 'song', song_stage: 'selected', audio_url: `/uploads/labelos-e2e-${MIDNIGHT}.mp3` });
  await rest(request, 'POST', 'project_tracks', { project_id: NOVA_INBOX, track_id: MIDNIGHT, position: 0 });
  await rest(request, 'POST', 'project_assets', [
    { id: MOODBOARD, org_id: ORG, project_id: NOVA_INBOX, kind: 'artwork', sensitivity: 'normal', label: `Mood board ${run}`, file_name: 'mood.png', url: 'local://project-assets/none', mime: 'image/png', size_bytes: 10, created_by: PRODUCER_ID },
    { id: CONTRACT, org_id: ORG, project_id: NOVA_INBOX, kind: 'contract', sensitivity: 'restricted', label: `Deal ${run}`, file_name: 'deal.pdf', url: 'local://project-assets/none2', mime: 'application/pdf', size_bytes: 10, created_by: PRODUCER_ID },
  ]);
});

test.afterAll(async ({ request }) => {
  const rows = (await rest(request, 'GET', `tracks?select=audio_url&org_id=eq.${ORG}`)) as { audio_url: string | null }[];
  for (const r of rows) removeLocalUpload(r.audio_url);
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · the A&R writes the direction and adds every kind of reference; the real tables accept them', async ({ browser, baseURL, request }) => {
  const ar = await as(browser, baseURL!, buyer.id, buyer.email);
  const put = await ar.request.put(`/api/org/${ORG}/artists/${NOVA}/direction`, { data: { direction: { sound: 'Dusty drums, close vocals', avoid: 'Trap hi-hats', keywords: ['Soul', 'Dusty'] } } });
  expect(put.status(), await put.text()).toBe(200);
  const row = (await rest(request, 'GET', `artist_direction?contact_id=eq.${NOVA}&select=org_id,direction,updated_by`)) as { org_id: string; direction: Record<string, unknown>; updated_by: string }[];
  expect(row).toEqual([{ org_id: ORG, direction: { sound: 'Dusty drums, close vocals', avoid: 'Trap hi-hats', keywords: ['Soul', 'Dusty'] }, updated_by: BUYER_ID }]);

  const add = (data: unknown) => ar.request.post(`/api/org/${ORG}/artists/${NOVA}/references`, { data });
  expect((await add({ kind: 'note', title: OPEN_TITLE, note: 'Warm, close, unhurried' })).status()).toBe(201);
  const internal = await add({ kind: 'note', title: SECRET_TITLE, note: 'Honestly the second single is the weak one', visibility: 'internal' });
  expect(internal.status(), await internal.text()).toBe(201);
  internalId = (await internal.json()).reference.id;
  expect((await add({ kind: 'link', title: 'Playlist', url: 'https://open.spotify.com/playlist/abc' })).status()).toBe(201);
  expect((await add({ kind: 'track', track_id: MIDNIGHT })).status()).toBe(201);
  expect((await add({ kind: 'file', asset_id: MOODBOARD })).status()).toBe(201);
  // What a reference may not point at.
  expect((await add({ kind: 'file', asset_id: CONTRACT })).status()).toBe(404);
  expect((await add({ kind: 'link', title: 'x', url: 'http://insecure.example.com' })).status()).toBe(400);
  expect((await add({ kind: 'track', track_id: randomUUID() })).status()).toBe(404);

  const rows = await refsOf(request);
  expect(rows.map((r) => r.kind)).toEqual(['note', 'note', 'link', 'track', 'file']);
  expect(rows.find((r) => r.id === internalId)).toMatchObject({ visibility: 'internal' });
  // The picker offers the artwork and never the contract.
  const files = await (await ar.request.get(`/api/org/${ORG}/artists/${NOVA}/references/choices?kind=file`)).json();
  expect(files.files.map((f: { id: string }) => f.id)).toEqual([MOODBOARD]);
  // Every mutation left an event; the internal one is internal.
  const events = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=in.(direction.updated,reference.added)&select=verb,visibility`)) as { verb: string; visibility: string }[];
  expect(events.filter((e) => e.verb === 'reference.added')).toHaveLength(5);
  expect(events.filter((e) => e.visibility === 'internal')).toHaveLength(1);
  await ar.close();
});

test('2 · THE RULE: the roster artist cannot read the internal reference — route, PostgREST with her own JWT, and everything she writes', async ({ browser, baseURL, request }) => {
  const a = await as(browser, baseURL!, artistA.id, artistA.email);
  const res = await a.request.get(`/api/org/${ORG}/artists/${NOVA}/direction`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const text = JSON.stringify(body);
  expect(text).not.toContain(SECRET_TITLE);
  expect(text).not.toContain('second single');
  expect(body.references.map((r: { title: string }) => r.title)).toEqual([OPEN_TITLE, 'Playlist', 'Midnight', `Mood board ${run}`]);
  expect(body.permissions.internal).toBe(false);
  expect(body.restrictedReferences).toBe(0);

  // RLS: her own JWT straight against PostgREST.
  const mine = await readAs(request, artistA, `artist_references?org_id=eq.${ORG}&select=id,title,visibility`);
  expect(mine.map((r) => r.visibility)).not.toContain('internal');
  expect(mine).toHaveLength(4);
  expect((await readAs(request, artistA, `artist_references?id=eq.${internalId}&select=id`))).toEqual([]);
  expect((await readAs(request, artistA, `artist_direction?contact_id=eq.${NOVA}&select=contact_id`)).length).toBe(1);
  // The A&R reads all five through the same door.
  expect((await readAs(request, buyer, `artist_references?org_id=eq.${ORG}&select=id`)).length).toBe(5);
  // Another roster artist reads none of Nova's; neither direction nor references.
  expect((await readAs(request, artistB, `artist_references?org_id=eq.${ORG}&select=id`))).toEqual([]);
  expect((await readAs(request, artistB, `artist_direction?org_id=eq.${ORG}&select=contact_id`))).toEqual([]);

  // Writes: not through PostgREST, and through the route she can neither touch nor mint an internal one.
  await writeAs(request, artistA, 'PATCH', `artist_references?id=eq.${internalId}`, { visibility: 'artist' }); // refused or a no-op; the row below proves it
  expect((await refsOf(request)).find((r) => r.id === internalId)).toMatchObject({ visibility: 'internal' });
  expect((await writeAs(request, artistA, 'POST', 'artist_references', { org_id: ORG, contact_id: NOVA, kind: 'note', title: 'forged', note: 'x' })).ok()).toBe(false);
  expect((await a.request.patch(`/api/org/${ORG}/artists/${NOVA}/references/${internalId}`, { data: { title: 'seen' } })).status()).toBe(404);
  expect((await a.request.delete(`/api/org/${ORG}/artists/${NOVA}/references/${internalId}`)).status()).toBe(404);
  expect((await a.request.post(`/api/org/${ORG}/artists/${NOVA}/references`, { data: { kind: 'note', title: 'x', note: 'y', visibility: 'internal' } })).status()).toBe(403);
  expect((await a.request.patch(`/api/org/${ORG}/artists/${NOVA}/references/${(await refsOf(request))[0].id}`, { data: { visibility: 'internal' } })).status()).toBe(403);
  // And Kilo's artist cannot open Nova's direction at all.
  const b = await as(browser, baseURL!, artistB.id, artistB.email);
  expect((await b.request.get(`/api/org/${ORG}/artists/${NOVA}/direction`)).status()).toBe(404);
  expect((await refsOf(request))).toHaveLength(5);
  await a.close();
  await b.close();
});

test('3 · the pages: the A&R edits in place and sees "Team only"; the artist\'s page never contains the internal reference', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, buyer.id, buyer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/artists/${NOVA}?tab=direction`);
  const tab = page.getByTestId('artist-direction');
  await expect(tab).toBeVisible();
  await expect(tab.getByTestId('dir-sound')).toHaveValue('Dusty drums, close vocals');
  await expect(tab).toContainText(SECRET_TITLE);
  await expect(tab.getByTestId('direction-ref-internal')).toHaveCount(1);

  // A field saves when it is left.
  await tab.getByTestId('dir-lyrics').fill('Leaving, and coming back');
  await tab.getByTestId('dir-lyrics').blur();
  await expect.poll(async () => ((await rest(request, 'GET', `artist_direction?contact_id=eq.${NOVA}&select=direction`)) as { direction: { lyrics?: string } }[])[0].direction.lyrics).toBe('Leaving, and coming back');

  // A reference is added without a modal; the team-only box is offered.
  await tab.getByTestId('direction-add-open').click();
  await tab.getByTestId('direction-add-url').fill('https://www.youtube.com/watch?v=abc');
  await tab.getByTestId('direction-add-title').fill(`Video ${run}`);
  await tab.getByTestId('direction-add-submit').click();
  await expect(tab).toContainText(`Video ${run}`);
  expect((await refsOf(request)).map((r) => r.title)).toContain(`Video ${run}`);

  // Phone width: still usable.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(tab.getByTestId('dir-sound')).toBeVisible();
  await ctx.close();

  // The artist's own page.
  const actx = await as(browser, baseURL!, artistA.id, artistA.email);
  const apage = await actx.newPage();
  const loaded = await apage.goto(`/o/${SLUG}/artists/${NOVA}?tab=direction`);
  expect(loaded!.status()).toBe(200);
  const atab = apage.getByTestId('artist-direction');
  await expect(atab).toContainText(OPEN_TITLE);
  await expect(atab.getByTestId('direction-add-open')).toBeVisible();
  await expect(atab.getByLabel('Add a keyword')).toBeVisible();
  const html = await apage.content();
  expect(html).not.toContain(SECRET_TITLE);
  expect(html).not.toContain('second single');
  await expect(atab.getByTestId('direction-ref-internal')).toHaveCount(0);
  await atab.getByTestId('direction-add-open').click();
  await expect(atab.getByTestId('direction-add-internal')).toHaveCount(0);
  await actx.close();

  // Kilo's artist cannot open Nova's workspace.
  const bctx = await as(browser, baseURL!, artistB.id, artistB.email);
  const bpage = await bctx.newPage();
  expect((await bpage.goto(`/o/${SLUG}/artists/${NOVA}?tab=direction`))!.status()).toBe(404);
  await bctx.close();
});
