/**
 * Self-service setup (LABEL-48, first slice): a signed-in account that is
 * neither the producer nor a member of anything is sent to /setup, picks
 * "Independent artist / producer" or "Label", names it, and lands in the new
 * org. Against a REAL database (scripts/local-db, LABEL_OS_ENABLED=true from
 * env.sh): migration 189's `labelos_setup_org` through the real route, and
 * 139's trigger for the artist org's one roster artist. Nothing is seeded
 * with the service key except the clean-up.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, ARTIST_A_ID, ARTIST_B_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const AUTH = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${REST}/${path}`, { headers: AUTH });
  expect(res.ok(), `GET ${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Only the orgs this spec made (slug carries the run id): other specs' rows are never touched. */
async function cleanUp(request: APIRequestContext) {
  await request.fetch(`${REST}/organizations?slug=like.*${run}*`, { method: 'DELETE', headers: AUTH });
}

/** The account must start as a non-member with no self-made org, or the journey is not this one. */
async function skipUnlessFresh(request: APIRequestContext, userId: string) {
  const members = await get<unknown[]>(request, `org_members?user_id=eq.${userId}&select=org_id`);
  const made = await get<unknown[]>(request, `organizations?created_by=eq.${userId}&kind=in.(artist,label)&deleted_at=is.null&select=id`);
  test.skip(members.length > 0 || made.length > 0, 'the seed account already belongs to an org');
}

async function signedIn(browser: Browser, baseURL: string, id: string, email: string, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

test.afterAll(async ({ request }) => cleanUp(request));

test('an independent artist signs in, is sent to setup and lands in their own artist org (1440)', async ({ browser, baseURL, request }) => {
  await skipUnlessFresh(request, ARTIST_A_ID);
  const ctx = await signedIn(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test', { width: 1440, height: 900 });
  const page = await ctx.newPage();

  // /login and dashboard paths no longer dead-end on the buyer page.
  await page.goto('/login');
  await expect(page).toHaveURL(/\/setup$/);

  // A blank name is refused in the page; nothing is created.
  await page.getByTestId('face-independent').click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByTestId('org-setup-form').getByRole('alert')).toContainText('name');
  expect(await get<unknown[]>(request, `organizations?created_by=eq.${ARTIST_A_ID}&select=id`)).toHaveLength(0);

  const name = `Nova ${run}`;
  await page.getByLabel('Artist name').fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/nova-${run}`));

  const [org] = await get<{ id: string; kind: string; name: string }[]>(request, `organizations?slug=eq.nova-${run}&select=id,kind,name`);
  expect(org).toMatchObject({ kind: 'artist', name });
  expect(await get<{ role: string }[]>(request, `org_members?org_id=eq.${org.id}&select=role,user_id`)).toEqual([{ role: 'owner', user_id: ARTIST_A_ID }]);
  // The org's one roster artist, from 139's trigger, with the account's email.
  expect(await get<unknown[]>(request, `contacts?org_id=eq.${org.id}&select=name,email,category`)).toEqual([
    { name, email: 'artist-a@local.test', category: 'artist' },
  ]);

  // Now a member: /setup sends them on to their org instead of offering a second one.
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/o(\/|$)/);
  await ctx.close();
});

test('a label picked at sign-up arrives preselected, is created once, and opens (390)', async ({ browser, baseURL, request }) => {
  await skipUnlessFresh(request, ARTIST_B_ID);
  const ctx = await signedIn(browser, baseURL!, ARTIST_B_ID, 'artist-b@local.test', { width: 390, height: 844 });
  const page = await ctx.newPage();

  await page.goto('/setup?type=label');
  await expect(page.locator('input[value="label"]')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const name = `Northside ${run}`;
  await page.getByLabel('Label name').fill(name);
  await page.getByRole('button', { name: 'Create label' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/northside-${run}`));

  const orgs = await get<{ id: string; kind: string }[]>(request, `organizations?created_by=eq.${ARTIST_B_ID}&kind=eq.label&select=id,kind`);
  expect(orgs).toHaveLength(1);
  expect(await get<unknown[]>(request, `contacts?org_id=eq.${orgs[0].id}&select=id`)).toHaveLength(0);

  // Asking again (a double click, a retry) answers the same org, never a second one.
  const again = await page.request.post('/api/org/setup', { data: { face: 'label', name: 'Something else' } });
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ created: false, org: { id: orgs[0].id } });
  expect(await get<unknown[]>(request, `organizations?created_by=eq.${ARTIST_B_ID}&kind=in.(artist,label)&select=id`)).toHaveLength(1);
  await ctx.close();
});
