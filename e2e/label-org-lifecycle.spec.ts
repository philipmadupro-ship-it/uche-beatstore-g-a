/**
 * Org export, deletion and retention (LABEL-39) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true and CRON_SECRET from
 * env.sh), through the real routes, the real cron routes and the real
 * Postgres cascade.
 *
 * The producer owns a label with an artist, a project, a song, a file on disk
 * and events old and new; the seed buyer is a plain member. Another label and
 * the producer's own catalogue sit beside it and must come through untouched.
 *
 *  1. Export and delete need a RECENT sign-in: an hour-old session gets 403
 *     `requiresReauth` and the page offers a sign-in link; a member, who is
 *     not an owner, gets 403 regardless.
 *  2. Export: JSON with the manifest and the org's rows only; the audit event.
 *  3. The page: Delete waits for the typed name and the confirmation, then
 *     lands on the restore page; the org is gone for its routes and its
 *     shell sends the owner to the restore page.
 *  4. Restore brings it back.
 *  5. After the grace period the purge cron removes the rows and the files;
 *     the other label, the producer's catalogue and the people stay.
 *  6. The retention cron prunes old everyday events and keeps audit events.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const CRON = { authorization: `Bearer ${process.env.CRON_SECRET ?? 'local-cron'}` };
const run = randomUUID().slice(0, 6);

const ORG = randomUUID();
const OTHER = randomUUID();
const STUDIO = randomUUID();
const NAME = `Night Shift ${run}`;
const SLUG = `night-shift-${run}`;
const C1 = randomUUID();
const P1 = randomUUID();
const S1 = randomUUID();
const XP = randomUUID();
const XS = randomUUID();
const PROD_TRACK = randomUUID();
const ASSET_KEY = `orgs/${ORG}/assets/${P1}/cover${run}.png`;
const LOCAL_FILE = path.join(process.cwd(), 'data', ASSET_KEY);

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
const count = async (request: APIRequestContext, p: string) => ((await rest(request, 'GET', p)) as unknown[]).length;

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string, minutesAgo = 0) {
  const iat = Math.floor(Date.now() / 1000) - minutesAgo * 60;
  const c = sessionCookie(id, email, iat);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'organizations', [
    { id: ORG, name: NAME, slug: SLUG, kind: 'label', created_by: PRODUCER_ID },
    { id: OTHER, name: `Other Label ${run}`, slug: `other-label-${run}`, kind: 'label', created_by: BUYER_ID },
    // The producer's own studio: a live membership left once the label is deleted, as in production (migration 137).
    { id: STUDIO, name: `Studio ${run}`, slug: `studio-${run}`, kind: 'producer', created_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: OTHER, user_id: BUYER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: STUDIO, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
  ]);
  await rest(request, 'POST', 'contacts', [{ id: C1, user_id: null, org_id: ORG, name: `Nova ${run}`, email: `nova-${run}@local.test`, category: 'artist' }]);
  await rest(request, 'POST', 'projects', [
    { id: P1, user_id: null, org_id: ORG, name: 'Nova EP' },
    { id: XP, user_id: null, org_id: OTHER, name: 'Other EP' },
  ]);
  await rest(request, 'POST', 'tracks', [
    { id: S1, user_id: null, org_id: ORG, created_by: PRODUCER_ID, title: 'Midnight', type: 'song', audio_url: `r2://private/orgs/${ORG}/tracks/${run}.wav`, song_stage: 'inbox' },
    { id: XS, user_id: null, org_id: OTHER, created_by: BUYER_ID, title: 'Elsewhere', type: 'song', audio_url: `r2://private/orgs/${OTHER}/tracks/${run}.wav`, song_stage: 'inbox' },
  ]);
  await rest(request, 'POST', 'tracks', [{ id: PROD_TRACK, user_id: PRODUCER_ID, title: `Producer beat ${run}`, type: 'beat', audio_url: 'r2://private/p1' }]);
  await rest(request, 'POST', 'project_tracks', [{ project_id: P1, track_id: S1, position: 0 }, { project_id: XP, track_id: XS, position: 0 }]);
  await rest(request, 'POST', 'project_assets', [
    { user_id: null, created_by: PRODUCER_ID, project_id: P1, kind: 'artwork', sensitivity: 'normal', url: `local://${ASSET_KEY}`, label: 'Cover' },
  ]);
  // A file of the org's on the local disk, and one of the other org's.
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, 'png');
  const otherFile = path.join(process.cwd(), 'data', `orgs/${OTHER}/assets/${XP}/cover${run}.png`);
  fs.mkdirSync(path.dirname(otherFile), { recursive: true });
  fs.writeFileSync(otherFile, 'png');
  // Events: an old everyday one and an old audit one in the org, and an old everyday one in the other org.
  const old = new Date(Date.now() - 30 * 31 * 86_400_000).toISOString();
  await rest(request, 'POST', 'activity_events', [
    { org_id: ORG, actor_id: PRODUCER_ID, verb: 'song.created', audit: false, visibility: 'artist', created_at: old, payload: { run } },
    { org_id: ORG, actor_id: PRODUCER_ID, verb: 'member.removed', audit: true, visibility: 'internal', created_at: old, payload: { run } },
    { org_id: OTHER, actor_id: BUYER_ID, verb: 'song.created', audit: false, visibility: 'artist', created_at: old, payload: { run } },
  ]);
});

test.afterAll(async ({ request }) => {
  // Whatever an aborted run left behind.
  await rest(request, 'DELETE', `organizations?id=in.(${ORG},${OTHER},${STUDIO})`).catch(() => undefined);
  await rest(request, 'DELETE', `tracks?id=eq.${PROD_TRACK}`).catch(() => undefined);
  fs.rmSync(path.join(process.cwd(), 'data', 'orgs', ORG), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'orgs', OTHER), { recursive: true, force: true });
});

test('export and delete need an owner and a recent sign-in', async ({ browser, baseURL }) => {
  // Signed in an hour ago: the owner is asked to sign in again.
  const stale = await browser.newContext();
  await signedIn(stale, baseURL!, PRODUCER_ID, 'producer@local.test', 60);
  const exportRes = await stale.request.get(`/api/org/${ORG}/export`);
  expect(exportRes.status()).toBe(403);
  expect(await exportRes.json()).toMatchObject({ requiresReauth: true });
  const delRes = await stale.request.delete(`/api/org/${ORG}`, { data: { confirmName: NAME } });
  expect(delRes.status()).toBe(403);
  expect(await delRes.json()).toMatchObject({ requiresReauth: true });
  expect(await count(stale.request, `organizations?id=eq.${ORG}&deleted_at=is.null`)).toBe(1);

  // …and the page turns that into a way forward, not a dead end.
  const page = await stale.newPage();
  await page.goto(`/o/${SLUG}/settings/data`);
  await page.getByRole('button', { name: /Download JSON/ }).click();
  await expect(page.getByRole('button', { name: /Send me a sign-in link/ })).toBeVisible({ timeout: 30_000 });
  await stale.close();

  // A member who is not an owner is refused however recently they signed in.
  const member = await browser.newContext();
  await signedIn(member, baseURL!, BUYER_ID, 'buyer@local.test');
  expect((await member.request.get(`/api/org/${ORG}/export`)).status()).toBe(403);
  expect((await member.request.delete(`/api/org/${ORG}`, { data: { confirmName: NAME } })).status()).toBe(403);
  expect(await count(member.request, `organizations?id=eq.${ORG}&deleted_at=is.null`)).toBe(1);
  await member.close();
});

test('the export holds the org’s data, a manifest of its objects, and is audited', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const res = await ctx.request.get(`/api/org/${ORG}/export`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain(`${SLUG}-export-`);
  const body = await res.json();
  expect(body.tables.tracks.map((t: { id: string }) => t.id)).toEqual([S1]);
  expect(body.tables.contacts.map((c: { id: string }) => c.id)).toEqual([C1]);
  expect(body.tables.project_assets).toHaveLength(1);
  expect(body.tables.org_members).toHaveLength(2);
  expect(body.manifest.tables.tracks).toBe(1);
  const keys = body.manifest.references.map((r: { key: string }) => r.key);
  expect(keys).toEqual(expect.arrayContaining([`orgs/${ORG}/tracks/${run}.wav`, ASSET_KEY]));
  expect(body.manifest.stored.map((o: { key: string }) => o.key)).toEqual([ASSET_KEY]);
  const text = JSON.stringify(body);
  for (const other of [OTHER, XP, XS, PROD_TRACK]) expect(text).not.toContain(other);
  expect(await count(request, `activity_events?org_id=eq.${ORG}&verb=eq.org.exported&audit=is.true`)).toBe(1);

  const csv = await ctx.request.get(`/api/org/${ORG}/export?format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toBe('application/zip');
  expect((await csv.body()).subarray(0, 2).toString()).toBe('PK');
  await ctx.close();
});

for (const width of [1440, 390]) {
  test(`delete: the typed name, the confirmation, then the restore page — at ${width}px`, async ({ browser, baseURL, request }) => {
    const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
    await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}/settings/members`);
    await page.getByRole('link', { name: /Export & deletion/ }).click();
    await expect(page.getByRole('heading', { name: /Export & deletion/ })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    const del = page.getByRole('button', { name: /Delete this organization/ });
    await expect(del).toBeDisabled();
    await page.getByLabel(/to confirm/).fill(NAME.toLowerCase());
    await expect(del).toBeDisabled();
    await page.getByLabel(/to confirm/).fill(NAME);
    await expect(del).toBeEnabled();
    await del.click();
    // Declining leaves everything alone…
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await count(request, `organizations?id=eq.${ORG}&deleted_at=is.null`)).toBe(1);
    // …accepting starts the grace period.
    await del.click();
    await page.getByRole('button', { name: 'Delete organization', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/restore/${ORG}`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
    await expect(page.getByText(/deleted for good on/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore organization' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    // Gone for every org route and for the shell; the rows are still there.
    expect(await count(request, `organizations?id=eq.${ORG}&deleted_at=not.is.null`)).toBe(1);
    expect((await ctx.request.get(`/api/org/${ORG}/members`)).status()).toBe(403);
    const gone = await ctx.request.get(`/api/org/${ORG}/export`);
    expect(gone.status(), await gone.text()).toBe(404);
    await page.goto(`/o/${SLUG}/artists`);
    await expect(page).toHaveURL(new RegExp(`/restore/${ORG}`));
    expect(await count(request, `tracks?org_id=eq.${ORG}`)).toBe(1);
    expect(await count(request, `activity_events?org_id=eq.${ORG}&verb=eq.org.deletion_scheduled&audit=is.true`)).toBeGreaterThanOrEqual(1); // once per width: the org is deleted and restored twice

    // A member sees an org that does not exist; a stranger to it, the same.
    const member = await browser.newContext();
    await signedIn(member, baseURL!, BUYER_ID, 'buyer@local.test');
    expect((await member.request.get(`/api/org/${ORG}/restore`)).status()).toBe(404);
    expect((await (await member.newPage()).goto(`/o/${SLUG}/artists`))!.status()).toBe(404);
    await member.close();

    // Restore.
    await page.goto(`/restore/${ORG}`);
    await page.getByRole('button', { name: 'Restore organization' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${SLUG}`), { timeout: 30_000 });
    expect(await count(request, `organizations?id=eq.${ORG}&deleted_at=is.null`)).toBe(1);
    expect(await count(request, `activity_events?org_id=eq.${ORG}&verb=eq.org.restored&audit=is.true`)).toBeGreaterThanOrEqual(1);
    expect((await ctx.request.get(`/api/org/${ORG}/members`)).status()).toBe(200);
    await ctx.close();
  });
}

test('after the grace period the purge cron removes the org’s rows and files, and nothing else', async ({ request, baseURL }) => {
  // Soft-deleted three days ago: not due, so nothing happens.
  await rest(request, 'PATCH', `organizations?id=eq.${ORG}`, { deleted_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  const early = await request.get(`${baseURL}/api/cron/purge-deleted-orgs`, { headers: CRON });
  expect(early.status()).toBe(200);
  expect(await count(request, `organizations?id=eq.${ORG}`)).toBe(1);
  expect(fs.existsSync(LOCAL_FILE)).toBe(true);

  // The cron refuses a caller without the secret.
  expect((await request.get(`${baseURL}/api/cron/purge-deleted-orgs`)).status()).toBe(401);

  // Past 30 days it is due.
  await rest(request, 'PATCH', `organizations?id=eq.${ORG}`, { deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  const res = await request.get(`${baseURL}/api/cron/purge-deleted-orgs`, { headers: CRON });
  expect(res.status()).toBe(200);
  expect((await res.json()).purged).toBeGreaterThanOrEqual(1);

  // No rows, no objects.
  expect(await count(request, `organizations?id=eq.${ORG}`)).toBe(0);
  for (const t of ['org_members', 'contacts', 'projects', 'tracks', 'project_assets', 'activity_events', 'org_invitations']) {
    expect(await count(request, `${t}?org_id=eq.${ORG}`), t).toBe(0);
  }
  expect(await count(request, `project_tracks?project_id=eq.${P1}`)).toBe(0);
  expect(fs.existsSync(path.join(process.cwd(), 'data', 'orgs', ORG))).toBe(false);

  // The other label, the producer’s catalogue and the people are as they were.
  expect(await count(request, `organizations?id=eq.${OTHER}`)).toBe(1);
  expect(await count(request, `tracks?id=eq.${XS}`)).toBe(1);
  expect(await count(request, `projects?id=eq.${XP}`)).toBe(1);
  expect(await count(request, `org_members?org_id=eq.${OTHER}`)).toBe(1);
  expect(await count(request, `activity_events?org_id=eq.${OTHER}`)).toBe(1);
  expect(fs.existsSync(path.join(process.cwd(), 'data', 'orgs', OTHER))).toBe(true);
  expect(await count(request, `tracks?id=eq.${PROD_TRACK}&user_id=eq.${PRODUCER_ID}`)).toBe(1);
  expect(await count(request, `org_members?user_id=eq.${BUYER_ID}`)).toBeGreaterThanOrEqual(1);

  // Running it again finds nothing.
  const again = await request.get(`${baseURL}/api/cron/purge-deleted-orgs`, { headers: CRON });
  expect((await again.json()).purged).toBe(0);
});

test('the retention cron prunes old everyday events and keeps audit events', async ({ request, baseURL }) => {
  expect((await request.get(`${baseURL}/api/cron/prune-org-events`)).status()).toBe(401);
  expect(await count(request, `activity_events?org_id=eq.${OTHER}&audit=is.false`)).toBe(1);
  const res = await request.get(`${baseURL}/api/cron/prune-org-events`, { headers: CRON });
  expect(res.status()).toBe(200);
  expect((await res.json()).deleted).toBeGreaterThanOrEqual(1);
  expect(await count(request, `activity_events?org_id=eq.${OTHER}&audit=is.false`)).toBe(0);

  // An old AUDIT event is never pruned, however old.
  const ancient = new Date(Date.now() - 6 * 365 * 86_400_000).toISOString();
  await rest(request, 'POST', 'activity_events', [{ org_id: OTHER, actor_id: BUYER_ID, verb: 'member.removed', audit: true, visibility: 'internal', created_at: ancient }]);
  await request.get(`${baseURL}/api/cron/prune-org-events`, { headers: CRON });
  expect(await count(request, `activity_events?org_id=eq.${OTHER}&audit=is.true`)).toBe(1);
});
