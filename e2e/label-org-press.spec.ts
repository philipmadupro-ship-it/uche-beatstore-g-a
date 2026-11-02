/**
 * PR and press (LABEL-66) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * Nothing the kit holds is seeded with the service key: the PR member builds it
 * through the release page's Press section, as a person does. The service key
 * seeds only the org, the members, the artist and a press contact; the photo is
 * uploaded to the release's project through the org files route.
 *
 *   PRODUCER — owner of the label (adds the press contact; sees the directory filter).
 *   PR       — pr function: reads and writes the kit and the tracker.
 *   MKT      — marketing function: no pr.read — no Press section, 403 on the routes.
 *   ARTIST_A — role `artist` scoped to Nova: no press either.
 *
 * Proven on the real stack: the kit is built in the UI; a visitor with NO account
 * opens the link and, before the embargo, sees only the title, the line and the
 * marked photo (the unmarked photo is 404, the bio is nowhere in the response);
 * lifting the embargo shows the bio and links on the very next request; no audio
 * for a release that is not out; the tracker moves sent → replied with a coverage
 * link (https only); revoking kills the link at once; events carry no words, URLs
 * or addresses; the producer dashboard and /store still load.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ARTIST_A_ID, BUYER_ID, ARTIST_B_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `press-${run}`;
const NOVA = randomUUID();
const INBOX = randomUUID();
const PRESS_PERSON = randomUUID();

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

const shots = 'e2e-artifacts/LABEL-66';
mkdirSync(shots, { recursive: true });

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const prMember = { id: BUYER_ID, email: 'buyer@local.test' };
const marketing = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const artist = { id: ARTIST_A_ID, email: 'artist-a@local.test' };

const api = `/api/org/${ORG}`;
const ids: Record<string, string> = {};
const pressApi = () => `${api}/releases/${ids.release}/press`;
// A real 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let publicPath = '';
const BIO = `A quiet biography ${run}`;
const LINE = `New single, coming soon ${run}`;

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Press Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['pr'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', { id: INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'contacts', { id: PRESS_PERSON, org_id: ORG, user_id: null, name: `Pat Press ${run}`, category: 'press', label: 'The Quiet Review', email: `pat-${run}@example.com` });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · the PR member builds the kit on the release page: words, embargo, a photo, a link, a share link, the tracker', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const made = await owner.request.post(`${api}/releases`, { data: { title: `Night Shift ${run}`, contact_id: NOVA, type: 'single' } });
  expect(made.status(), await made.text()).toBe(201);
  ids.release = (await made.json()).release.id;
  const rel = (await rest(request, 'GET', `releases?id=eq.${ids.release}&select=project_id`)) as { project_id: string }[];
  // The photos: two real PNGs in the release's own project, uploaded through the org files route.
  for (const name of ['cover.png', 'backstage.png']) {
    const up = await owner.request.post(`${api}/projects/${rel[0].project_id}/assets`, { multipart: { file: { name, mimeType: 'image/png', buffer: PNG }, kind: 'photo' } });
    expect(up.status(), await up.text()).toBeLessThan(300);
  }
  await owner.close();

  const ctx = await as(browser, baseURL!, prMember.id, prMember.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.release}`);
  const panel = page.getByTestId('press-kit');
  await expect(panel).toBeVisible({ timeout: 90_000 });

  // Words, edited in place.
  await panel.getByRole('button', { name: 'Edit Headline' }).click();
  await panel.getByLabel('Headline', { exact: true }).fill(`Nova returns ${run}`);
  await panel.getByLabel('Headline', { exact: true }).press('Enter');
  await expect(panel.getByRole('button', { name: 'Edit Headline' })).toContainText(`Nova returns ${run}`, { timeout: 30_000 });
  await panel.getByRole('button', { name: 'Edit Bio' }).click();
  await panel.getByLabel('Bio', { exact: true }).fill(BIO);
  await panel.getByLabel('Bio', { exact: true }).press('Control+Enter');
  await expect(panel.getByRole('button', { name: 'Edit Bio' })).toContainText(BIO, { timeout: 30_000 });

  // Embargo: a moment far in the future, and the line shown until then.
  await panel.getByLabel('Embargo lifts at').fill('2099-01-01T10:00');
  await expect(panel.getByTestId('press-embargo-state')).toHaveText('Embargoed', { timeout: 30_000 });
  await panel.getByRole('button', { name: 'Edit Line before embargo' }).click();
  await panel.getByLabel('Line before embargo', { exact: true }).fill(LINE);
  await panel.getByLabel('Line before embargo', { exact: true }).press('Enter');
  await expect(panel.getByRole('button', { name: 'Edit Line before embargo' })).toContainText(LINE, { timeout: 30_000 });

  // Two photos; only the first is marked for before the embargo.
  for (let i = 0; i < 2; i += 1) {
    await panel.getByRole('button', { name: 'Add a photo' }).click();
    await page.getByRole('option').first().click();
    await expect(panel.getByTestId('press-photo')).toHaveCount(i + 1, { timeout: 30_000 });
  }
  await panel.getByTestId('press-photo').first().getByRole('checkbox', { name: /Before embargo/ }).click();
  await expect.poll(async () => ((await rest(request, 'GET', 'press_kit_photos?select=pre_embargo')) as { pre_embargo: boolean }[]).filter((p) => p.pre_embargo).length, { timeout: 30_000 }).toBe(1);

  // A link: https only.
  await panel.getByLabel('Link label', { exact: true }).first().fill('Instagram');
  await panel.getByLabel('Link address').fill('http://insecure.example.com');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Use a full https:// address').first()).toBeVisible({ timeout: 30_000 });
  await panel.getByLabel('Link address').fill('https://instagram.com/nova');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByText('https://instagram.com/nova')).toBeVisible({ timeout: 30_000 });

  // A share link, shown once.
  await panel.getByLabel('Link label', { exact: true }).last().fill('Pitchfork');
  await panel.getByRole('button', { name: 'Make link' }).click();
  const fresh = panel.getByTestId('press-fresh-link');
  await expect(fresh).toBeVisible({ timeout: 30_000 });
  publicPath = new URL((await fresh.locator('code').innerText()).trim()).pathname;
  expect(publicPath).toMatch(/^\/press\/[A-Za-z0-9_-]{43}$/);
  const shares = (await rest(request, 'GET', 'press_kit_shares?select=token_hash,label')) as { token_hash: string; label: string }[];
  expect(shares).toHaveLength(1);
  expect(JSON.stringify(shares)).not.toContain(publicPath.split('/')[2]);

  // The tracker: add the press contact, mark it sent, then replied, with a coverage link.
  const tracker = panel.getByTestId('press-outreach');
  await tracker.getByRole('button', { name: 'Add a press contact' }).click();
  await page.getByRole('option', { name: new RegExp(`Pat Press ${run}`) }).click();
  const row = tracker.getByTestId('press-outreach-row');
  await expect(row).toHaveAttribute('data-stage', 'planned', { timeout: 30_000 });
  await row.getByRole('checkbox', { name: 'Sent' }).click();
  await expect(row).toHaveAttribute('data-stage', 'sent', { timeout: 30_000 });
  await row.getByRole('checkbox', { name: 'Replied' }).click();
  await expect(row).toHaveAttribute('data-stage', 'replied', { timeout: 30_000 });
  await row.getByRole('button', { name: /Edit Coverage link/ }).click();
  await row.getByRole('textbox', { name: /Coverage link for/ }).fill('http://nope.example.com');
  await row.getByRole('textbox', { name: /Coverage link for/ }).press('Enter');
  await expect(page.getByText('Use a full https:// address').first()).toBeVisible({ timeout: 30_000 });
  await row.getByRole('textbox', { name: /Coverage link for/ }).fill('https://quiet.example.com/review');
  await row.getByRole('textbox', { name: /Coverage link for/ }).press('Enter');
  await expect(row.getByRole('button', { name: /Edit Coverage link/ })).toContainText('https://quiet.example.com/review', { timeout: 30_000 });
  expect(((await rest(request, 'GET', 'press_outreach?select=coverage_url,sent_at,replied_at')) as { coverage_url: string }[])[0].coverage_url).toBe('https://quiet.example.com/review');
  // The tracker never shows an address.
  await expect(tracker).not.toContainText('@example.com');
  await page.screenshot({ path: `${shots}/pr-member-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  await page.screenshot({ path: `${shots}/pr-member-390.png`, fullPage: true });
  await ctx.close();
});

test('2 · a visitor with no account: before the embargo only the title, the line and the marked photo', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(publicPath);
  const view = page.getByTestId('press-embargoed');
  await expect(view).toBeVisible({ timeout: 90_000 });
  await expect(view.getByRole('heading', { name: `Night Shift ${run}` })).toBeVisible();
  await expect(view.getByText(LINE)).toBeVisible();
  await expect(page.getByText(BIO)).toHaveCount(0);
  await expect(page.getByTestId('press-photos').getByRole('img')).toHaveCount(1);
  // The marked photo really loads through the token-gated route.
  const img = page.getByTestId('press-photos').getByRole('img');
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `${shots}/visitor-embargoed-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/visitor-embargoed-390.png`, fullPage: true });

  const token = publicPath.split('/')[2];
  const json = await ctx.request.get(`${baseURL}/api/press/${token}`);
  expect(json.status()).toBe(200);
  expect(json.headers()['cache-control']).toMatch(/no-store/);
  const text = await json.text();
  const body = JSON.parse(text).press;
  expect(Object.keys(body).sort()).toEqual(['artist', 'note', 'photos', 'state', 'title']);
  for (const leak of [BIO, 'instagram', 'r2://', 'orgs/', 'private', `pat-${run}`, 'Pat Press', '2099', 'tracklist', 'audio']) expect(text, leak).not.toContain(leak);
  // The unmarked photo is 404 during the embargo; the marked one streams.
  const photos = (await rest(ctx.request, 'GET', 'press_kit_photos?select=id,pre_embargo')) as { id: string; pre_embargo: boolean }[];
  const unmarked = photos.find((p) => !p.pre_embargo)!;
  const marked = photos.find((p) => p.pre_embargo)!;
  expect((await ctx.request.get(`${baseURL}/api/press/${token}/assets/${unmarked.id}`)).status()).toBe(404);
  const ok = await ctx.request.get(`${baseURL}/api/press/${token}/assets/${marked.id}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toMatch(/image\/png/);
  expect(ok.headers()['cache-control']).toMatch(/no-store/);
  // A look-alike token is the same 404 as a revoked one.
  expect((await ctx.request.get(`${baseURL}/api/press/${token.slice(0, 42)}x`)).status()).toBe(404);
  await ctx.close();
});

test('3 · lifting the embargo shows the whole kit on the next request — and still no audio for a release that is not out', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, prMember.id, prMember.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.release}`);
  const panel = page.getByTestId('press-kit');
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await panel.getByRole('button', { name: 'Remove embargo' }).click();
  await expect(panel.getByTestId('press-embargo-state')).toHaveText('No embargo', { timeout: 30_000 });

  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto(publicPath);
  await expect(vp.getByTestId('press-live')).toBeVisible({ timeout: 90_000 });
  await expect(vp.getByText(BIO)).toBeVisible();
  await expect(vp.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/nova');
  await expect(vp.getByTestId('press-photos').getByRole('img')).toHaveCount(2);
  await expect(vp.getByTestId('press-listen')).toHaveCount(0);
  expect(await vp.locator('audio').count()).toBe(0);
  const text = await (await visitor.request.get(`${baseURL}/api/press/${publicPath.split('/')[2]}`)).text();
  for (const leak of ['r2://', 'orgs/', 'private', `pat-${run}`, 'Pat Press', '/api/store/releases', 'org_id']) expect(text, leak).not.toContain(leak);
  expect(JSON.parse(text).press.listen).toBeNull();
  await vp.screenshot({ path: `${shots}/visitor-live-1440.png`, fullPage: true });
  await vp.setViewportSize({ width: 390, height: 844 });
  await vp.screenshot({ path: `${shots}/visitor-live-390.png`, fullPage: true });
  await visitor.close();
  await ctx.close();
});

test('4 · revoking kills the link on the next request', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, prMember.id, prMember.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.release}`);
  const panel = page.getByTestId('press-kit');
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByTestId('press-share')).toContainText(/views?/);
  await panel.getByTestId('press-share').getByRole('button', { name: 'Revoke' }).click();
  await expect(panel.getByTestId('press-share')).toHaveAttribute('data-state', 'revoked', { timeout: 30_000 });

  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto(publicPath);
  await expect(vp.getByTestId('press-gone')).toBeVisible({ timeout: 60_000 });
  const token = publicPath.split('/')[2];
  expect((await visitor.request.get(`${baseURL}/api/press/${token}`)).status()).toBe(404);
  await visitor.close();
  await ctx.close();

  // Events: ids and field names, never words, URLs or addresses.
  const events = (await rest(request, 'GET', `activity_events?select=verb,payload,visibility&org_id=eq.${ORG}&verb=like.press*`)) as { verb: string; payload: unknown; visibility: string }[];
  expect(events.map((e) => e.verb)).toEqual(expect.arrayContaining(['press_kit.created', 'press_kit.updated', 'press_kit.shared', 'press_kit.share_revoked', 'press_outreach.added', 'press_outreach.updated']));
  expect(events.every((e) => e.visibility === 'internal')).toBe(true);
  const blob = JSON.stringify(events);
  for (const leak of [BIO, LINE, 'instagram', 'quiet.example', 'Pat Press', 'example.com', publicPath.split('/')[2]]) expect(blob, leak).not.toContain(leak);
});

test('5 · other roles: the marketing member and the artist have no Press section and no route', async ({ browser, baseURL }) => {
  for (const who of [marketing, artist]) {
    const ctx = await as(browser, baseURL!, who.id, who.email);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}/releases/${ids.release}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Night Shift ${run}`) }).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('press-kit')).toHaveCount(0);
    expect((await ctx.request.get(`${baseURL}${pressApi()}`)).status()).toBe(403);
    expect((await ctx.request.put(`${baseURL}${pressApi()}`, { data: { headline: 'x' } })).status()).toBe(403);
    expect((await ctx.request.post(`${baseURL}${pressApi()}/shares`, { data: { label: 'x' } })).status()).toBe(403);
    await ctx.close();
  }
});

test('6 · the owner’s directory filters press contacts; the producer dashboard and /store still load', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);
  const filter = page.getByTestId('press-contacts-filter');
  await expect(filter).toBeVisible({ timeout: 90_000 });
  await filter.getByRole('button', { name: /Press contacts · 1/ }).click();
  await expect(page.getByTestId(`contact-${PRESS_PERSON}`)).toBeVisible();
  await page.screenshot({ path: `${shots}/directory-press-1440.png`, fullPage: true });

  const store = await ctx.request.get(`${baseURL}/store`);
  expect(store.status()).toBe(200);
  await ctx.close();
});
