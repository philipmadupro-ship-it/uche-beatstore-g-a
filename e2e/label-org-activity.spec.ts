/**
 * Activity feeds (LABEL-20) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true),
 * migration 147 included. What mocks cannot prove: the digest comes out of
 * real `activity_events` rows through the real scope walk, and the artist
 * scope holds in the database itself, not only in the route.
 *
 * The producer owns a label with artists Nova and Kilo. The seed BUYER is an
 * A&R member limited to Nova (creative record, no business-internal events).
 * Events: ten `song.created` by Ana (the BUYER) for Nova within ten minutes,
 * five for Kilo, a release made and renamed through the REAL routes, and an
 * invitation (an org-level, business-internal audit event).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `activity-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();

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

/** A read as a user, with their own JWT — what PostgREST does for a member, under RLS. */
async function readAs(request: APIRequestContext, id: string, email: string, path: string) {
  const res = await request.get(`${REST}/${path}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(id, email)}` } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function as(browser: Browser, baseURL: string, id: string, email: string, viewport?: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext(viewport ? { viewport } : undefined);
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

type FeedEvent = { id: string; verb: string; artistId: string | null; projectId: string | null; visibility: string };
type Feed = { events: FeedEvent[]; names: { artists: Record<string, string> }; restricted: number; asOf: string; hasMore: boolean; nextBefore: string | null };
const feedPath = (q = '') => `/api/org/${ORG}/activity${q}`;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const tied = minutesAgo(3);

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${PRODUCER_ID},${BUYER_ID})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Activity Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'user_profiles', { user_id: BUYER_ID, display_name: 'Ana' });
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: BUYER_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA },
    { id: KILO_INBOX, org_id: ORG, user_id: null, name: `Inbox · Kilo ${run}`, inbox_for_contact_id: KILO },
  ]);

  // Ten uploads for Nova by Ana inside ten minutes; five for Kilo by the owner.
  const song = (n: number, artist: string, project: string, actor: string, at: string) => ({
    org_id: ORG, actor_id: actor, verb: 'song.created', subject_type: 'track', artist_id: artist, project_id: project,
    payload: { title: `Demo ${n}`, song_stage: 'inbox' }, visibility: 'artist', created_at: at,
  });
  await rest(request, 'POST', 'activity_events', [
    ...Array.from({ length: 10 }, (_, i) => song(i, NOVA, NOVA_INBOX, BUYER_ID, minutesAgo(30 - i))),
    ...Array.from({ length: 5 }, (_, i) => song(100 + i, KILO, KILO_INBOX, PRODUCER_ID, minutesAgo(20 - i))),
    // A file in Kilo's project: project-only, filed under Kilo.
    { org_id: ORG, actor_id: PRODUCER_ID, verb: 'file.uploaded', subject_type: 'asset', artist_id: null, project_id: KILO_INBOX, payload: { kind: 'artwork', sensitivity: 'normal' }, visibility: 'artist', created_at: minutesAgo(10) },
    // Four organization-level events from one transaction: they share a created_at, so a page boundary can land inside the group.
    ...Array.from({ length: 4 }, () => ({ org_id: ORG, actor_id: PRODUCER_ID, verb: 'org.settings_changed', subject_type: 'org', artist_id: null, project_id: null, payload: {}, visibility: 'internal', created_at: tied })),
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${PRODUCER_ID},${BUYER_ID})`);
});

test('1 · real routes write events the feed then groups: a release made, renamed and an invitation sent', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const made = await ctx.request.post(`/api/org/${ORG}/releases`, { data: { title: `Midnight ${run}`, type: 'single', contact_id: NOVA } });
  expect(made.status(), await made.text()).toBe(201);
  const id = (await made.json()).release.id;
  expect((await ctx.request.patch(`/api/org/${ORG}/releases/${id}`, { data: { title: `Midnight (Deluxe) ${run}` } })).status()).toBe(200);
  const inv = await ctx.request.post(`/api/org/${ORG}/invitations`, { data: { email: `invitee-${run}@example.com`, role: 'member', functions: ['marketing'] } });
  expect(inv.status(), await inv.text()).toBe(201);

  const feed: Feed = await (await ctx.request.get(feedPath())).json();
  const verbs = feed.events.map((e) => e.verb);
  for (const v of ['song.created', 'file.uploaded', 'project.created', 'release.created', 'release.updated', 'invitation.created']) expect(verbs, v).toContain(v);
  expect(feed.names.artists).toEqual({ [NOVA]: `Nova ${run}`, [KILO]: `Kilo ${run}` });
  expect(JSON.stringify(feed)).not.toMatch(/invitee-|"payload"|token/);

  // Paging through the REAL PostgREST with the (created_at, id) cursor loses and repeats nothing,
  // across the four events that share one instant.
  const all: Feed = await (await ctx.request.get(feedPath('?limit=200'))).json();
  const paged: string[] = [];
  let before: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const page: Feed = await (await ctx.request.get(feedPath(`?limit=4${before ? `&before=${encodeURIComponent(before)}` : ''}`))).json();
    paged.push(...page.events.map((e) => e.id));
    if (!page.hasMore) break;
    before = page.nextBefore;
  }
  expect(paged.length).toBe(new Set(paged).size);
  expect(paged).toEqual(all.events.map((e) => e.id));
  expect(all.events.filter((e) => e.verb === 'org.settings_changed')).toHaveLength(4);
  await ctx.close();
});

test('2 · a member limited to Nova gets none of Kilo’s events and none of the internal ones — through the route', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const res = await ctx.request.get(feedPath());
  expect(res.status()).toBe(200);
  const feed: Feed = await res.json();
  expect(feed.events.length).toBeGreaterThan(10);
  expect(feed.events.every((e) => e.visibility === 'artist')).toBe(true);
  expect(feed.events.some((e) => e.artistId === KILO || e.projectId === KILO_INBOX)).toBe(false);
  expect(feed.events.map((e) => e.verb)).not.toContain('invitation.created');
  expect(JSON.stringify(feed)).not.toContain(`Kilo ${run}`);
  expect(feed.names.artists).toEqual({ [NOVA]: `Nova ${run}` });

  expect((await ctx.request.get(feedPath(`?artist=${KILO}`))).status()).toBe(404);
  expect((await ctx.request.get(feedPath(`?project=${KILO_INBOX}`))).status()).toBe(404);
  expect((await ctx.request.get(feedPath(`?artist=${NOVA}`))).status()).toBe(200);
  await ctx.close();
});

test('3 · … and through RLS: reading activity_events with the member’s own JWT shows only Nova’s artist-class events (migration 147)', async ({ request }) => {
  type Row = { verb: string; artist_id: string | null; project_id: string | null; visibility: string };
  const select = `activity_events?select=verb,artist_id,project_id,visibility&org_id=eq.${ORG}`;
  const mine = (await readAs(request, BUYER_ID, 'buyer@local.test', select)) as Row[];
  expect(mine.length).toBeGreaterThan(10);
  expect(mine.every((r) => r.visibility === 'artist')).toBe(true);
  expect(mine.filter((r) => r.artist_id === KILO || r.project_id === KILO_INBOX)).toEqual([]);
  // Organization-level events (no artist, no project) are not a scoped member's.
  expect(mine.filter((r) => r.artist_id === null && r.project_id === null)).toEqual([]);
  expect(mine.map((r) => r.verb)).toEqual(expect.arrayContaining(['song.created', 'release.created']));

  // The owner reads everything the org recorded, including Kilo's and the internal ones.
  const all = (await readAs(request, PRODUCER_ID, 'producer@local.test', select)) as Row[];
  expect(all.some((r) => r.artist_id === KILO)).toBe(true);
  expect(all.some((r) => r.project_id === KILO_INBOX && r.artist_id === null)).toBe(true);
  expect(all.map((r) => r.verb)).toContain('invitation.created');
  expect(all.length).toBeGreaterThan(mine.length);
});

test('4 · the owner’s Overview: ten uploads inside ten minutes are ONE line, and leaving marks the digest seen', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByTestId('overview-digest')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Since your last visit')).toBeVisible();

  const demos = page.getByTestId('digest-line').filter({ hasText: 'Ana added 10 demos' });
  await expect(demos).toHaveCount(1);
  await expect(page.getByTestId('digest-line').filter({ hasText: /Ana added 1 demo|Ana added a demo/ })).toHaveCount(0);
  await expect(page.getByTestId('digest-line').filter({ hasText: 'You added 5 demos' })).toHaveCount(1);
  // The sections name the artists; the org-level invitation sits under "Organization".
  await expect(page.getByTestId(`digest-artist-${NOVA}`)).toHaveText(`Nova ${run}`);
  await expect(page.getByTestId(`digest-artist-${KILO}`)).toHaveText(`Kilo ${run}`);
  await expect(page.getByTestId('digest-org')).toBeVisible();
  // The release made through the route is one line for the owner under Nova (project + release + rename).
  await expect(page.getByTestId('digest-line').filter({ hasText: /You created a project and created the release/ })).toHaveCount(1);

  const profile = () => rest(request, 'GET', `user_profiles?select=last_seen_overview_at&user_id=eq.${PRODUCER_ID}`) as Promise<{ last_seen_overview_at: string | null }[]>;
  expect((await profile())[0]?.last_seen_overview_at ?? null).toBeNull(); // opening it is not "seen"

  await page.goto(`/o/${SLUG}/artists/${NOVA}`); // leaving the Overview
  await expect.poll(async () => (await profile())[0]?.last_seen_overview_at ?? null, { timeout: 15_000 }).not.toBeNull();

  // Next visit: what was read is gone. (The mark trails the read by a 10 s margin, so an event written in
  // the last seconds before the first visit — the release made by test 1 — may show once more; the uploads
  // and Kilo's events, minutes old, may not.)
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByTestId('overview-digest')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('digest-line').filter({ hasText: 'added 10 demos' })).toHaveCount(0);
  await expect(page.getByTestId(`digest-artist-${KILO}`)).toHaveCount(0);
  const stored = ((await profile())[0]?.last_seen_overview_at ?? '') as string;
  expect(Date.parse(stored)).toBeLessThan(Date.now());
  await ctx.close();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`5 · the scoped member's Overview digest carries only Nova, at ${viewport.width}px`, async ({ browser, baseURL, request }) => {
    // Leaving the page marks the digest seen; start each width from "never looked".
    await rest(request, 'PATCH', `user_profiles?user_id=eq.${BUYER_ID}`, { last_seen_overview_at: null });
    const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test', viewport);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}`);
    await expect(page.getByTestId('overview-digest')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('digest-line').filter({ hasText: 'You added 10 demos' })).toHaveCount(1); // their own uploads read "You"
    await expect(page.getByTestId(`digest-artist-${NOVA}`)).toBeVisible();
    await expect(page.getByTestId(`digest-artist-${KILO}`)).toHaveCount(0);
    await expect(page.getByTestId('digest-org')).toHaveCount(0);
    expect(await page.content()).not.toContain(`Kilo ${run}`);
    // No horizontal scroll at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ctx.close();
  });
}

