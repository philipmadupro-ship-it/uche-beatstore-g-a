/**
 * The recording / song metadata editor (LABEL-53) end to end against a REAL
 * database (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 *
 * The journey the acceptance asks for: a draft release whose tracklist holds a
 * song whose master has NO ISRC. The release page's Metadata gate says
 * "has no ISRC" and offers "Add the ISRC"; the link opens the song page with
 * that recording's editor open; the ISRC is typed and saved through the page —
 * the field is never written with the service key — and the blocker is gone
 * from the release. Also proven on the real tables: the stored code is the
 * normal form, the activity event names fields and never values, a second
 * editor holding a stale token gets 409 with the current values and the UI
 * says so, and a member without release.write cannot set the ISRC.
 *
 * Cast: the producer owns the label (and holds every capability). The seed
 * BUYER is a `producer`-function member: catalog.write, no release.write.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `meta-${run}`;
const NOVA = randomUUID();
const NOVA_INBOX = randomUUID();
const SONG = randomUUID();
const MASTER = randomUUID();
const api = `/api/org/${ORG}`;
let releaseId = '';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const SHOTS = 'e2e-artifacts/LABEL-53';
mkdirSync(SHOTS, { recursive: true });

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

const track = (id: string, title: string, stage: string | null) => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', song_stage: stage, audio_url: `/uploads/labelos-e2e-${id}.mp3`,
});
const trackRow = async (request: APIRequestContext, id: string) =>
  ((await rest(request, 'GET', `tracks?id=eq.${id}&select=isrc,genre,language,p_line,notes,metadata_updated_at`)) as Record<string, unknown>[])[0];

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Meta Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['producer'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', [track(SONG, 'Midnight', 'selected'), track(MASTER, 'Midnight (master)', null)]);
  await rest(request, 'POST', 'project_tracks', [SONG, MASTER].map((track_id, position) => ({ project_id: NOVA_INBOX, track_id, position })));
  await rest(request, 'POST', 'track_links', { from_track_id: SONG, to_track_id: MASTER, user_id: null, relation: 'master' });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

test('1 · a draft release lists the song; its master has no ISRC', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const created = await ctx.request.post(`${api}/releases`, { data: { title: `Midnight Single ${run}`, contact_id: NOVA, type: 'single' } });
  expect(created.status(), await created.text()).toBe(201);
  releaseId = (await created.json()).release.id;
  const item = await ctx.request.post(`${api}/releases/${releaseId}/items`, { data: { song_track_id: SONG, master_track_id: MASTER } });
  expect(item.ok(), await item.text()).toBeTruthy();
  await ctx.close();
});

for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`2 · ${name}: "Add the ISRC" opens the editor on the recording; the code is set through the page and the blocker clears`, async ({ browser, baseURL, request }) => {
    const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
    const page = await ctx.newPage();
    await page.setViewportSize(size);
    const isrc = name === 'desktop' ? 'GB-AAA-26-00001' : 'gb-aaa-26-00002';
    const stored = name === 'desktop' ? 'GBAAA2600001' : 'GBAAA2600002';

    await page.goto(`/o/${SLUG}/releases/${releaseId}`);
    await expect(page.getByTestId('release-gates')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('release-gate-open-metadata').click();
    const pop = page.getByTestId('release-gate-popover-metadata');
    await expect(pop).toContainText('has no ISRC');
    await page.screenshot({ path: `${SHOTS}/${name}-1-release-blocker.png` });
    await page.getByTestId(`release-fix-isrc-${MASTER}`).click();

    // The song page, with that recording's editor open (not the song's).
    await expect(page.getByTestId('org-song')).toBeVisible({ timeout: 60_000 });
    expect(page.url()).toContain(`edit=${MASTER}`);
    const editor = page.getByTestId(`org-rec-metadata-${MASTER}`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByLabel('ISWC')).toHaveCount(0);

    await expect(editor.getByTestId(`org-rec-metadata-${MASTER}-save`)).toBeDisabled();
    await editor.getByLabel('ISRC').fill(isrc);
    await editor.getByLabel('Genre').fill(`Alt ${name}`);
    await editor.getByLabel('Notes').fill(`PRIVATE mix note ${name}`);
    await page.screenshot({ path: `${SHOTS}/${name}-2-editor-filled.png` });
    await editor.getByTestId(`org-rec-metadata-${MASTER}-save`).click();
    await expect(editor.getByTestId(`org-rec-metadata-${MASTER}-save`)).toBeDisabled({ timeout: 25_000 });
    await expect(editor.getByLabel('ISRC')).toHaveValue(stored);
    await page.screenshot({ path: `${SHOTS}/${name}-3-saved.png` });

    // A SECOND save in the same page load uses the token the server returned: no false conflict.
    await editor.getByLabel('Genre').fill(`Again ${name}`);
    await editor.getByTestId(`org-rec-metadata-${MASTER}-save`).click();
    await expect(editor.getByTestId(`org-rec-metadata-${MASTER}-save`)).toBeDisabled({ timeout: 25_000 });
    await expect(editor.getByTestId(`org-rec-metadata-${MASTER}-conflict`)).toHaveCount(0);
    await expect.poll(async () => (await trackRow(request, MASTER)).genre, { timeout: 25_000 }).toBe(`Again ${name}`);
    await expect(editor.getByTestId(`org-rec-metadata-${MASTER}-conflict`)).toHaveCount(0);

    // On the real table, in the normal form.
    expect((await trackRow(request, MASTER)).isrc).toBe(stored);

    // And the release no longer lists it.
    await page.goto(`/o/${SLUG}/releases/${releaseId}`);
    await expect(page.getByTestId('release-gates')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('release-gate-open-metadata').click();
    await expect(page.getByTestId('release-gate-popover-metadata')).not.toContainText(`Track 1 has no ISRC`);
    await page.screenshot({ path: `${SHOTS}/${name}-4-blocker-gone.png` });

    // Clear it again so the next viewport starts from "no ISRC".
    await ctx.close();
    if (name === 'desktop') await rest(request, 'PATCH', `tracks?id=eq.${MASTER}`, { isrc: null, metadata_updated_at: null });
  });
}

test('3 · the audit event lists field names, never values or notes', async ({ request }) => {
  const events = (await rest(request, 'GET', `activity_events?select=verb,visibility,audit,payload&verb=eq.recording.metadata_updated&org_id=eq.${ORG}`)) as { visibility: string; audit: boolean; payload: { fields: string[] } }[];
  expect(events.length).toBeGreaterThanOrEqual(1);
  for (const e of events) {
    expect(e.visibility).toBe('internal');
    expect(e.audit).toBe(false);
    expect(e.payload.fields.length).toBeGreaterThanOrEqual(1);
    expect(e.payload.fields.every((f) => ['genre', 'isrc', 'notes'].includes(f))).toBe(true);
  }
  const blob = JSON.stringify(events);
  expect(blob).not.toContain('PRIVATE');
  expect(blob).not.toContain('GBAAA');
});

test('4 · a stale editor gets 409 with the current values, and the page says so', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await owner.newPage();
  await page.goto(`/o/${SLUG}/songs/${SONG}`);
  const editor = page.getByTestId('org-song-metadata');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(editor.getByLabel('Title')).toHaveValue('Midnight');

  // Someone else saves first, through the real route.
  const other = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const first = await other.request.patch(`${api}/songs/${SONG}`, { data: { expected: null, genre: 'Pop' } });
  expect(first.status(), await first.text()).toBe(200);

  await editor.getByLabel('Genre').fill('Rock');
  await editor.getByTestId('org-song-metadata-save').click();
  await expect(editor.getByTestId('org-song-metadata-conflict')).toContainText('Someone else changed', { timeout: 25_000 });
  await page.screenshot({ path: `${SHOTS}/conflict.png` });
  expect((await trackRow(request, SONG)).genre).toBe('Pop');
  await editor.getByTestId('org-song-metadata-reload').click();
  await expect(editor.getByLabel('Genre')).toHaveValue('Pop');
  await owner.close();
  await other.close();
});

test('5 · a member without release.write cannot set the ISRC but can edit the creative fields; a bad code is refused naming the field', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const before = (await trackRow(request, MASTER)).isrc;
  const forbidden = await ctx.request.patch(`${api}/songs/${MASTER}`, { data: { expected: null, isrc: 'GBAAA2600009' } });
  expect(forbidden.status()).toBe(403);
  expect((await trackRow(request, MASTER)).isrc).toBe(before);

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${SONG}?edit=${MASTER}`);
  const editor = page.getByTestId(`org-rec-metadata-${MASTER}`);
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(editor.getByLabel('ISRC')).toBeDisabled();
  await expect(editor.getByLabel('Genre')).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/no-release-write.png` });

  const owner = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const bad = await owner.request.patch(`${api}/songs/${MASTER}`, { data: { expected: (await trackRow(request, MASTER)).metadata_updated_at, isrc: 'not-an-isrc' } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toMatchObject({ field: 'isrc' });
  await ctx.close();
  await owner.close();
});
