/**
 * Org releases (LABEL-16) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true). What
 * mocks cannot prove: migration 144's triggers accept exactly the rows the
 * routes write (an ownerless release project and artist link, items whose
 * org comes from the release), the tracklist functions and the deferred
 * position check keep 1..n through PostgREST, the read policy agrees with
 * the routes, and the audio route's embedded release lookup turns a song on
 * a release into finished material for marketing.
 *
 * The producer owns a label with artist Nova and song "Midnight" (its master
 * and its demo linked from it); the seed BUYER is a marketing member
 * (catalogue read, finished audio, no release.write).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const NOVA = randomUUID();
const INBOX = randomUUID();
const SONG = randomUUID();
const MASTER = randomUUID();
const DEMO = randomUUID();

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

async function as(browser: import('@playwright/test').Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const releases = `/api/org/${ORG}/releases`;
const ids: Record<string, string> = {};

const song = (id: string, title: string, stage: string | null) => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', song_stage: stage, audio_url: `/uploads/labelos-e2e-${id}.mp3`,
});

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Release Records ${run}`, slug: `releases-${run}`, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', { id: INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', [song(SONG, 'Midnight', 'inbox'), song(MASTER, 'Midnight (master)', null), song(DEMO, 'Midnight (demo)', null)]);
  await rest(request, 'POST', 'project_tracks', [SONG, MASTER, DEMO].map((track_id, position) => ({ project_id: INBOX, track_id, position })));
  await rest(request, 'POST', 'track_links', [
    { from_track_id: SONG, to_track_id: MASTER, user_id: null, relation: 'master' },
    { from_track_id: SONG, to_track_id: DEMO, user_id: null, relation: 'demo' },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

test('1 · the owner creates a release: its own ownerless project, linked to the artist; a bad UPC names the field', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const bad = await ctx.request.post(releases, { data: { title: 'Midnight', contact_id: NOVA, upc: '036000291453' } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).issues[0].path).toBe('upc');

  const res = await ctx.request.post(releases, { data: { title: `Midnight ${run}`, type: 'single', contact_id: NOVA, upc: '0 36000 29145 2' } });
  expect(res.status(), await res.text()).toBe(201);
  const view = (await res.json()).release;
  expect(view).toMatchObject({ contactId: NOVA, upc: '036000291452', state: 'draft', type: 'single' });
  ids.release = view.id;
  ids.project = view.projectId;

  const [row] = (await rest(request, 'GET', `releases?select=org_id,created_by&id=eq.${view.id}`)) as Record<string, string>[];
  expect(row).toEqual({ org_id: ORG, created_by: PRODUCER_ID });
  const [project] = (await rest(request, 'GET', `projects?select=org_id,user_id,name&id=eq.${view.projectId}`)) as Record<string, string | null>[];
  expect(project).toEqual({ org_id: ORG, user_id: null, name: `Midnight ${run}` });
  const links = (await rest(request, 'GET', `project_contacts?select=contact_id,user_id&project_id=eq.${view.projectId}`)) as Record<string, string | null>[];
  expect(links).toEqual([{ contact_id: NOVA, user_id: null }]);
  await ctx.close();
});

test('2 · marketing reads releases but cannot write them; Postgres agrees', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const list = await ctx.request.get(releases);
  expect(list.status()).toBe(200);
  expect((await list.json()).releases.map((r: { id: string }) => r.id)).toEqual([ids.release]);
  expect((await ctx.request.post(releases, { data: { title: 'x', contact_id: NOVA } })).status()).toBe(403);
  expect((await ctx.request.patch(`${releases}/${ids.release}`, { data: { title: 'x' } })).status()).toBe(403);
  await ctx.close();

  const asMember = await request.get(`${REST}/releases?select=id&org_id=eq.${ORG}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
  });
  expect(await asMember.json()).toEqual([{ id: ids.release }]);
  const write = await request.post(`${REST}/releases`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(PRODUCER_ID, 'producer@local.test')}`, 'content-type': 'application/json' },
    data: JSON.stringify({ org_id: ORG, project_id: ids.project, contact_id: NOVA, title: 'direct' }),
  });
  expect(write.ok()).toBe(false);
});

test('3 · the tracklist: add, refuse a demo as master, reorder, remove — positions stay 1..n', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const items = `${releases}/${ids.release}/items`;
  const a = await ctx.request.post(items, { data: { song_track_id: SONG } });
  expect(a.status(), await a.text()).toBe(201);
  const b = await ctx.request.post(items, { data: { song_track_id: SONG, master_track_id: MASTER, version_title: 'Album Version' } });
  expect(b.status(), await b.text()).toBe(201);
  ids.a = (await a.json()).item.id;
  ids.b = (await b.json()).item.id;
  const demo = await ctx.request.post(items, { data: { song_track_id: SONG, master_track_id: DEMO } });
  expect(demo.status()).toBe(400);
  expect((await demo.json()).field).toBe('master_track_id');

  const reordered = await ctx.request.patch(items, { data: { order: [ids.b, ids.a] } });
  expect(reordered.status(), await reordered.text()).toBe(200);
  expect((await reordered.json()).items.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([[ids.b, 1], [ids.a, 2]]);

  const c = await ctx.request.post(items, { data: { song_track_id: SONG } });
  expect(c.status()).toBe(201);
  const removed = await ctx.request.delete(`${items}/${ids.a}`);
  expect(removed.status(), await removed.text()).toBe(200);
  const rows = (await rest(request, 'GET', `release_items?select=position,org_id&release_id=eq.${ids.release}&order=position`)) as { position: number; org_id: string }[];
  expect(rows).toEqual([{ position: 1, org_id: ORG }, { position: 2, org_id: ORG }]);
  await ctx.close();
});

test('4 · on a release, the song’s own mix is finished: marketing passes the audio check', async ({ browser, baseURL, request }) => {
  // Midnight is still `inbox`; only the release makes its mix finished (06 §2.3).
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  // `wav` of an mp3-only song has no file: past D4 the answer is 404, before it 403.
  const audio = `/api/org/${ORG}/audio/${SONG}?variant=wav`;
  // On the release: past D4 to the file lookup.
  expect((await ctx.request.get(audio)).status()).toBe(404);
  await rest(request, 'PATCH', `releases?id=eq.${ids.release}`, { state: 'cancelled' });
  expect((await ctx.request.get(audio)).status()).toBe(403);
  // The database's row rule moves with it: marketing reads the song row only while it is on a live release.
  const row = async () =>
    (await (await request.get(`${REST}/tracks?select=id&id=eq.${SONG}`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
    })).json()) as unknown[];
  expect(await row()).toEqual([]);
  await rest(request, 'PATCH', `releases?id=eq.${ids.release}`, { state: 'draft' });
  expect(await row()).toEqual([{ id: SONG }]);
  expect((await ctx.request.get(audio)).status()).toBe(404);
  await ctx.close();
});

test('5 · a delivered release keeps its tracklist; a draft is deleted with its items, its project stays', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  await rest(request, 'PATCH', `releases?id=eq.${ids.release}`, { state: 'delivered', delivered_at: new Date().toISOString() });
  expect((await ctx.request.post(`${releases}/${ids.release}/items`, { data: { song_track_id: SONG } })).status()).toBe(409);
  expect((await ctx.request.delete(`${releases}/${ids.release}`)).status()).toBe(409);
  await rest(request, 'PATCH', `releases?id=eq.${ids.release}`, { state: 'draft', delivered_at: null });
  const del = await ctx.request.delete(`${releases}/${ids.release}`);
  expect(del.status(), await del.text()).toBe(200);
  expect(await rest(request, 'GET', `release_items?select=id&release_id=eq.${ids.release}`)).toEqual([]);
  expect(await rest(request, 'GET', `projects?select=id&id=eq.${ids.project}`)).toEqual([{ id: ids.project }]);
  await ctx.close();
});
