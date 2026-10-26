/**
 * Song stage machine (LABEL-24) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * What mocks cannot prove: the compare-and-set write and the
 * `song.stage_changed` row land in real tables, the Dropdown on the real song
 * page offers only the allowed moves and moves the song, a scoped member's
 * 404 holds on the real route, and a roster artist can do inbox → in_review
 * and nothing else.
 *
 * The producer owns a label with artists Nova and Kilo. Nova has the songs
 * "Midnight" and "Dawn" (both inbox); Kilo has "Kilo Only". The seed BUYER is
 * an A&R member limited to Nova, later made Nova's roster artist (role
 * `artist`).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `stages-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();
const SONG = randomUUID();
const DAWN = randomUUID();
const KILO_SONG = randomUUID();
const BEAT = randomUUID();

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

const track = (id: string, title: string, stage: string | null, type = 'song') => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type, song_stage: stage, audio_url: `/uploads/labelos-e2e-${id}.mp3`,
});

const stage = (id: string) => `${ORG}/tracks/${id}/stage`;
const stageOf = async (request: APIRequestContext, id: string) => ((await rest(request, 'GET', `tracks?id=eq.${id}&select=song_stage`)) as { song_stage: string | null }[])[0].song_stage;

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Stage Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
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
    track(SONG, 'Midnight', 'inbox'),
    track(DAWN, 'Dawn', 'inbox'),
    track(KILO_SONG, 'Kilo Only', 'inbox'),
    track(BEAT, 'A beat', null, 'beat'),
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: SONG, position: 0 },
    { project_id: NOVA_INBOX, track_id: DAWN, position: 1 },
    { project_id: NOVA_INBOX, track_id: BEAT, position: 2 },
    { project_id: KILO_INBOX, track_id: KILO_SONG, position: 0 },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

test('1 · the owner moves a song along the legal transitions', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const api = ctx.request;
  for (const [from, to] of [['inbox', 'in_review'], ['in_review', 'shortlisted'], ['shortlisted', 'in_development'], ['in_development', 'selected']]) {
    const res = await api.post(`/api/org/${stage(SONG)}`, { data: { to, from } });
    expect(res.status(), `${from} → ${to}`).toBe(200);
    expect(await res.json()).toMatchObject({ from, to, song: { id: SONG, stage: to } });
    expect(await stageOf(request, SONG)).toBe(to);
  }
  // selected leaves only by archiving, and an archived song can be reopened.
  expect((await api.post(`/api/org/${stage(SONG)}`, { data: { to: 'archived' } })).status()).toBe(200);
  expect((await api.post(`/api/org/${stage(SONG)}`, { data: { to: 'in_review' } })).status()).toBe(200);
  await ctx.close();
});

test('2 · an illegal transition is 409 naming both stages, and nothing changes', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const res = await ctx.request.post(`/api/org/${stage(DAWN)}`, { data: { to: 'selected' } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe('A song cannot move from Inbox to Selected');
  expect(await stageOf(request, DAWN)).toBe('inbox');
  // `released` is derived, not a stage; a beat has no stage to move.
  expect((await ctx.request.post(`/api/org/${stage(DAWN)}`, { data: { to: 'released' } })).status()).toBe(400);
  expect((await ctx.request.post(`/api/org/${stage(BEAT)}`, { data: { to: 'in_review' } })).status()).toBe(404);
  // A stale screen (it saw Inbox) loses to whoever moved the song first.
  expect((await ctx.request.post(`/api/org/${stage(DAWN)}`, { data: { to: 'in_review', from: 'inbox' } })).status()).toBe(200);
  expect((await ctx.request.post(`/api/org/${stage(DAWN)}`, { data: { to: 'passed', from: 'inbox' } })).status()).toBe(409);
  expect(await stageOf(request, DAWN)).toBe('in_review');
  await ctx.close();
});

test('3 · the stage Dropdown on the song page offers the allowed moves only, and moves the song', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${SONG}`);
  await expect(page.getByTestId('org-song')).toBeVisible({ timeout: 30_000 });
  const control = page.getByTestId('org-song-stage');
  await expect(control).toContainText('In review');
  await control.getByRole('button').click();
  await expect(page.getByRole('option')).toHaveText(['Shortlisted', 'Passed', 'On hold', 'Archived']);
  await page.getByRole('option', { name: 'On hold' }).click();
  await expect(control).toContainText('On hold', { timeout: 15_000 });
  expect(await stageOf(request, SONG)).toBe('on_hold');
  // It is also on the artist's Songs tab.
  await page.goto(`/o/${SLUG}/artists/${NOVA}?tab=songs`);
  await expect(page.getByTestId(`ows-song-stage-${SONG}`)).toContainText('On hold', { timeout: 30_000 });
  await ctx.close();
});

test('4 · a member scoped to Nova moves Nova\'s songs and gets 404 for Kilo\'s', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  expect((await ctx.request.post(`/api/org/${stage(KILO_SONG)}`, { data: { to: 'in_review' } })).status()).toBe(404);
  expect(await stageOf(request, KILO_SONG)).toBe('inbox');
  expect((await ctx.request.post(`/api/org/${stage(SONG)}`, { data: { to: 'in_review' } })).status()).toBe(200);
  await ctx.close();
});

test('5 · a roster artist can do inbox → in_review on their own song and nothing else', async ({ browser, baseURL, request }) => {
  await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, { role: 'artist', functions: [], scope: 'artists' });
  await rest(request, 'PATCH', `tracks?id=eq.${SONG}`, { song_stage: 'inbox' });
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const api = ctx.request;

  expect((await api.post(`/api/org/${stage(SONG)}`, { data: { to: 'passed' } })).status()).toBe(409);
  expect((await api.post(`/api/org/${stage(KILO_SONG)}`, { data: { to: 'in_review' } })).status()).toBe(404);
  expect((await api.post(`/api/org/${stage(SONG)}`, { data: { to: 'in_review' } })).status()).toBe(200);
  expect((await api.post(`/api/org/${stage(SONG)}`, { data: { to: 'shortlisted' } })).status()).toBe(409);
  expect(await stageOf(request, SONG)).toBe('in_review');

  // With no move left, the song page shows the stage as a plain chip.
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${SONG}`);
  const control = page.getByTestId('org-song-stage');
  await expect(control).toHaveText('In review', { timeout: 30_000 });
  await expect(control.getByRole('button')).toHaveCount(0);
  await ctx.close();
});

test('6 · every move wrote song.stage_changed { from, to }, visible to the artist (D5)', async ({ request }) => {
  const rows = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.song.stage_changed&song_id=eq.${SONG}&select=actor_id,artist_id,project_id,visibility,payload,created_at&order=created_at`)) as {
    actor_id: string; artist_id: string; project_id: string; visibility: string; payload: { from: string; to: string };
  }[];
  expect(rows.map((r) => `${r.payload.from}>${r.payload.to}`)).toEqual([
    'inbox>in_review', 'in_review>shortlisted', 'shortlisted>in_development', 'in_development>selected', 'selected>archived', 'archived>in_review',
    'in_review>on_hold', // test 3, the Dropdown
    'on_hold>in_review', // test 4, the scoped A&R member
    'inbox>in_review', // test 5, the roster artist (their refused moves wrote nothing)
  ]);
  expect(rows.every((r) => r.visibility === 'artist' && r.artist_id === NOVA && r.project_id === NOVA_INBOX)).toBe(true);
  expect(rows[rows.length - 1].actor_id).toBe(BUYER_ID);
  // A refused move wrote nothing: Dawn's 409s left only its one successful move.
  const dawn = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.song.stage_changed&song_id=eq.${DAWN}&select=payload`)) as { payload: { to: string } }[];
  expect(dawn.map((r) => r.payload.to)).toEqual(['in_review']);
});
