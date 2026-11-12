/**
 * Where a returning label member lands (LABEL-08 carried note, review G2):
 * a signed-in user who is a member of a label org but is NOT the producer
 * used to be sent to the buyer account page from `/login` and from `/`
 * (`/library`), with no link to their label. Against a REAL database
 * (scripts/local-db, LABEL_OS_ENABLED=true from env.sh).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `landing-${run}`;

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });

async function rest(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Landing ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org' });
});

test.afterAll(async ({ request }) => {
  await request.fetch(`${REST}/organizations?id=eq.${ORG}`, { method: 'DELETE', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } });
});

test('a member who is not the producer lands in their label, not on the buyer account', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  const c = sessionCookie(BUYER_ID, 'buyer@local.test');
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  const page = await ctx.newPage();

  // Signing in at /login with a Label OS `next` goes there.
  await page.goto(`/login?next=${encodeURIComponent(`/o/${SLUG}/artists`)}`);
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/artists$`));

  // Any other `next`, and the bare domain, go to a label page, never the buyer account.
  for (const start of ['/login?next=%2Flibrary', '/login', '/', '/library']) {
    await page.goto(start);
    await expect(page, start).toHaveURL(/\/o(\/|$)/);
  }
  await ctx.close();
});

// LABEL-48: with Label OS on, an account with no membership goes to /setup
// (which offers the buyer account) instead of straight to the buyer page.
test('a signed-in account with no membership goes to setup', async ({ browser, baseURL, request }) => {
  await rest(request, 'DELETE', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`);
  // Other specs may have left the buyer in an org of their own: only assert when this is the buyer's only membership.
  const others = await (await request.get(`${REST}/org_members?user_id=eq.${BUYER_ID}&select=org_id`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } })).json();
  test.skip(others.length > 0, 'the seed buyer is a member elsewhere');
  const ctx = await browser.newContext();
  const c = sessionCookie(BUYER_ID, 'buyer@local.test');
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  const page = await ctx.newPage();
  await page.goto(`/login?next=${encodeURIComponent(`/o/${SLUG}`)}`);
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('link', { name: 'Go to your buyer account' })).toHaveAttribute('href', '/store/account/me');
  await ctx.close();
});
