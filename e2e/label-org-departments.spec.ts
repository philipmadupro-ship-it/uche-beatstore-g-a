/**
 * Departments and capabilities (LABEL-49, migration 171) end to end against a
 * REAL database (scripts/local-db, LABEL_OS_ENABLED=true from env.sh).
 *
 * No department has pages yet, so what a person can SEE of the new functions
 * and capabilities is the members page (function picker, ability switches),
 * the routes that read membership, and the licence (LABEL-47) that removes a
 * module's capabilities. This proves, in a browser against RLS-backed Postgres:
 *  - the owner can give a member each new function and switch the new
 *    abilities on, from the UI, and the stored row says so;
 *  - a member holding a department function reaches the shell and nothing
 *    more (members page read-only, 403 on every change), a member with no
 *    catalogue is still refused;
 *  - a roster artist cannot be given any new function or ability: the page
 *    does not offer one and the route answers 400;
 *  - a licence without the finance module removes the finance switches;
 *  - the producer dashboard and /store are untouched.
 *
 * Cast: PRODUCER owns the label; BUYER is the member whose functions change;
 * ARTIST_A is a roster artist.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { ARTIST_A_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `departments-${run}`;
const MEMBERS = `/o/${SLUG}/settings/members`;
const SHOTS = 'e2e-artifacts/LABEL-49';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

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

const setFunctions = (request: APIRequestContext, functions: string[]) =>
  rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, { functions, cap_grants: [], cap_revokes: [] });

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Close an open menu the way a person would: Escape, or a click beside it when focus had left it. */
async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  const menu = page.getByRole('menu');
  if (await menu.isVisible()) await page.mouse.click(5, 450);
  await expect(menu).toHaveCount(0);
}

const NEW_FUNCTIONS = ['Finance', 'PR & press', 'Executive', 'Artistic director', 'Contracts'];
const NEW_ABILITY_LABELS = [
  'Edit finance', 'Approve statements', 'See PR', 'Run PR', 'Executive overview',
  'See creative direction', 'Approve creative direction', 'Draft contracts', 'Sign contracts',
];

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Departments ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['operations'], scope: 'org', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID });
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${BUYER_ID},${ARTIST_A_ID})`);
  await rest(request, 'POST', 'user_profiles', [
    { user_id: BUYER_ID, display_name: 'Dana Buyer' },
    { user_id: ARTIST_A_ID, display_name: 'Nova Artist' },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test.describe('at 1440 and 390', () => {
  for (const width of [1440, 390]) {
    test(`the owner gives a member each new function and ability, from the page (${width}px)`, async ({ browser, baseURL, request }) => {
      await setFunctions(request, ['operations']);
      const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
      await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
      const page = await ctx.newPage();
      await page.goto(MEMBERS);
      const dana = page.getByTestId(`member-${BUYER_ID}`);
      await expect(dana).toContainText('Dana Buyer', { timeout: 30_000 });

      // The picker offers every new function.
      await dana.getByRole('button', { name: 'Actions for Dana Buyer' }).click();
      for (const label of NEW_FUNCTIONS) await expect(page.getByRole('menuitemcheckbox', { name: label })).toBeVisible();
      await page.getByRole('menuitemcheckbox', { name: 'Executive' }).click();
      await expect(dana).toContainText('Executive');
      await closeMenu(page);
      let [row] = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}&select=functions`);
      expect(row.functions).toEqual(['operations', 'Executive'.toLowerCase()]);

      // Every new ability is a switch on a member.
      await dana.getByRole('button', { name: 'Abilities' }).click();
      for (const label of NEW_ABILITY_LABELS) await expect(page.getByRole('switch', { name: new RegExp(label) })).toBeVisible();
      await shot(page, `members-abilities-${width}`);
      // The executive reads finance; approving statements is one deliberate switch.
      await expect(page.getByRole('switch', { name: /See finance/ })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('switch', { name: /Approve statements/ })).toHaveAttribute('aria-checked', 'false');
      await page.getByRole('switch', { name: /Approve statements/ }).click();
      await expect(page.getByRole('switch', { name: /Approve statements/ })).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      [row] = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}&select=cap_grants`);
      expect(row.cap_grants).toEqual(['finance.approve']);
      await ctx.close();
    });
  }
});

test('a member with an executive function reaches the shell and can change nothing', async ({ browser, baseURL, request }) => {
  await setFunctions(request, ['executive']);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'executive-overview');
  expect((await page.request.get(`/api/org/${ORG}/members`)).status()).toBe(200);
  expect((await page.request.patch(`/api/org/${ORG}/members`, { data: { user_id: BUYER_ID, functions: ['finance'] } })).status()).toBe(403);
  expect((await page.request.patch(`/api/org/${ORG}/members`, { data: { user_id: BUYER_ID, cap_grants: ['finance.approve'] } })).status()).toBe(403);
  await ctx.close();
});

test('a member with no catalogue (operations) is still refused where the catalogue is needed', async ({ browser, baseURL, request }) => {
  await setFunctions(request, ['operations']);
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  const page = await ctx.newPage();
  expect((await page.request.get(`/api/org/${ORG}/contacts`)).status()).toBe(403);
  await ctx.close();
});

test('a department function with a catalogue read is not refused there', async ({ browser, baseURL, request }) => {
  for (const fn of ['finance', 'pr', 'artistic_director', 'contracts']) {
    await setFunctions(request, [fn]);
    const ctx = await browser.newContext();
    await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
    const page = await ctx.newPage();
    expect((await page.request.get(`/api/org/${ORG}/contacts`)).status(), fn).toBe(200);
    await ctx.close();
  }
});

test('a roster artist cannot be given any new function or ability', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(MEMBERS);
  const nova = page.getByTestId(`member-${ARTIST_A_ID}`);
  await expect(nova).toContainText('Nova Artist', { timeout: 30_000 });

  // The page offers no new switch for her ...
  await nova.getByRole('button', { name: 'Abilities' }).click();
  for (const label of [...NEW_ABILITY_LABELS, 'See finance', 'Open contracts']) {
    await expect(page.getByRole('switch', { name: new RegExp(label) })).toHaveCount(0);
  }
  await shot(page, 'roster-artist-abilities');
  await page.keyboard.press('Escape');

  // ... and the route refuses every one, abilities and functions alike.
  for (const cap of ['finance.read', 'finance.write', 'finance.approve', 'pr.read', 'pr.write', 'exec.read', 'creative.read', 'creative.approve', 'contracts.read', 'contracts.write', 'contracts.sign']) {
    const res = await page.request.patch(`/api/org/${ORG}/members`, { data: { user_id: ARTIST_A_ID, cap_grants: [cap] } });
    expect(res.status(), cap).toBe(400);
  }
  for (const fn of ['finance', 'pr', 'executive', 'artistic_director', 'contracts']) {
    const res = await page.request.patch(`/api/org/${ORG}/members`, { data: { user_id: ARTIST_A_ID, functions: [fn] } });
    expect(res.status(), fn).toBe(400);
  }
  const [row] = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${ARTIST_A_ID}&select=functions,cap_grants`);
  expect(row).toEqual({ functions: [], cap_grants: [] });
  await ctx.close();
});

