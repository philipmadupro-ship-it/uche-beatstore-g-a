/**
 * Org invitations (LABEL-08) end to end against a REAL database
 * (scripts/local-db, migration 138 applied, LABEL_OS_ENABLED=true from
 * env.sh): the producer invites the seed BUYER into a label org; the email
 * lands in the fake Resend; the buyer opens /join/<token> signed out, signs
 * in (the magic link is stubbed by setting the session cookie the callback
 * would set), accepts, and sees the org. Then: accepting twice, a reused
 * link, a mismatched account, revoke and expiry. A buyer who joined is still
 * 403 on producer routes.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const ORG_NAME = `Night Shift ${run}`;
const SLUG = `night-shift-${run}`;

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

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

/** Invite as the producer, through the real route; returns the emailed token. */
async function invite(page: Page, email: string, role = 'member', functions: string[] = ['a_and_r']) {
  await page.request.delete(RESEND);
  const res = await page.request.post(`/api/org/${ORG}/invitations`, { data: { email, role, functions } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const mails = await (await page.request.get(RESEND)).json();
  const mail = mails.find((m: { body: { to: string | string[] } }) => [m.body.to].flat().includes(email.trim().toLowerCase()));
  expect(mail, 'the invitation email was sent').toBeTruthy();
  const token = String(mail.body.html).match(/\/join\/([A-Za-z0-9_-]{43})"/)![1];
  // The token is only in the email: not in the response.
  expect(JSON.stringify(body)).not.toContain(token);
  return { token, id: body.invitation.id as string };
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'organizations', { id: ORG, name: ORG_NAME, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
});

test('1 · invite → sign in (stubbed magic link) → accept → org visible; a buyer member is still not a producer', async ({ browser, baseURL }) => {
  const producer = await browser.newContext();
  await signIn(producer, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();
  const { token } = await invite(pp, ' Buyer@Local.test ');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/join/${token}`);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  await expect(page.getByText('Member · A&R')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
  // The page never shows the invited address.
  await expect(page.locator('body')).not.toContainText('buyer@local.test');

  // What /auth/callback would leave behind after the magic link.
  await signIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  await page.reload();
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('status')).toContainText(`You are now a member of ${ORG_NAME}`);
  await expect(page.getByRole('link', { name: `Open ${ORG_NAME}` })).toHaveAttribute('href', `/o/${SLUG}`);

  const rows = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}&select=role,functions,scope,invited_by`);
  expect(rows).toEqual([{ role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID }]);
  const events = await rest(page.request, 'GET', `activity_events?org_id=eq.${ORG}&select=verb,audit&order=created_at`);
  expect(events).toEqual([{ verb: 'invitation.created', audit: true }, { verb: 'member.joined', audit: true }]);

  // Second visit and second accept: idempotent.
  await page.reload();
  await expect(page.getByText(`You are a member of ${ORG_NAME}`)).toBeVisible();
  const again = await page.request.post('/api/org/join', { data: { token, action: 'accept' } });
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ joined: true, alreadyMember: true, org: { slug: SLUG } });

  // Membership admits to /api/org/* and nothing else.
  expect((await page.request.post(`/api/org/${ORG}/invitations`, { data: { email: 'x@y.test', role: 'member' } })).status()).toBe(403); // no members.manage
  expect((await page.request.get('/api/tracks')).status()).toBe(403);

  // Removed, the spent link does not readmit.
  await page.request.fetch(`${REST}/org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  });
  await page.reload();
  await expect(page.getByText('This invitation has already been used')).toBeVisible();
  expect((await page.request.post('/api/org/join', { data: { token, action: 'accept' } })).status()).toBe(409);
  await producer.close();
  await ctx.close();
});

test('2 · a mismatched account is refused without learning the invited address', async ({ browser, baseURL }) => {
  const producer = await browser.newContext();
  await signIn(producer, baseURL!, PRODUCER_ID, 'producer@local.test');
  const { token } = await invite(await producer.newPage(), `someone-${run}@local.test`, 'admin', []);

  const ctx = await browser.newContext();
  await signIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/join/${token}`);
  await expect(page.getByText('This invitation was sent to a different email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out and switch account' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(`someone-${run}`);
  const res = await page.request.post('/api/org/join', { data: { token, action: 'accept' } });
  expect(res.status()).toBe(403);
  expect(await res.text()).not.toContain('@');
  await producer.close();
  await ctx.close();
});

test('3 · revoked and expired links say so', async ({ browser, baseURL }) => {
  const producer = await browser.newContext();
  await signIn(producer, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();

  const revoked = await invite(pp, `revoked-${run}@local.test`);
  const del = await pp.request.delete(`/api/org/${ORG}/invitations/${revoked.id}`);
  expect(del.status()).toBe(200);
  expect((await pp.request.delete(`/api/org/${ORG}/invitations/${revoked.id}`)).status()).toBe(200); // idempotent

  const expired = await invite(pp, `expired-${run}@local.test`);
  await rest(pp.request, 'PATCH', `org_invitations?id=eq.${expired.id}`, { expires_at: new Date(Date.now() - 1000).toISOString() });

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/join/${revoked.token}`);
  await expect(page.getByText('This invitation was withdrawn')).toBeVisible();
  await page.goto(`/join/${expired.token}`);
  await expect(page.getByText('This invitation has expired')).toBeVisible();
  await page.goto(`/join/${'x'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Invitation not found' })).toBeVisible();
  await producer.close();
});
