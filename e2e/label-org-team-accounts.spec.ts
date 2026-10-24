/**
 * Team accounts (docs/bstudio-label-os/25-team-accounts.md, phase 1), against
 * a REAL database (scripts/local-db, LABEL_OS_ENABLED=true from env.sh): the
 * owner creates a marketing login from the members page; the person signs in
 * with it through the real /login form, is made to choose their own password,
 * and lands in the label; the owner can set a new password and switch the
 * account off, after which sign-in is refused. An address that already has an
 * account is never touched. Only the org and its owner row are seeded.
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
const SLUG = `team-${run}`;
const STAFF_EMAIL = `mkt-${run}@label.test`;
const STAFF_NAME = `Mia ${run}`;
const OWN_PASSWORD = `my-own-secret-${run}`;

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });

let issued = '';
let staffId = '';

async function rest(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${path}`, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Team ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
});

test.afterAll(async ({ request }) => {
  await request.fetch(`${REST}/organizations?id=eq.${ORG}`, { method: 'DELETE', headers: AUTH });
  if (staffId) await request.fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${staffId}`, { method: 'DELETE', headers: AUTH });
});

test('the owner creates a marketing account from the members page', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);

  await page.getByRole('button', { name: 'Create account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a team account' });
  await dialog.getByLabel('Name').fill(STAFF_NAME);
  await dialog.getByLabel('Email address').fill(STAFF_EMAIL);
  await dialog.getByRole('button', { name: 'Marketing' }).click();
  await dialog.getByRole('button', { name: 'Create account' }).click();

  // The password is shown once, to hand over.
  await expect(dialog.getByTestId('team-account-handover')).toBeVisible();
  issued = (await dialog.getByTestId('team-account-password').textContent())?.trim() ?? '';
  expect(issued).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const row = page.getByText(STAFF_NAME).locator('xpath=ancestor::*[starts-with(@data-testid, "member-")][1]');
  await expect(row).toContainText('Marketing');
  await expect(row).toContainText('Must set password');

  // The database holds the membership and the record that the org made this account, never the password.
  const members = (await rest(request, 'GET', `org_members?org_id=eq.${ORG}&role=eq.member&select=user_id,functions`)) as { user_id: string; functions: string[] }[];
  expect(members).toHaveLength(1);
  expect(members[0].functions).toEqual(['marketing']);
  staffId = members[0].user_id;
  const managed = (await rest(request, 'GET', `org_managed_accounts?user_id=eq.${staffId}&select=org_id,must_change_password`)) as unknown[];
  expect(managed).toEqual([{ org_id: ORG, must_change_password: true }]);
  const events = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.member.account_created&select=payload`)) as { payload: unknown }[];
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(issued);

  // An address that already has an account is refused, and that account is untouched.
  await page.getByRole('button', { name: 'Create account' }).click();
  await dialog.getByLabel('Name').fill('Someone');
  await dialog.getByLabel('Email address').fill('buyer@local.test');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already has an account');
  await ctx.close();
});

test('the person signs in with it, must choose their own password, and lands in the label', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signInWithPassword(page, STAFF_EMAIL, issued);
  await expect(page).toHaveURL(/\/account\/password$/);
  // Typing before hydration is reset by React; wait for the page to settle.
  await page.waitForLoadState('networkidle');

  // Until they choose their own, nothing else in Label OS answers them: not the API, not a page.
  const blocked = await page.request.get(`/api/org/${ORG}/members`);
  expect(blocked.status()).toBe(403);
  expect(await blocked.json()).toMatchObject({ mustChangePassword: true });
  const other = await page.context().newPage();
  await other.goto(`/o/${SLUG}/settings/members`);
  await expect(other).toHaveURL(/\/account\/password$/);
  await other.close();

  await page.getByLabel('New password').fill(OWN_PASSWORD);
  await expect(page.getByLabel('New password')).toHaveValue(OWN_PASSWORD);
  await page.getByLabel('Type it again').fill(OWN_PASSWORD);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.request.get(`/api/org/${ORG}/members`)).status()).toBe(200);

  // A team account stays in its label: it cannot set up an organization of its own.
  const own = await page.request.post('/api/org/setup', { data: { face: 'label', name: `Side ${run}` } });
  expect(own.status()).toBe(409);
  expect((await own.json()).code).toBe('team_account');
  await ctx.close();

  // The old password no longer works; their own does, straight into the label.
  const again = await browser.newContext();
  const p2 = await again.newPage();
  await signInWithPassword(p2, STAFF_EMAIL, issued);
  await expect(p2.getByText('Invalid login credentials')).toBeVisible();
  await signInWithPassword(p2, STAFF_EMAIL, OWN_PASSWORD);
  await expect(p2).toHaveURL(new RegExp(`/o/${SLUG}`));
  await again.close();
});

test('the owner sets a new password, then switches the account off', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);

  await page.getByRole('button', { name: `Actions for ${STAFF_NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Set a new password…' }).click();
  const dialog = page.getByRole('dialog', { name: `New password for ${STAFF_NAME}` });
  await dialog.getByRole('button', { name: 'Set new password' }).click();
  await expect(dialog.getByTestId('team-account-handover')).toBeVisible();
  const reset = (await dialog.getByTestId('team-account-password').textContent())?.trim() ?? '';
  await dialog.getByRole('button', { name: 'Done' }).click();
  expect(((await rest(request, 'GET', `org_managed_accounts?user_id=eq.${staffId}&select=must_change_password`)) as unknown[])[0]).toEqual({ must_change_password: true });

  await page.getByRole('button', { name: `Actions for ${STAFF_NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Switch account off' }).click();
  await page.getByRole('button', { name: 'Switch off', exact: true }).click();
  await expect(page.getByText('Switched off', { exact: true })).toBeVisible();
  await ctx.close();

  // Switched off: even the fresh password is refused.
  const staff = await browser.newContext();
  const p = await staff.newPage();
  await signInWithPassword(p, STAFF_EMAIL, reset);
  await expect(p.getByText('Invalid login credentials')).toBeVisible();
  await staff.close();

  const verbs = ((await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&subject_id=eq.${staffId}&select=verb&order=created_at`)) as { verb: string }[]).map((e) => e.verb);
  expect(verbs).toEqual(['member.account_created', 'member.password_changed', 'member.password_reset', 'member.account_disabled']);
});