test('6 · the artist Activity tab lists the artist’s own day → actor lines; another artist’s page is a 404 for the scoped member', async ({ browser, baseURL }) => {
  const owner = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await owner.newPage();
  await page.goto(`/o/${SLUG}/artists/${KILO}?tab=activity`);
  await expect(page.getByTestId('artist-activity')).toBeVisible({ timeout: 30_000 });
  // Kilo: five demos by the owner and the file in their project, one line for the day.
  await expect(page.getByTestId('digest-line')).toHaveCount(1);
  await expect(page.getByTestId('digest-line')).toContainText('You added 5 demos and added a file');
  await owner.close();

  const member = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const denied = await member.newPage();
  const res = await denied.goto(`/o/${SLUG}/artists/${KILO}?tab=activity`);
  expect(res?.status()).toBe(404);
  const own = await member.newPage();
  await own.goto(`/o/${SLUG}/artists/${NOVA}?tab=activity`);
  await expect(own.getByTestId('artist-activity')).toBeVisible({ timeout: 30_000 });
  await expect(own.getByTestId('digest-line').filter({ hasText: 'You added 10 demos' })).toHaveCount(1);
  await member.close();
});

test('7 · last_seen_overview_at is the member’s own, written only by the route', async ({ browser, baseURL, request }) => {
  // Through PostgREST nobody can write it: no write policy (migration 136, unchanged by 147).
  const res = await request.patch(`${REST}/user_profiles?user_id=eq.${BUYER_ID}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: JSON.stringify({ last_seen_overview_at: new Date().toISOString() }),
  });
  expect(await res.json()).toEqual([]);

  // Through the route, the session's own row moves — the body cannot name another user.
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const through = new Date(Date.now() - 1000).toISOString();
  const ok = await ctx.request.post(`/api/org/${ORG}/overview/seen`, { data: { through } });
  expect(ok.status(), await ok.text()).toBe(200);
  expect((await ctx.request.post(`/api/org/${ORG}/overview/seen`, { data: { through, user_id: PRODUCER_ID } })).status()).toBe(400);
  const rows = (await rest(request, 'GET', `user_profiles?select=user_id,last_seen_overview_at&user_id=in.(${PRODUCER_ID},${BUYER_ID})`)) as { user_id: string; last_seen_overview_at: string | null }[];
  const seenOf = (id: string) => rows.find((r) => r.user_id === id)?.last_seen_overview_at;
  expect(Date.parse(seenOf(BUYER_ID) as string)).toBe(Date.parse(through));
  expect(seenOf(PRODUCER_ID)).not.toBe(seenOf(BUYER_ID));
  await ctx.close();
});
