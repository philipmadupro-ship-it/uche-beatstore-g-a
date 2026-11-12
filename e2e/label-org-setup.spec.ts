/**
 * Self-service setup wizard (LABEL-48): a signed-in account that is neither the
 * producer nor a member of anything is sent to /setup, walks Who are you · How
 * you work · Team and roster · Departments · Review, and lands in the new org.
 * Nothing exists until the last step; the draft survives a reload. Against a REAL database (scripts/local-db, LABEL_OS_ENABLED=true from
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
test.setTimeout(120_000);
test.use({ actionTimeout: 25_000 });
expect.configure({ timeout: 25_000 });

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

test('an independent artist: nothing exists until Create, the draft resumes, settings land with the org (1440)', async ({ browser, baseURL, request }) => {
  await skipUnlessFresh(request, ARTIST_A_ID);
  const ctx = await signedIn(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test', { width: 1440, height: 900 });
  const page = await ctx.newPage();
  const next = page.getByTestId('wizard-next');

  // /login and dashboard paths no longer dead-end on the buyer page.
  await page.goto('/login');
  await expect(page).toHaveURL(/\/setup$/);

  // Step 1 needs a face and a name.
  await next.click();
  await expect(page.getByTestId('wizard-problems')).toContainText('Choose what kind of account');
  await page.getByTestId('face-independent').click();
  await page.getByLabel('Artist name').fill(`Nova ${run}`);
  await next.click();

  // Step 2: the preset is there; pick one more type.
  await expect(page.getByRole('heading', { level: 1, name: 'How you work' })).toBeVisible();
  await page.locator('#ct-management').check();
  await next.click();

  await page.screenshot({ path: 'e2e-artifacts/LABEL-48/1440-work.png', fullPage: true });
  // Step 3: no roster for an independent artist.
  await expect(page.getByTestId('wizard-solo-note')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();

  // Step 4: preset for a solo artist has Finance off. Leave it, switch Marketing off.
  await expect(page.locator('#dept-finance')).not.toBeChecked();
  await page.locator('#dept-marketing').uncheck();

  // Nothing has been created by walking the steps.
  expect(await get<unknown[]>(request, `organizations?created_by=eq.${ARTIST_A_ID}&select=id`)).toHaveLength(0);

  // Reload: the wizard picks up where it was.
  await page.reload();
  await expect(page.getByTestId('wizard-resumed')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Departments' })).toBeVisible();
  await expect(page.locator('#dept-marketing')).not.toBeChecked();
  await next.click();

  // Review: a first draft release for the artist themselves.
  await expect(page.getByTestId('wizard-review')).toContainText(`Nova ${run}`);
  await page.locator('#release-on').check();
  await page.getByLabel('Release title').fill('Debut');
  await page.screenshot({ path: 'e2e-artifacts/LABEL-48/1440-review.png', fullPage: true });
  await page.getByTestId('wizard-create').click();
  await expect(page.getByTestId('wizard-done')).toBeVisible();
  await expect(page.getByTestId('result-ok')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open your workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/nova-${run}`));

  const [org] = await get<{ id: string; kind: string; name: string; settings: Record<string, unknown> }[]>(request, `organizations?slug=eq.nova-${run}&select=id,kind,name,settings`);
  expect(org).toMatchObject({ kind: 'artist', name: `Nova ${run}` });
  expect(org.settings.departments_off).toEqual(expect.arrayContaining(['finance', 'pr', 'executive', 'artistic', 'marketing']));
  expect(org.settings.contract_types).toEqual(['licence', 'producer', 'feature', 'management']);
  expect(await get<{ role: string }[]>(request, `org_members?org_id=eq.${org.id}&select=role,user_id`)).toEqual([{ role: 'owner', user_id: ARTIST_A_ID }]);
  expect(await get<unknown[]>(request, `contacts?org_id=eq.${org.id}&select=name,email,category`)).toEqual([
    { name: `Nova ${run}`, email: 'artist-a@local.test', category: 'artist' },
  ]);
  expect(await get<{ title: string; state: string }[]>(request, `releases?org_id=eq.${org.id}&select=title,state`)).toEqual([{ title: 'Debut', state: 'draft' }]);
  expect(await get<unknown[]>(request, `activity_events?org_id=eq.${org.id}&verb=eq.org.created&select=id`)).toHaveLength(1);

  // Now a member: /setup sends them on to their org instead of offering a second one.
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/o(\/|$)/);
  await ctx.close();
});

test('a label: roster, an invitation and a first release are made once, from the wizard (390)', async ({ browser, baseURL, request }) => {
  await skipUnlessFresh(request, ARTIST_B_ID);
  const ctx = await signedIn(browser, baseURL!, ARTIST_B_ID, 'artist-b@local.test', { width: 390, height: 844 });
  const page = await ctx.newPage();
  const next = page.getByTestId('wizard-next');

  await page.goto('/setup?type=label');
  await expect(page.locator('input[value="label"]')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Label name').fill(`Northside ${run}`);
  await next.click();
  await next.click(); // contract types: the label preset
  await expect(page.getByRole('heading', { level: 1, name: 'Team and roster' })).toBeVisible();

  await page.getByRole('button', { name: 'Add artist' }).click();
  await page.getByLabel('Artist name').fill('Kai Rowe');
  await page.getByRole('button', { name: 'Add artist' }).click();
  await page.getByLabel('Artist name').nth(1).fill('Ivy Lane');

  await page.getByRole('button', { name: 'Add a person' }).click();
  await page.getByLabel('Email address').fill(`legal-${run}@example.test`);
  await page.getByRole('button', { name: 'Function of person 1' }).click();
  await page.getByRole('option', { name: 'Legal' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'e2e-artifacts/LABEL-48/390-team.png', fullPage: true });
  await next.click();

  // Departments: a label starts with all on. Switch Finance off.
  await page.locator('#dept-finance').uncheck();
  await next.click();

  await page.locator('#release-on').check();
  await page.getByLabel('Release title').fill('Opening Night');
  await page.getByRole('button', { name: 'Release artist' }).click();
  await page.getByRole('option', { name: 'Ivy Lane' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTestId('wizard-create').click();

  await expect(page.getByTestId('wizard-done')).toBeVisible();
  await page.screenshot({ path: 'e2e-artifacts/LABEL-48/390-done.png', fullPage: true });
  await expect(page.getByTestId('result-ok')).toHaveCount(4);
  await page.getByRole('button', { name: 'Open your workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/northside-${run}`));

  const orgs = await get<{ id: string; settings: Record<string, unknown> }[]>(request, `organizations?created_by=eq.${ARTIST_B_ID}&kind=eq.label&select=id,settings`);
  expect(orgs).toHaveLength(1);
  const id = orgs[0].id;
  expect(orgs[0].settings.departments_off).toEqual(['finance']);
  const contacts = await get<{ name: string; category: string }[]>(request, `contacts?org_id=eq.${id}&select=name,category&order=name`);
  expect(contacts).toEqual([{ name: 'Ivy Lane', category: 'artist' }, { name: 'Kai Rowe', category: 'artist' }]);
  expect(await get<{ email: string; role: string; functions: string[] }[]>(request, `org_invitations?org_id=eq.${id}&select=email,role,functions`)).toEqual([
    { email: `legal-${run}@example.test`, role: 'member', functions: ['legal'] },
  ]);
  const [release] = await get<{ title: string; contact_id?: string }[]>(request, `releases?org_id=eq.${id}&select=title`);
  expect(release.title).toBe('Opening Night');

  // Asking again (a double click, a retry) answers the same org, never a second one.
  const again = await page.request.post('/api/org/setup', { data: { face: 'label', name: 'Something else' } });
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ created: false, org: { id } });
  expect(await get<unknown[]>(request, `organizations?created_by=eq.${ARTIST_B_ID}&kind=in.(artist,label)&select=id`)).toHaveLength(1);
  await ctx.close();
});
