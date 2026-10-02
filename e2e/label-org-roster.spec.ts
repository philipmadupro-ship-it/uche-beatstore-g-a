/**
 * Org contacts as the artist roster + artist scope (LABEL-10) end to end
 * against a REAL database (scripts/local-db: Postgres + PostgREST + RLS,
 * LABEL_OS_ENABLED=true from env.sh). What mocks cannot prove: the embeds
 * and filters really run in PostgREST, migration 139's policy really leaves
 * the producer's CRM alone, and a scoped member really sees only their
 * artists.
 *
 * The producer owns a label org; the seed BUYER is an A&R member of it
 * limited to selected artists. The producer adds people to the label's
 * directory, picks the buyer's artists on the members page, and the buyer's
 * roster follows. The producer's own CRM never shows a label contact, and a
 * CRM contact is never reachable through the org.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `roster-${run}`;
const NAME = `Roster Records ${run}`;
const CRM_CONTACT = randomUUID();

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

let nova = '';
let kilo = '';

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: NAME, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID });
  await rest(request, 'DELETE', `user_profiles?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'user_profiles', { user_id: BUYER_ID, display_name: 'Dana Buyer' });
  await rest(request, 'POST', 'contacts', { id: CRM_CONTACT, user_id: PRODUCER_ID, name: `CRM artist ${run}`, email: `crm-${run}@local.test`, category: 'artist' });
});

test.afterAll(async ({ request }) => {
  // The org's contacts, members and scopes go with it (FK cascades).
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `contacts?id=eq.${CRM_CONTACT}`);
});

test('1 · the directory: producer adds people; the roster is its artists; the CRM never mixes in', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const api = ctx.request;

  const add = async (body: Record<string, unknown>) => {
    const res = await api.post(`/api/org/${ORG}/contacts`, { data: body });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).contact as { id: string; in_roster: boolean };
  };
  nova = (await add({ name: `Nova ${run}`, email: `Nova-${run}@Local.Test`, category: 'artist' })).id;
  kilo = (await add({ name: `Kilo ${run}`, category: 'rapper' })).id;
  const eng = await add({ name: `Eng ${run}`, category: 'engineer' });
  expect(eng.in_roster).toBe(false);

  expect((await api.post(`/api/org/${ORG}/contacts`, { data: { name: 'dup', email: `nova-${run}@local.test` } })).status()).toBe(409);

  const roster = await (await api.get(`/api/org/${ORG}/contacts?view=roster`)).json();
  expect(roster.contacts.map((c: { name: string }) => c.name).sort()).toEqual([`Kilo ${run}`, `Nova ${run}`]);
  expect(JSON.stringify(roster)).not.toContain('user_id');

  // The producer's CRM is exactly what it was: no label contact in it…
  const crm = await (await api.get('/api/contacts')).json();
  const crmIds = (crm.contacts ?? crm).map((c: { id: string }) => c.id);
  expect(crmIds).toContain(CRM_CONTACT);
  expect(crmIds).not.toContain(nova);
  expect(crmIds).not.toContain(eng.id);
  // …the CRM contact page of a label contact does not open…
  expect((await api.get(`/api/contacts/${nova}`)).status()).not.toBe(200);
  // …and a CRM contact is not reachable through the org.
  expect((await api.get(`/api/org/${ORG}/contacts/${CRM_CONTACT}`)).status()).toBe(404);
  await ctx.close();
});

test('2 · the database: org_member_read never widens what the producer reads through RLS', async ({ request }) => {
  // Straight to PostgREST as the producer's own JWT: owner_only + the
  // additive org policy. The producer IS a member of this label, so its
  // directory shows; every row they read is theirs or this org's.
  const res = await request.get(`${REST}/contacts?select=id,user_id,org_id`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(PRODUCER_ID, 'producer@local.test')}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const rows = (await res.json()) as { id: string; user_id: string | null; org_id: string | null }[];
  for (const r of rows) expect(r.user_id === PRODUCER_ID || r.org_id === ORG, JSON.stringify(r)).toBe(true);

  // The buyer, limited to no artist yet, reads no contact at all.
  const buyer = await request.get(`${REST}/contacts?select=id`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
  });
  expect(await buyer.json()).toEqual([]);
});

test('3 · artist scope: the picker on the members page decides what the member sees', async ({ browser, baseURL }) => {
  const buyerCtx = await browser.newContext();
  await signedIn(buyerCtx, baseURL!, BUYER_ID, 'buyer@local.test');
  const buyerApi = buyerCtx.request;

  // Limited to nobody yet: nothing, and an id is 404.
  expect((await (await buyerApi.get(`/api/org/${ORG}/contacts`)).json()).contacts).toEqual([]);
  expect((await buyerApi.get(`/api/org/${ORG}/contacts/${nova}`)).status()).toBe(404);

  // The producer switches Nova on for Dana in the roster picker.
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);
  const dana = page.getByTestId(`member-${BUYER_ID}`);
  await expect(dana).toContainText('0 artists', { timeout: 30_000 });
  await dana.getByRole('button', { name: 'Artists · none' }).click();
  const picker = page.getByRole('dialog', { name: 'Artists Dana Buyer sees' });
  await picker.getByRole('switch', { name: `Nova ${run}` }).click();
  await expect(picker.getByRole('switch', { name: `Nova ${run}` })).toHaveAttribute('aria-checked', 'true');
  await expect(dana).toContainText('1 artist');

  // Dana now sees Nova, and only Nova — in the API and on the roster page.
  const list = await (await buyerApi.get(`/api/org/${ORG}/contacts`)).json();
  expect(list.contacts.map((c: { id: string }) => c.id)).toEqual([nova]);
  expect((await buyerApi.get(`/api/org/${ORG}/contacts/${kilo}`)).status()).toBe(404);
  const buyerPage = await buyerCtx.newPage();
  await buyerPage.goto(`/o/${SLUG}/artists`);
  await expect(buyerPage.getByTestId(`artist-card-${nova}`)).toBeVisible({ timeout: 30_000 });
  await expect(buyerPage.getByTestId(`artist-card-${kilo}`)).toHaveCount(0);

  // A scoped member cannot add to the directory, nor widen their own scope.
  expect((await buyerApi.post(`/api/org/${ORG}/contacts`, { data: { name: 'x' } })).status()).toBe(403);
  expect((await buyerApi.put(`/api/org/${ORG}/members/artists`, { data: { user_id: BUYER_ID, contact_ids: [nova, kilo] } })).status()).toBe(403);

  // The producer sees the whole roster on the same page, via the Artists hub.
  await page.goto(`/o/${SLUG}/artists`);
  await expect(page.getByTestId(`artist-card-${nova}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`artist-card-${kilo}`)).toBeVisible();
  await ctx.close();
  await buyerCtx.close();
});
