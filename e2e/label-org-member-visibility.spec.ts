/**
 * Who a member sees in their org's people (LABEL-43, migration 164, review
 * G1 F1) end to end against a REAL database (scripts/local-db: Postgres +
 * PostgREST + RLS, LABEL_OS_ENABLED=true from env.sh).
 *
 * The route (GET /api/org/[orgId]/members, `mayListMember`) and the
 * database (the member's OWN JWT straight from PostgREST) must agree:
 *   · a roster artist sees the staff and themselves, never another artist of
 *     the label — membership rows AND profiles;
 *   · staff limited to some artists see the staff and those artists' logins;
 *   · the owner sees everyone.
 *
 * Cast (seed users): the producer owns the label; BUYER is an A&R limited to
 * Kilo; ARTIST_A is Nova's login (role artist); ARTIST_B is Kilo's.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `people-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const EVERYONE = [PRODUCER_ID, BUYER_ID, ARTIST_A_ID, ARTIST_B_ID];

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown, prefer = 'return=representation') {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  expect(res.ok(), `${method} ${p}: ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

/** A PostgREST read with the person's OWN token, the way their browser would: RLS decides. */
async function idsAs(request: APIRequestContext, who: { id: string; email: string }, p: string): Promise<string[]> {
  const res = await request.fetch(`${REST}/${p}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}` } });
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { user_id: string }[]).map((r) => r.user_id).sort();
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

async function routeIds(ctx: BrowserContext): Promise<string[]> {
  const res = await ctx.request.get(`/api/org/${ORG}/members`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { members: { user_id: string }[] }).members.map((m) => m.user_id).sort();
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const buyer = { id: BUYER_ID, email: 'buyer@local.test' };
const artistA = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const artistB = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const sorted = (...ids: string[]) => [...ids].sort();
const members = `org_members?select=user_id&org_id=eq.${ORG}`;
const profiles = `user_profiles?select=user_id&user_id=in.(${EVERYONE.join(',')})`;

test.beforeAll(async ({ request }) => {
  // An aborted earlier run (or another spec) may have left these people in some org together.
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `People Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', [
    { org_id: ORG, user_id: BUYER_ID, contact_id: KILO },
    { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA },
    { org_id: ORG, user_id: ARTIST_B_ID, contact_id: KILO },
  ]);
  // Everyone needs a profile for the profile read to mean anything; an existing one is left as it is.
  await rest(request, 'POST', 'user_profiles?on_conflict=user_id', EVERYONE.map((user_id) => ({ user_id })), 'resolution=ignore-duplicates,return=minimal');
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test('1 · a roster artist sees the staff and herself — through the route AND with her own JWT, rows and profiles', async ({ browser, baseURL }) => {
  const nova = await as(browser, baseURL!, artistA.id, artistA.email);
  const want = sorted(PRODUCER_ID, BUYER_ID, ARTIST_A_ID);
  expect(await routeIds(nova)).toEqual(want);
  expect(await idsAs(nova.request, artistA, members)).toEqual(want);
  expect(await idsAs(nova.request, artistA, profiles)).toEqual(want);
  // Not by asking for the other artist directly either.
  expect(await idsAs(nova.request, artistA, `org_members?select=user_id&user_id=eq.${ARTIST_B_ID}`)).toEqual([]);
  expect(await idsAs(nova.request, artistA, `user_profiles?select=user_id&user_id=eq.${ARTIST_B_ID}`)).toEqual([]);

  const kilo = await as(browser, baseURL!, artistB.id, artistB.email);
  expect(await idsAs(kilo.request, artistB, members)).toEqual(sorted(PRODUCER_ID, BUYER_ID, ARTIST_B_ID));
  await nova.close();
  await kilo.close();
});

test('2 · staff limited to Kilo see the staff and Kilo; the owner sees everyone — the route and the database agree', async ({ browser, baseURL }) => {
  const ar = await as(browser, baseURL!, buyer.id, buyer.email);
  const scoped = sorted(PRODUCER_ID, BUYER_ID, ARTIST_B_ID);
  expect(await routeIds(ar)).toEqual(scoped);
  expect(await idsAs(ar.request, buyer, members)).toEqual(scoped);
  expect(await idsAs(ar.request, buyer, profiles)).toEqual(scoped);

  const owner = await as(browser, baseURL!, producer.id, producer.email);
  expect(await routeIds(owner)).toEqual(sorted(...EVERYONE));
  expect(await idsAs(owner.request, producer, members)).toEqual(sorted(...EVERYONE));
  expect(await idsAs(owner.request, producer, profiles)).toEqual(sorted(...EVERYONE));
  await ar.close();
  await owner.close();
});
