/**
 * Song reviews + the A&R inbox (LABEL-25) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * What mocks cannot prove: two reviewers' rows coexist in the real table, the
 * song's artist reads them all (route AND straight from PostgREST with their
 * own JWT), another artist of the same label reads none of it by either path,
 * `song.reviewed` lands without the note text, and the keyboard flow works on
 * the real page at desktop and phone width.
 *
 * Cast: the producer owns the label (reviewer one); the seed BUYER is an A&R
 * member of the whole org (reviewer two); ARTIST_A is Nova's roster artist,
 * ARTIST_B Kilo's. Nova has the songs "Midnight" and "Dawn"; Kilo "Kilo Only",
 * all in their artists' Inbox projects.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `reviews-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();
const MIDNIGHT = randomUUID();
const DAWN = randomUUID();
const KILO_SONG = randomUUID();
const NOTE = `private opinion ${run}`;

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

/** A PostgREST read with the member's OWN token, the way their browser would: RLS decides. */
async function readAs(request: APIRequestContext, who: { id: string; email: string } | null, p: string) {
  const res = await request.fetch(`${REST}/${p}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${who ? userToken(who.id, who.email) : ANON_KEY}` },
  });
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>[];
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const buyer = { id: BUYER_ID, email: 'buyer@local.test' };
const artistA = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const artistB = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const track = (id: string, title: string, created: string) => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', song_stage: 'inbox', created_at: created, audio_url: `/uploads/labelos-e2e-${id}.mp3`,
});
const reviews = (song: string) => `${ORG}/tracks/${song}/reviews`;
const stageOf = async (request: APIRequestContext, id: string) => ((await rest(request, 'GET', `tracks?id=eq.${id}&select=song_stage`)) as { song_stage: string }[])[0].song_stage;
const myRow = async (request: APIRequestContext, song: string, user: string) =>
  ((await rest(request, 'GET', `song_reviews?track_id=eq.${song}&reviewer_id=eq.${user}&select=rating,verdict,note`)) as { rating: number | null; verdict: string | null; note: string | null }[])[0];

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Review Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
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
  await rest(request, 'POST', 'projects', [
    { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA },
    { id: KILO_INBOX, org_id: ORG, user_id: null, name: `Inbox · Kilo ${run}`, inbox_for_contact_id: KILO },
  ]);
  await rest(request, 'POST', 'tracks', [
    track(MIDNIGHT, 'Midnight', '2026-10-01T10:00:00Z'),
    track(DAWN, 'Dawn', '2026-10-01T11:00:00Z'),
    track(KILO_SONG, 'Kilo Only', '2026-10-01T12:00:00Z'),
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: MIDNIGHT, position: 0 },
    { project_id: NOVA_INBOX, track_id: DAWN, position: 1 },
    { project_id: KILO_INBOX, track_id: KILO_SONG, position: 0 },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · two reviewers\' ratings coexist, and each rewrites only their own', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const ar = await as(browser, baseURL!, buyer.id, buyer.email);
  expect((await owner.request.put(`/api/org/${reviews(MIDNIGHT)}`, { data: { rating: 2, verdict: 'pass' } })).status()).toBe(200);
  expect((await ar.request.put(`/api/org/${reviews(MIDNIGHT)}`, { data: { rating: 5, verdict: 'shortlist', note: NOTE } })).status()).toBe(200);
  const rows = (await rest(request, 'GET', `song_reviews?track_id=eq.${MIDNIGHT}&select=reviewer_id,rating,verdict`)) as { reviewer_id: string; rating: number }[];
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.reviewer_id === PRODUCER_ID)).toMatchObject({ rating: 2, verdict: 'pass' });
  expect(rows.find((r) => r.reviewer_id === BUYER_ID)).toMatchObject({ rating: 5, verdict: 'shortlist' });
  // A second save by the same reviewer rewrites their row in place; the other's is untouched.
  expect((await ar.request.put(`/api/org/${reviews(MIDNIGHT)}`, { data: { rating: 4 } })).status()).toBe(200);
  expect(await myRow(request, MIDNIGHT, BUYER_ID)).toEqual({ rating: 4, verdict: 'shortlist', note: NOTE });
  expect((await myRow(request, MIDNIGHT, PRODUCER_ID)).rating).toBe(2);
  expect(((await rest(request, 'GET', `song_reviews?track_id=eq.${MIDNIGHT}&select=reviewer_id`)) as unknown[]).length).toBe(2);
  // An empty review and a bad rating are refused.
  expect((await ar.request.put(`/api/org/${reviews(DAWN)}`, { data: { rating: null } })).status()).toBe(400);
  expect((await ar.request.put(`/api/org/${reviews(DAWN)}`, { data: { rating: 9 } })).status()).toBe(400);
  await owner.close();
  await ar.close();
});

