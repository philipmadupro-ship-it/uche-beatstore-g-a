/**
 * The platform console (LABEL-47) end to end against a REAL database
 * (scripts/local-db, migration 170 applied, LABEL_OS_ENABLED=true from
 * env.sh). The seed makes the local producer a platform operator — the one
 * statement the owner runs by hand on production; nothing in this spec writes
 * a licence, an org or an invitation with the service key.
 *
 *   1. The operator creates a LABEL licensee through the console UI (1440 px),
 *      without the contracts module, with a seat cap, inviting its owner.
 *   2. The invitee accepts at /join/<token> and owns the org: there is no Legal
 *      queue in the nav, its page and route are 404, and the console is 404
 *      to them although they are an org owner.
 *   3. The operator switches contracts on in the console: the legal queue is
 *      there on the owner's next request. The seat cap answers 409.
 *   4. At 390 px the operator creates an INDEPENDENT licensee; no sideways scroll.
 *   5. Every console action is in the affected org's activity, by the operator.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, ARTIST_A_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);
const NAME = `Console Label ${run}`;
const SLUG = `console-label-${run}`;
const SOLO = `Solo ${run}`;
const OTHER = randomUUID();

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
  return res.json();
}

async function signIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

let orgId = '';

// Other specs reset the seed people's memberships and an org must keep an owner: remove what this spec made.
test.afterAll(async ({ request }) => {
  const slugs = [SLUG, `other-${run}`].join(',');
  await rest(request, 'DELETE', `organizations?slug=in.(${slugs})`);
  await rest(request, 'DELETE', `organizations?name=eq.${encodeURIComponent(SOLO)}`);
});

test.beforeAll(async ({ request }) => {
  // A second, ordinary label org whose OWNER (the buyer) must not reach the console either.
  await rest(request, 'POST', 'organizations', { id: OTHER, name: `Other ${run}`, slug: `other-${run}`, kind: 'label', created_by: BUYER_ID });
  await rest(request, 'POST', 'org_members', { org_id: OTHER, user_id: BUYER_ID, role: 'owner', scope: 'org' });
});

test('1–3 · create a label licensee in the console, its owner joins, modules and seats are enforced', async ({ browser, baseURL }) => {
  const op = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(op, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await op.newPage();
  await page.request.delete(RESEND);

  await page.goto('/platform');
  await expect(page.getByRole('heading', { name: 'Licensees', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Label' }).click();
  await page.getByLabel('Name').fill(NAME);
  await expect(page.getByLabel('Address')).toHaveValue(SLUG);
  await page.getByRole('checkbox', { name: 'Contracts & legal' }).uncheck();
  await page.getByLabel('Seats').fill('2');
  await page.getByLabel('Owner’s email').fill('Artist-A@Local.test');
  await page.getByRole('button', { name: 'Create licensee' }).click();

  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: NAME }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('Not set up yet')).toBeVisible();
  await expect(card.getByText('No owner yet')).toBeVisible();
  await expect(card.getByText('0 of 2')).toBeVisible();
  await expect(card.getByText(/Owner invited: artist-a@local\.test/)).toBeVisible();

  const [org] = await rest(page.request, 'GET', `organizations?slug=eq.${SLUG}&select=id,kind,created_by`);
  expect(org).toMatchObject({ kind: 'label', created_by: null });
  orgId = org.id;
  const [licence] = await rest(page.request, 'GET', `org_entitlements?org_id=eq.${orgId}&select=modules,max_seats,max_artists,setup_done,granted_by`);
  expect(licence).toEqual({
    modules: ['finance', 'marketing', 'pr', 'executive', 'artistic', 'store', 'search', 'digest', 'export'],
    max_seats: 2, max_artists: null, setup_done: false, granted_by: PRODUCER_ID,
  });

  // The owner accepts through the ordinary invitation page.
  const mails = await (await page.request.get(RESEND)).json();
  const mail = mails.find((m: { body: { to: string | string[] } }) => [m.body.to].flat().includes('artist-a@local.test'));
  expect(mail, 'the owner invitation email was sent').toBeTruthy();
  const token = String(mail.body.html).match(/\/join\/([A-Za-z0-9_-]{43})"/)![1];
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(owner, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
  const op2 = await owner.newPage();
  await op2.goto(`/join/${token}`);
  await expect(op2.getByRole('heading', { name: NAME })).toBeVisible();
  await op2.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(op2.getByRole('status')).toContainText(`You are now a member of ${NAME}`);
  const [m] = await rest(page.request, 'GET', `org_members?org_id=eq.${orgId}&user_id=eq.${ARTIST_A_ID}&select=role,scope,invited_by`);
  expect(m).toEqual({ role: 'owner', scope: 'org', invited_by: PRODUCER_ID });

  // Without contracts: no Legal queue entry, page and route 404 — for the org's own OWNER.
  await op2.goto(`/o/${SLUG}`);
  await expect(op2.getByRole('navigation').getByRole('button', { name: 'Organization' })).toBeVisible();
  // The Rights hub stays (Parties is not part of the contracts module) but it holds no Legal queue entry.
  await op2.getByRole('navigation').getByRole('button', { name: 'Rights' }).click();
  await expect(op2.getByRole('link', { name: 'Parties' })).toBeVisible();
  await expect(op2.getByRole('link', { name: 'Legal queue' })).toHaveCount(0);
  await op2.keyboard.press('Escape');
  expect((await op2.goto(`/o/${SLUG}/rights/legal`))!.status()).toBe(404);
  expect((await op2.request.get(`/api/org/${orgId}/legal/queue`)).status()).toBe(404);

  // The console does not exist for an org owner (this one, and another org's).
  expect((await op2.goto('/platform'))!.status()).toBe(404);
  expect((await op2.request.get('/api/platform/licensees')).status()).toBe(404);
  expect((await op2.request.patch(`/api/platform/licensees/${orgId}`, { data: { modules: ['contracts'], max_seats: null, max_artists: null } })).status()).toBe(404);
  const buyer = await browser.newContext();
  await signIn(buyer, baseURL!, BUYER_ID, 'buyer@local.test');
  const bp = await buyer.newPage();
  expect((await bp.goto('/platform'))!.status()).toBe(404);
  expect((await bp.request.post('/api/platform/licensees', { data: { name: 'x', slug: `x-${run}`, face: 'label' } })).status()).toBe(404);
  expect((await bp.request.post(`/api/platform/licensees/${OTHER}/invitations`, { data: { email: 'buyer@local.test' } })).status()).toBe(404);

  // Seat cap 2: the owner holds one; a second invitation is fine, a third is 409 with a plain message.
  expect((await op2.request.post(`/api/org/${orgId}/invitations`, { data: { email: `one-${run}@local.test`, role: 'member', functions: ['a_and_r'] } })).status()).toBe(201);
  const full = await op2.request.post(`/api/org/${orgId}/invitations`, { data: { email: `two-${run}@local.test`, role: 'member', functions: ['a_and_r'] } });
  expect(full.status()).toBe(409);
  expect((await full.json()).error).toMatch(/used all 2 of its seats/);

  // The operator switches contracts on; the owner's next request sees it.
  await page.reload();
  await card.getByRole('button', { name: `Edit licence of ${NAME}` }).click();
  const form = page.getByRole('form', { name: `Licence for ${NAME}` });
  await form.getByRole('checkbox', { name: 'Contracts & legal' }).check();
  await form.getByRole('button', { name: 'Save licence' }).click();
  await expect(card.getByText('All')).toBeVisible();
  expect((await op2.request.get(`/api/org/${orgId}/legal/queue`)).status()).toBe(200);
  await op2.goto(`/o/${SLUG}`);
  await expect(op2.getByRole('navigation').getByRole('button', { name: 'Rights' })).toBeVisible();
  expect((await op2.goto(`/o/${SLUG}/rights/legal`))!.status()).toBe(200);

  // Every console action is recorded in the org it acted on, by the operator.
  const events = await rest(page.request, 'GET', `activity_events?org_id=eq.${orgId}&actor_id=eq.${PRODUCER_ID}&select=verb,audit&order=created_at,verb`); // one transaction shares a timestamp: verb breaks the tie
  expect(events).toEqual([
    { verb: 'org.created', audit: false },
    { verb: 'org.entitlements_changed', audit: true },
    { verb: 'invitation.created', audit: true },
    { verb: 'org.entitlements_changed', audit: true },
  ]);
  await Promise.all([op.close(), owner.close(), buyer.close()]);
});

test('4 · at 390 px the operator creates an independent licensee, with no sideways scroll', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto('/platform');
  await page.getByRole('radio', { name: 'Independent artist / producer' }).click();
  await expect(page.getByLabel('Artists')).toHaveCount(0);
  await page.getByLabel('Name').fill(SOLO);
  await page.getByRole('button', { name: 'Create licensee' }).click();
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: SOLO }) });
  await expect(card).toBeVisible();
  await expect(card.getByText(/Independent artist \/ producer/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const [org] = await rest(page.request, 'GET', `organizations?name=eq.${encodeURIComponent(SOLO)}&select=id,kind`);
  expect(org.kind).toBe('artist');
  // 139's trigger gave the artist org its own artist, without the operator's email.
  const contacts = await rest(page.request, 'GET', `contacts?org_id=eq.${org.id}&select=category,email`);
  expect(contacts).toEqual([{ category: 'artist', email: null }]);
  await ctx.close();
});
