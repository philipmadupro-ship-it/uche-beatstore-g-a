/**
 * The admin centre (docs/bstudio-label-os/25-team-accounts.md, phase 3)
 * against a REAL database (scripts/local-db, LABEL_OS_ENABLED=true): the owner
 * opens it from the nav, sees the team in numbers, the seat cap from a real
 * licence row, a team account waiting on its password and the team change
 * that made it, and reaches every management page from it. An admin is not
 * shown the owner-only pages; a department member is not shown the centre and
 * the route refuses them. At 390 px nothing scrolls sideways.
 *
 * Cast: PRODUCER owns the label; ARTIST_A is admin; BUYER is a marketing member.
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ARTIST_A_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const AUTH = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `admin-${run}`;
const STAFF_NAME = `Lee ${run}`;
let staffId = '';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Admin Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'admin', functions: [], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  // A real licence row (6 seats, 10 artists), written the only way one can be: the operator's function (the seed makes the producer an operator).
  const licence = (await rest(request, 'POST', 'rpc/labelos_platform_set_entitlements', {
    p_actor: PRODUCER_ID, p_org: ORG, p_modules: ['finance', 'marketing', 'digest', 'export'], p_max_seats: 6, p_max_artists: 10, p_payload: {},
  })) as { error?: string };
  expect(licence.error).toBeUndefined();
  await rest(request, 'POST', 'contacts', { id: randomUUID(), org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
});

test.afterAll(async ({ request }) => {
  await request.fetch(`${REST}/organizations?id=eq.${ORG}`, { method: 'DELETE', headers: AUTH });
  await request.fetch(`${REST}/org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID].join(',')})`, { method: 'DELETE', headers: AUTH });
  if (staffId) await request.fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${staffId}`, { method: 'DELETE', headers: AUTH });
});

test('the owner opens the admin centre from the nav and sees the team, the licence and the last change', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  // A team account through the real route, so the centre has something waiting on a password.
  const created = await ctx.request.post(`/api/org/${ORG}/team-accounts`, {
    data: { email: `lee-${run}@label.test`, name: STAFF_NAME, password: 'test-secret-pass', role: 'member', functions: ['finance'] },
  });
  expect(created.status(), await created.text()).toBe(201);
  staffId = (await created.json()).member.user_id;

  const eventCount = async () => ((await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&select=id`)) as unknown[]).length;
  const before = await eventCount();

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);
  // Reached from the nav's Organization hub, and from the members page.
  await expect(page.getByRole('link', { name: 'Admin centre' })).toHaveAttribute('href', `/o/${SLUG}/settings`);
  await page.getByRole('navigation').getByRole('button', { name: 'Organization' }).click();
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/settings$`));
  await expect(page.getByRole('heading', { name: 'Admin centre' })).toBeVisible();

  await expect(page.getByTestId('admin-stat-team')).toContainText('4 people');
  await expect(page.getByTestId('admin-stat-team')).toContainText('1 owner · 1 admin · 2 in departments');
  await expect(page.getByTestId('admin-stat-seats')).toContainText('4 of 6 seats');
  await expect(page.getByTestId('admin-stat-artists')).toContainText('1 of 10 artists');
  await expect(page.getByTestId('admin-accounts')).toContainText('1 team account has not chosen a password yet.');
  await expect(page.getByTestId('admin-recent')).toContainText(`created a team account · ${STAFF_NAME}`);
  await expect(page.getByTestId('admin-licence')).toContainText('Finance');
  await expect(page.getByTestId('admin-licence')).toContainText('Marketing');
  await expect(page.getByTestId('admin-licence')).not.toContainText('Contracts & legal');

  // Every management page is one click away, the owner-only ones included.
  for (const key of ['team', 'roster', 'connections', 'settings', 'digest', 'data']) await expect(page.getByTestId(`admin-section-${key}`)).toBeVisible();
  await page.getByTestId('admin-section-settings').click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/settings/organization$`));
  await expect(page.getByRole('heading', { name: 'Organization settings' })).toBeVisible();

  // Reading the centre wrote nothing.
  expect(await eventCount()).toBe(before);
  await ctx.close();
});

test('an admin sees the centre without the owner-only pages; at 390 px nothing scrolls sideways', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signedIn(ctx, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings`);
  await expect(page.getByTestId('admin-section-team')).toBeVisible();
  await expect(page.getByTestId('admin-stat-seats')).toContainText('4 of 6 seats');
  await expect(page.getByTestId('admin-section-settings')).toHaveCount(0);
  await expect(page.getByTestId('admin-section-data')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test('a department member gets no centre: no nav entry, told so on the page, refused by the route', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings`);
  await expect(page.getByTestId('admin-denied')).toBeVisible();
  await expect(page.getByTestId('admin-centre')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Organization' }).click();
  await expect(page.getByRole('link', { name: 'Members', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
  const res = await ctx.request.get(`/api/org/${ORG}/admin`);
  expect([403, 404]).toContain(res.status());
  await ctx.close();
});