test('2 · the song\'s artist sees every review; another artist of the same label sees none (route and database)', async ({ browser, baseURL, request }) => {
  const a = await as(browser, baseURL!, artistA.id, artistA.email);
  const b = await as(browser, baseURL!, artistB.id, artistB.email);

  // Route: Nova reads both reviews, notes included, and cannot add one.
  const res = await a.request.get(`/api/org/${reviews(MIDNIGHT)}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.reviews).toHaveLength(2);
  expect(body.reviews.map((r: { rating: number }) => r.rating).sort()).toEqual([2, 4]);
  expect(body.reviews.find((r: { note: string | null }) => r.note)?.note).toBe(NOTE);
  expect(body.canReview).toBe(false);
  expect((await a.request.put(`/api/org/${reviews(MIDNIGHT)}`, { data: { rating: 5 } })).status()).toBe(403);

  // Route: Kilo's artist gets 404 for Nova's song and a clean 200 for their own.
  const other = await b.request.get(`/api/org/${reviews(MIDNIGHT)}`);
  expect(other.status()).toBe(404);
  expect(await other.text()).not.toContain(NOTE);
  expect((await b.request.get(`/api/org/${reviews(KILO_SONG)}`)).status()).toBe(200);

  // Database, with each person's own JWT: RLS alone decides.
  expect(await readAs(request, artistA, `song_reviews?track_id=eq.${MIDNIGHT}&select=rating`)).toHaveLength(2);
  expect(await readAs(request, artistB, `song_reviews?select=rating`)).toHaveLength(0);
  expect(await readAs(request, artistB, `song_reviews?track_id=eq.${MIDNIGHT}&select=rating`)).toHaveLength(0);
  expect(await readAs(request, buyer, `song_reviews?select=rating`)).toHaveLength(2);
  expect(await readAs(request, null, `song_reviews?select=rating`)).toHaveLength(0);
  // Nobody writes through PostgREST: the artist's own token cannot add a row.
  const forged = await request.fetch(`${REST}/song_reviews`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(artistA.id, artistA.email)}`, 'content-type': 'application/json' },
    data: JSON.stringify({ org_id: ORG, track_id: MIDNIGHT, reviewer_id: ARTIST_A_ID, rating: 5 }),
  });
  expect(forged.ok()).toBe(false);
  expect(await rest(request, 'GET', `song_reviews?track_id=eq.${MIDNIGHT}&select=reviewer_id`)).toHaveLength(2);
  await a.close();
  await b.close();
});

