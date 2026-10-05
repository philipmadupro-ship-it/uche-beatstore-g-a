/**
 * Activity events (LABEL-19) end to end against a REAL database
 * (scripts/local-db, LABEL_OS_ENABLED=true from env.sh), migration 146
 * included.
 *
 * The producer owns a label with one member (the seed buyer, A&R, whole
 * org) and a roster artist. Through the real routes: a membership change,
 * an artist list, a scope widening that clears it, an invitation and its
 * revocation, a release and its edits and a removal. After each, the event
 * is in `activity_events` — written by the same transaction as the change
 * for the audit verbs (146) — and the A&R member, who holds catalog.read
 * but not business.read.internal, reads the creative events (D5) and none
 * of the business ones, under the real RLS policy.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const NOVA = randomUUID();

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function as(browser: import('@playwright/test').Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

type Event = { verb: string; audit: boolean; visibility: string; actor_id: string; subject_id: string | null; payload: Record<string, unknown>; release_id: string | null };
const events = async (request: APIRequestContext, verb?: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,visibility,actor_id,subject_id,payload,release_id&org_id=eq.${ORG}${verb ? `&verb=eq.${verb}` : ''}&order=created_at`)) as Event[];

const members = `/api/org/${ORG}/members`;
const invitations = `/api/org/${ORG}/invitations`;
const releases = `/api/org/${ORG}/releases`;
const ids: Record<string, string> = {};

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Audit Records ${run}`, slug: `audit-${run}`, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

test('1 · a membership change commits with its audit event (146); a no-op writes none', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const res = await ctx.request.patch(members, { data: { user_id: BUYER_ID, functions: ['a_and_r', 'marketing'] } });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).member).toMatchObject({ user_id: BUYER_ID, functions: ['a_and_r', 'marketing'] });
  const [e] = await events(request, 'member.capabilities_changed');
  expect(e).toMatchObject({ audit: true, visibility: 'internal', actor_id: PRODUCER_ID, subject_id: BUYER_ID });
  expect(e.payload).toEqual({ functions: { from: ['a_and_r'], to: ['a_and_r', 'marketing'] } });

  expect((await ctx.request.patch(members, { data: { user_id: BUYER_ID, functions: ['a_and_r', 'marketing'] } })).status()).toBe(200);
  expect(await events(request, 'member.capabilities_changed')).toHaveLength(1);
  // Back to plain A&R for the visibility check below.
  expect((await ctx.request.patch(members, { data: { user_id: BUYER_ID, functions: ['a_and_r'] } })).status()).toBe(200);
  await ctx.close();
});

test('2 · an artist list is one transaction with member.artists_changed; widening clears it and the event names it', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  expect((await ctx.request.patch(members, { data: { user_id: BUYER_ID, scope: 'artists' } })).status()).toBe(200);
  const put = await ctx.request.put(`${members}/artists`, { data: { user_id: BUYER_ID, contact_ids: [NOVA] } });
  expect(put.status(), await put.text()).toBe(200);
  const [changed] = await events(request, 'member.artists_changed');
  expect(changed).toMatchObject({ audit: true, subject_id: BUYER_ID });
  expect(changed.payload).toEqual({ added: [NOVA], removed: [], count: 1 });
  expect(await rest(request, 'GET', `member_artist_scopes?select=contact_id&org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`)).toEqual([{ contact_id: NOVA }]);

  const widen = await ctx.request.patch(members, { data: { user_id: BUYER_ID, scope: 'org' } });
  expect(widen.status(), await widen.text()).toBe(200);
  expect(await rest(request, 'GET', `member_artist_scopes?select=contact_id&org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`)).toEqual([]);
  const scopeEvents = await events(request, 'member.scope_changed');
  expect(scopeEvents).toHaveLength(2); // limiting, then widening
  const scope = scopeEvents[1];
  expect(scope.payload).toMatchObject({ scope: { from: 'artists', to: 'org' }, contact_ids: { from: [NOVA], to: [] } });
  await ctx.close();
});

test('3 · an invitation and its revocation are audit events; a second pending one is 409 and records nothing', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const email = `invitee-${run}@example.com`;
  const created = await ctx.request.post(invitations, { data: { email, role: 'member', functions: ['marketing'] } });
  expect(created.status(), await created.text()).toBe(201);
  const inv = (await created.json()).invitation;
  expect(JSON.stringify(await rest(request, 'GET', `activity_events?select=payload&verb=eq.invitation.created&org_id=eq.${ORG}`))).not.toMatch(/token/i);
  const [made] = await events(request, 'invitation.created');
  expect(made).toMatchObject({ audit: true, subject_id: inv.id });

  const again = await ctx.request.post(invitations, { data: { email, role: 'member' } });
  expect(again.status()).toBe(409);
  expect(await events(request, 'invitation.created')).toHaveLength(1);

  expect((await ctx.request.delete(`${invitations}/${inv.id}`)).status()).toBe(200);
  expect((await ctx.request.delete(`${invitations}/${inv.id}`)).status()).toBe(200);
  const revoked = await events(request, 'invitation.revoked');
  expect(revoked).toHaveLength(1);
  expect(revoked[0]).toMatchObject({ audit: true, subject_id: inv.id });
  await ctx.close();
});

test('4 · release changes are recorded with their artist, project and release; refused ones are not', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const res = await ctx.request.post(releases, { data: { title: `Midnight ${run}`, type: 'single', contact_id: NOVA } });
  expect(res.status(), await res.text()).toBe(201);
  ids.release = (await res.json()).release.id;

  expect((await ctx.request.patch(`${releases}/${ids.release}`, { data: { title: `Midnight (Deluxe) ${run}`, label_name: 'Audit Records' } })).status()).toBe(200);
  expect((await ctx.request.patch(`${releases}/${ids.release}`, { data: { upc: '4006381333932' } })).status()).toBe(400);
  expect((await ctx.request.patch(`${releases}/${ids.release}`, { data: { state: 'cancelled' } })).status()).toBe(200);

  const updated = (await events(request, 'release.updated')).map((e) => e.payload);
  expect(updated).toEqual([{ fields: ['label_name', 'title'] }, { fields: ['state'], state: { from: 'draft', to: 'cancelled' } }]);
  expect((await events(request, 'release.updated')).every((e) => e.release_id === ids.release && e.visibility === 'artist' && !e.audit)).toBe(true);
  await ctx.close();
});

test('5 · an A&R member reads the creative record and none of the business events (the default visibility, under RLS)', async ({ request }) => {
  const res = await request.get(`${REST}/activity_events?select=verb&org_id=eq.${ORG}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
  });
  const seen = new Set(((await res.json()) as { verb: string }[]).map((e) => e.verb));
  expect(seen.has('release.created')).toBe(true);
  expect(seen.has('release.updated')).toBe(true);
  for (const business of ['member.capabilities_changed', 'member.scope_changed', 'member.artists_changed', 'invitation.created', 'invitation.revoked', 'org.created']) {
    expect(seen.has(business), business).toBe(false);
  }
  // The owner (business.read.internal) reads all of it.
  const all = await request.get(`${REST}/activity_events?select=verb&org_id=eq.${ORG}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(PRODUCER_ID, 'producer@local.test')}` },
  });
  const ownerSees = new Set(((await all.json()) as { verb: string }[]).map((e) => e.verb));
  for (const v of ['member.capabilities_changed', 'member.artists_changed', 'invitation.created', 'release.updated']) expect(ownerSees.has(v), v).toBe(true);
});

test('6 · the last owner is not removed (409, nothing recorded); removing a member is member.removed in the same transaction', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const before = (await events(request)).length;
  expect((await ctx.request.delete(`${members}?user_id=${PRODUCER_ID}`)).status()).toBe(409);
  expect((await events(request)).length).toBe(before);

  // What the route's own count check cannot see — two owners removed at once —
  // is 136's deferred trigger, raised at COMMIT through the function: the
  // member stays AND no event is left behind.
  const rpcCall = (token: string, name: string, data: unknown) =>
    request.post(`${REST}/rpc/${name}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, data: JSON.stringify(data) });
  const args = { p_org: ORG, p_actor: PRODUCER_ID, p_user: PRODUCER_ID, p_payload: {} };
  const refused = await rpcCall(SERVICE_KEY, 'labelos_audit_member_remove', args);
  expect(refused.ok()).toBe(false);
  expect(await refused.text()).toMatch(/at least one owner/);
  expect((await events(request)).length).toBe(before);
  // `authenticated` cannot call the function at all (146: service_role only).
  const asUser = await rpcCall(userToken(PRODUCER_ID, 'producer@local.test'), 'labelos_audit_member_remove', args);
  expect(asUser.ok()).toBe(false);
  expect(asUser.status()).toBeGreaterThanOrEqual(401);
  expect(await rest(request, 'GET', `org_members?select=user_id&org_id=eq.${ORG}&user_id=eq.${PRODUCER_ID}`)).toHaveLength(1);

  const gone = await ctx.request.delete(`${members}?user_id=${BUYER_ID}`);
  expect(gone.status(), await gone.text()).toBe(200);
  const [removed] = await events(request, 'member.removed');
  expect(removed).toMatchObject({ audit: true, subject_id: BUYER_ID, actor_id: PRODUCER_ID });
  expect(await rest(request, 'GET', `org_members?select=user_id&org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`)).toEqual([]);
  expect((await ctx.request.delete(`${members}?user_id=${BUYER_ID}`)).status()).toBe(404);
  await ctx.close();
});
