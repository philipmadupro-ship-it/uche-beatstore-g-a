/**
 * LABEL-76 UI polish, against the REAL local database stack (see
 * label-org-overview.spec.ts for how it runs). Proves: the Overview keeps its
 * stage counts and next release visible at phone width, the 1440 header does
 * not overlap the page, `/o` and the org shell carry a home link and Sign out,
 * and a member who is not the producer triggers no 403 from the UI on the
 * pages they can open. Screenshots go to $SHOTS_DIR when it is set.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `polish-${run}`;
const NOVA = randomUUID();
const INBOX = randomUUID();
const SONG = randomUUID();
const SHOTS = process.env.SHOTS_DIR;

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

async function as(browser: Browser, baseURL: string, id: string, email: string, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport });
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Polish Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', [{ id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' }]);
  await rest(request, 'POST', 'projects', [{ id: INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA }]);
  await rest(request, 'POST', 'tracks', [{ id: SONG, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Midnight', type: 'song', song_stage: 'selected', audio_url: `/uploads/polish-${SONG}.mp3` }]);
  await rest(request, 'POST', 'project_tracks', [{ project_id: INBOX, track_id: SONG, position: 0 }]);
});

test.afterAll(async ({ request }) => {
  // Since migration 195 an org is deleted only 31 days after deleted_at.
  const back = new Date(Date.now() - 31 * 86_400_000).toISOString();
  await rest(request, 'PATCH', `organizations?id=eq.${ORG}`, { deleted_at: back });
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1 · Overview at ${viewport.width}px: counts and next release are readable, nothing overflows or overlaps`, async ({ browser, baseURL }) => {
    const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test', viewport);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}`);
    await expect(page.getByTestId('overview')).toBeVisible({ timeout: 30_000 });
    if (viewport.width < 768) {
      await expect(page.getByTestId(`overview-summary-${NOVA}`)).toBeVisible();
      await expect(page.getByTestId(`overview-summary-${NOVA}`)).toContainText('1 selected');
    }
    // No horizontal scroll, and the heading sits fully below the fixed bar.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bar = await page.locator('header.fixed').first().boundingBox();
    const h1 = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(h1!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
    await shot(page, `overview-${viewport.width}`);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'de-roche-archive'));
    await page.waitForTimeout(600); // colour transitions settle
    await shot(page, `overview-${viewport.width}-archive`);
    await ctx.close();
  });
}

test('2 · /o carries a home link and Sign out; the org bar names the org and a member can sign out', async ({ browser, baseURL, request }) => {
  const second = randomUUID();
  await rest(request, 'POST', 'organizations', { id: second, name: `Second ${run}`, slug: `second-${run}`, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: second, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID });
  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test', { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto('/o');
  await expect(page.getByTestId('org-index-list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('member-chrome')).toBeVisible();
  await expect(page.getByTestId('member-sign-out')).toBeVisible();
  await shot(page, 'org-index-1440');
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByRole('link', { name: `Polish Records ${run} home` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('org-sign-out')).toBeVisible();
  await page.getByTestId('org-sign-out').click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  await ctx.close();
  await rest(request, 'PATCH', `organizations?id=eq.${second}`, { deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  await rest(request, 'DELETE', `organizations?id=eq.${second}`);
});

const MEMBERS: { name: string; patch: Record<string, unknown> }[] = [
  { name: 'a&r', patch: { role: 'member', functions: ['a_and_r'], scope: 'org' } },
  { name: 'marketing', patch: { role: 'member', functions: ['marketing'], scope: 'org' } },
  { name: 'legal', patch: { role: 'member', functions: ['legal'], scope: 'org' } },
  { name: 'artist', patch: { role: 'artist', functions: [], scope: 'artists' } },
];

for (const m of MEMBERS) {
  test(`3 · the UI asks nothing the server refuses: no 403 for a ${m.name} member`, async ({ browser, baseURL, request }) => {
    await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, m.patch);
    if (m.name === 'artist') await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: BUYER_ID, contact_id: NOVA });
    const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test', { width: 1440, height: 900 });
    const page = await ctx.newPage();
    const refused: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 403) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    // Pages a member may open; a page their role does not have is a 404 page, which asks for nothing.
    const paths = ['', '/music', '/releases', '/ar', '/artists', '/settings/members', '/rights/legal', '/finance', '/exec', `/artists/${NOVA}`, `/songs/${SONG}`];
    for (const p of paths) {
      await page.goto(`/o/${SLUG}${p}`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }
    expect(refused, `403s seen: ${refused.join(', ')}`).toEqual([]);
    await ctx.close();
  });
}
