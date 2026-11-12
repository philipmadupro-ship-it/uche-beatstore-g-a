/**
 * Sign-out for everyone (go-live): against a REAL database (scripts/local-db,
 * LABEL_OS_ENABLED=true from env.sh), at 1440 and 390.
 *
 *   - a marketing member signs in, lands on /o/<slug>, signs out from the org
 *     shell, signs in again and lands back on /o/<slug>;
 *   - a team account on its first password is sent to /account/password, signs
 *     out from there, signs in again, is sent there again, chooses a password
 *     and lands in the org;
 *   - the producer signs out from /library and is back on /library once signed in.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const AUTH = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `signout-${run}`;
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });

const created: string[] = [];

async function rest(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${path}`, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
}

/** A team account made through the real owner route; returns its first password. */
async function makeAccount(browser: import('@playwright/test').Browser, baseURL: string, email: string, password: string, functions: string[]) {
  const ctx = await browser.newContext();
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  const res = await ctx.request.post(`/api/org/${ORG}/team-accounts`, {
    data: { email, name: `Person ${email.split('@')[0]}`, password, role: 'member', functions },
  });
  expect(res.status(), await res.text()).toBe(201);
  const made = (await res.json()) as { member?: { user_id?: string } };
  created.push(made.member?.user_id ?? '');
  await ctx.close();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

async function choosePassword(page: Page, password: string) {
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Type it again').fill(password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

/** Sign out the way a person at this width would: the account menu, or the drawer. */
async function signOutFromShell(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
  } else {
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
  }
  await expect(page).toHaveURL(/\/login/);
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Signout ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
});

test.afterAll(async ({ request }) => {
  await request.fetch(`${REST}/organizations?id=eq.${ORG}`, { method: 'DELETE', headers: AUTH });
  for (const id of created.filter(Boolean)) await request.fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: AUTH });
});

for (const vp of VIEWPORTS) {
  const mobile = vp.width < 500;
  const tag = `${vp.width}`;

  test(`a marketing member signs out and back in @${tag}`, async ({ browser, baseURL }) => {
    const email = `mkt-${tag}-${run}@label.test`;
    const first = `first-secret-${tag}-${run}`;
    const own = `own-secret-${tag}-${run}`;
    await makeAccount(browser, baseURL!, email, first, ['marketing']);

    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await signIn(page, email, first);
    await choosePassword(page, own);
    await expect(page).toHaveURL(new RegExp(`/o/${SLUG}`));

    await signOutFromShell(page, mobile);
    // The session is really gone: the org's API and pages refuse.
    expect((await page.request.get(`/api/org/${ORG}/members`, { failOnStatusCode: false })).status()).toBeGreaterThanOrEqual(401);

    await signIn(page, email, own);
    await expect(page).toHaveURL(new RegExp(`/o/${SLUG}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ctx.close();
  });

  test(`a team account on its first password signs out from /account/password @${tag}`, async ({ browser, baseURL }) => {
    const email = `team-${tag}-${run}@label.test`;
    const first = `first-secret-${tag}-${run}`;
    const own = `own-secret-${tag}-${run}`;
    await makeAccount(browser, baseURL!, email, first, ['marketing']);

    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await signIn(page, email, first);
    await expect(page).toHaveURL(/\/account\/password$/);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, email, first);
    await choosePassword(page, own);
    await expect(page).toHaveURL(new RegExp(`/o/${SLUG}`));
    await ctx.close();
  });

  test(`the producer signs out from /library @${tag}`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: vp });
    const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
    await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto('/library');
    await expect(page).toHaveURL(/\/library/);
    await signOutFromShell(page, mobile);

    // Signed in again (the producer signs in with Google; the local stack hands over the same cookie), back on /library.
    await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/library/);
    await ctx.close();
  });
}