test('a licence without finance removes the finance switches, the owner keeps the rest', async ({ browser, baseURL, request }) => {
  await setFunctions(request, ['executive']);
  // The seed makes the producer a platform operator; the licence is set through the console's own function.
  await rest(request, 'POST', 'rpc/labelos_platform_set_entitlements', {
    p_actor: PRODUCER_ID, p_org: ORG, p_modules: ['contracts', 'pr', 'executive', 'artistic', 'export'],
    p_max_seats: null, p_max_artists: null, p_payload: { modules: ['contracts', 'pr', 'executive', 'artistic', 'export'] },
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(MEMBERS);
  const dana = page.getByTestId(`member-${BUYER_ID}`);
  await expect(dana).toContainText('Dana Buyer', { timeout: 30_000 });
  await dana.getByRole('button', { name: 'Abilities' }).click();
  await expect(page.getByRole('switch', { name: /Executive overview/ })).toBeVisible();
  await expect(page.getByRole('switch', { name: /Edit finance/ })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: /Approve statements/ })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: /See finance/ })).toHaveCount(0);
  await shot(page, 'licence-without-finance');
  await ctx.close();
  await rest(request, 'POST', 'rpc/labelos_platform_set_entitlements', {
    p_actor: PRODUCER_ID, p_org: ORG, p_modules: ['contracts', 'finance', 'marketing', 'pr', 'executive', 'artistic', 'store', 'search', 'digest', 'export'],
    p_max_seats: null, p_max_artists: null, p_payload: {},
  });
});

test('the producer dashboard and the public store are untouched', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  const lib = await page.goto('/library');
  expect(lib?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/library/);
  await shot(page, 'producer-library');
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const store = await (await anon.newPage()).goto('/store');
  expect(store?.status()).toBe(200);
  const storePage = anon.pages()[0];
  await shot(storePage, 'store');
  await ctx.close();
  await anon.close();
});