test('3 · song.reviewed is an artist-visible summary and never carries the note', async ({ request }) => {
  const rows = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.song.reviewed&select=actor_id,artist_id,project_id,song_id,visibility,payload&order=created_at`)) as {
    actor_id: string; artist_id: string; project_id: string; song_id: string; visibility: string; payload: Record<string, unknown>;
  }[];
  expect(rows).toHaveLength(3); // the two first saves and the rewrite; refused ones wrote nothing
  expect(rows.every((r) => r.visibility === 'artist' && r.song_id === MIDNIGHT && r.artist_id === NOVA && r.project_id === NOVA_INBOX)).toBe(true);
  expect(rows[1].payload).toEqual({ rating: 5, verdict: 'shortlist', noted: true });
  expect(JSON.stringify(rows)).not.toContain(NOTE);
  // Nova reads the summary of her own song's reviews in her feed; Kilo's artist does not.
  expect((await readAs(request, artistA, `activity_events?verb=eq.song.reviewed&select=id`)).length).toBe(3);
  expect(await readAs(request, artistB, `activity_events?verb=eq.song.reviewed&select=id`)).toHaveLength(0);
});

for (const viewport of [{ name: 'desktop 1440', width: 1440, height: 900 }, { name: 'phone 390', width: 390, height: 844 }]) {
  test(`4 · the keyboard flow on the real page — ${viewport.name}`, async ({ browser, baseURL, request }) => {
    // Reset: a clean queue for the A&R member (Nova's two songs and Kilo's, all in Inbox, none reviewed by them).
    await rest(request, 'PATCH', `tracks?id=in.(${MIDNIGHT},${DAWN},${KILO_SONG})`, { song_stage: 'inbox' });
    await rest(request, 'DELETE', `song_reviews?reviewer_id=eq.${BUYER_ID}`);

    const ctx = await as(browser, baseURL!, buyer.id, buyer.email);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/o/${SLUG}/ar`);
    const list = page.getByTestId('ar-list');
    await expect(list).toBeVisible({ timeout: 30_000 });
    const current = () => page.locator('[aria-current="true"]').getAttribute('data-song-row');
    await expect(list.locator('[data-song-row]')).toHaveCount(3);
    await expect.poll(current).toBe(MIDNIGHT); // oldest first

    // J / K move.
    await page.keyboard.press('j');
    await expect.poll(current).toBe(DAWN);
    await page.keyboard.press('j');
    await expect.poll(current).toBe(KILO_SONG);
    await page.keyboard.press('k');
    await expect.poll(current).toBe(DAWN);

    // 1–5 rate the focused song, as me.
    await page.keyboard.press('4');
    await expect.poll(async () => (await myRow(request, DAWN, BUYER_ID))?.rating).toBe(4);
    await page.keyboard.press('2');
    await expect.poll(async () => (await myRow(request, DAWN, BUYER_ID))?.rating).toBe(2);

    // S is not a move from Inbox: nothing changes. R starts the review, then S shortlists and the row leaves.
    await page.keyboard.press('s');
    await page.waitForTimeout(500);
    expect(await stageOf(request, DAWN)).toBe('inbox');
    await page.keyboard.press('r');
    await expect.poll(() => stageOf(request, DAWN)).toBe('in_review');
    await page.keyboard.press('s');
    await expect.poll(() => stageOf(request, DAWN)).toBe('shortlisted');
    await expect(list.locator(`[data-song-row="${DAWN}"]`)).toHaveCount(0);
    await expect.poll(current).toBe(KILO_SONG); // the cursor moved on

    // H holds, P passes (from Inbox it is legal too).
    await page.keyboard.press('r');
    await expect.poll(() => stageOf(request, KILO_SONG)).toBe('in_review');
    await page.keyboard.press('h');
    await expect.poll(() => stageOf(request, KILO_SONG)).toBe('on_hold');
    await expect.poll(current).toBe(MIDNIGHT);
    await page.keyboard.press('p');
    await expect.poll(() => stageOf(request, MIDNIGHT)).toBe('passed');
    await expect(page.getByTestId('ar-empty')).toBeVisible({ timeout: 15_000 });

    // The moves wrote their events, and the reviews' rows are the one I made.
    expect((await myRow(request, DAWN, BUYER_ID)).rating).toBe(2);
    await ctx.close();
  });
}

test('5 · C opens a note that saves with Ctrl+Enter, and typing never fires a song key', async ({ browser, baseURL, request }) => {
  await rest(request, 'PATCH', `tracks?id=eq.${MIDNIGHT}`, { song_stage: 'inbox' });
  const ctx = await as(browser, baseURL!, buyer.id, buyer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/ar`);
  await expect(page.getByTestId('ar-list')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('c');
  const note = page.getByTestId('ar-note');
  await expect(note).toBeFocused();
  await note.fill('');
  await page.keyboard.type('jk spsp 123');
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => (await myRow(request, MIDNIGHT, BUYER_ID))?.note).toBe('jk spsp 123');
  expect(await stageOf(request, MIDNIGHT)).toBe('inbox'); // the typed s and p moved nothing
  await ctx.close();
});
