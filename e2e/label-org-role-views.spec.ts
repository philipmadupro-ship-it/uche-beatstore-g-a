/**
 * Role views (LABEL-70) end to end against a REAL database (scripts/local-db,
 * LABEL_OS_ENABLED=true from env.sh): the persona matrix, role × face, at 1440
 * and 390 px. For each persona: the home it lands on (tiles for the artist
 * shapes, the roster Overview for label staff), the nav wording, and that the
 * pages it may not open answer a real 404.
 *
 * Cast: PRODUCER owns an independent artist org (kind artist) and a label;
 * BUYER is label finance staff; ARTIST_B is label marketing staff; ARTIST_A
 * is a label roster artist (role artist).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const IND = randomUUID();
const LAB = randomUUID();
const IND_SLUG = `role-ind-${run}`;
const LAB_SLUG = `role-lab-${run}`;
const SHOTS = 'e2e-artifacts/LABEL-70';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

async function rest(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function status(page: Page, path: string): Promise<number> {
  const res = await page.goto(path);
  return res?.status() ?? 0;
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${BUYER_ID},${ARTIST_A_ID},${ARTIST_B_ID})`);
  await rest(request, 'POST', 'organizations', { id: IND, name: `Nova Solo ${run}`, slug: IND_SLUG, kind: 'artist', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'organizations', { id: LAB, name: `Night Shift ${run}`, slug: LAB_SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: IND, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: LAB, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: LAB, user_id: BUYER_ID, role: 'member', functions: ['finance'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: LAB, user_id: ARTIST_B_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: LAB, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${BUYER_ID},${ARTIST_A_ID},${ARTIST_B_ID})`);
  await rest(request, 'POST', 'user_profiles', [
    { user_id: BUYER_ID, display_name: 'Dana Finance' },
    { user_id: ARTIST_A_ID, display_name: 'Nova Artist' },
    { user_id: ARTIST_B_ID, display_name: 'Max Marketing' },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=in.(${IND},${LAB})`);
});

const TILES = (page: Page) => page.getByTestId('role-home').getByRole('link');

for (const width of [1440, 390]) {
  test.describe(`at ${width}px`, () => {
    const viewport = { width, height: width > 500 ? 900 : 844 };

    async function as(browser: import('@playwright/test').Browser, baseURL: string, id: string, email: string) {
      const ctx = await browser.newContext({ viewport });
      await signedIn(ctx, baseURL, id, email);
      return { ctx, page: await ctx.newPage() };
    }

    test('independent artist owner: my music / releases / money / contracts; no A&R, no Legal queue', async ({ browser, baseURL }) => {
      const { ctx, page } = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
      await page.goto(`/o/${IND_SLUG}`);
      await expect(page.getByTestId('role-home')).toBeVisible({ timeout: 60_000 });
      await expect(TILES(page)).toHaveText([/My music/, /My releases/, /My money/, /My contracts/, /Artistic direction/]);
      await expect(page.getByTestId('overview')).toHaveCount(0);
      await shot(page, `independent-home-${width}`);
      expect(await status(page, `/o/${IND_SLUG}/ar`)).toBe(404);
      expect(await status(page, `/o/${IND_SLUG}/rights/legal`)).toBe(404);
      expect(await status(page, `/o/${IND_SLUG}/music`)).toBe(200);
      expect(await status(page, `/o/${IND_SLUG}/creative`)).toBe(200);
      await ctx.close();
    });

    test('label owner keeps the label shell: roster Overview, A&R inbox and Legal queue open', async ({ browser, baseURL }) => {
      const { ctx, page } = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
      await page.goto(`/o/${LAB_SLUG}`);
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('role-home')).toHaveCount(0);
      await shot(page, `label-owner-home-${width}`);
      expect(await status(page, `/o/${LAB_SLUG}/ar`)).toBe(200);
      expect(await status(page, `/o/${LAB_SLUG}/rights/legal`)).toBe(200);
      await ctx.close();
    });

    test('label finance staff: earnings open, legal queue and contracts are 404', async ({ browser, baseURL }) => {
      const { ctx, page } = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
      await page.goto(`/o/${LAB_SLUG}`);
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 60_000 });
      await shot(page, `finance-home-${width}`);
      expect(await status(page, `/o/${LAB_SLUG}/finance/earnings`)).toBe(200);
      expect(await status(page, `/o/${LAB_SLUG}/rights/legal`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/rights/contracts`)).toBe(404);
      await ctx.close();
    });

    test('label marketing staff: no earnings, no legal queue', async ({ browser, baseURL }) => {
      const { ctx, page } = await as(browser, baseURL!, ARTIST_B_ID, 'artist-b@local.test');
      expect(await status(page, `/o/${LAB_SLUG}/finance/earnings`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/creative`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/finance/statements`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/rights/legal`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/music`)).toBe(200);
      await ctx.close();
    });

    test('roster artist: "My music" home, no money tile; A&R, earnings and legal queue are 404', async ({ browser, baseURL }) => {
      const { ctx, page } = await as(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
      await page.goto(`/o/${LAB_SLUG}`);
      await expect(page.getByTestId('role-home')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('home-tile-music')).toBeVisible();
      await expect(page.getByTestId('home-tile-statements')).toBeVisible();
      await shot(page, `roster-artist-home-${width}`);
      expect(await status(page, `/o/${LAB_SLUG}/finance/statements`)).toBe(200);
      expect(await status(page, `/o/${LAB_SLUG}/creative`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/ar`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/finance/earnings`)).toBe(404);
      expect(await status(page, `/o/${LAB_SLUG}/rights/legal`)).toBe(404);
      await ctx.close();
    });

    test('the producer dashboard and /store still load', async ({ browser, baseURL }) => {
      const { ctx, page } = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
      expect(await status(page, '/library')).toBe(200);
      expect(await status(page, '/store')).toBe(200);
      await shot(page, `library-${width}`);
      await ctx.close();
    });
  });
}
