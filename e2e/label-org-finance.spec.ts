/**
 * Finance schema and permissions (LABEL-61) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true,
 * migration 179 included).
 *
 * There is no finance screen yet (statements, imports and the dashboard are
 * LABEL-62..64), so this proves the permission model through the real routes
 * and through PostgREST on each person's OWN token. Seeded with the service
 * key: the cast, the parties (LABEL-54's data), and the statements themselves
 * — their generation is LABEL-63's. A payee is made through the route.
 *
 *   1 · the owner makes payees of three parties through POST /finance/payees
 *       (an artist's, a second artist's, a producer's with no roster contact);
 *       a second payee of the same party is 409; an account-number-looking
 *       reference is 400;
 *   2 · statements are seeded, each moved draft → approved → issued through
 *       PostgREST (the database's own total-equals-lines rule runs);
 *   3 · the owner lists every statement; a finance member limited to Nova lists
 *       Nova's; a marketing member and an outsider are refused;
 *   4 · Nova's roster artist reads only her ISSUED statement — not the draft,
 *       not Kilo's — through the route AND straight from PostgREST on her JWT;
 *   5 · Kilo's roster artist, whose ACCOUNT is linked to Nova's party, still
 *       reads only Kilo's: the link grants nothing;
 *   6 · with the finance module switched off, the owner and the artist both get
 *       404 and PostgREST returns nothing;
 *   7 · the producer dashboard and /store still load.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `finance-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const P_NOVA = randomUUID();
const P_KILO = randomUUID();
const P_PAT = randomUUID();
const PERIOD = randomUUID();
const D = 'e2e-artifacts/LABEL-61';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const financeScoped = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const kiloArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const outsider = { id: BUYER_ID, email: 'buyer@local.test' };

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function readAs(request: APIRequestContext, who: { id: string; email: string }, p: string) {
  const res = await request.fetch(`${REST}/${p}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}` } });
  return { status: res.status(), body: (await res.json()) as Record<string, unknown>[] };
}

async function as(browser: Browser, baseURL: string, who: { id: string; email: string }): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(who.id, who.email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

type Row = Record<string, unknown>;
const ids = (rows: Row[]) => rows.map((r) => String(r.id)).sort();
const statementIds: Record<string, string> = {};

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  const users = [ARTIST_A_ID, ARTIST_B_ID, BUYER_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Finance Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['finance'], scope: 'artists', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', [
    { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA },
    { org_id: ORG, user_id: ARTIST_B_ID, contact_id: KILO },
  ]);
  // Nova's party is linked to KILO's artist's account: a link that must grant nothing.
  await rest(request, 'POST', 'parties', [
    { id: P_NOVA, org_id: ORG, kind: 'person', display_name: `Nova ${run}`, contact_id: NOVA, user_id: ARTIST_B_ID },
    { id: P_KILO, org_id: ORG, kind: 'person', display_name: `Kilo ${run}`, contact_id: KILO, user_id: null },
    { id: P_PAT, org_id: ORG, kind: 'person', display_name: `Pat ${run}`, contact_id: null, user_id: null },
  ]);
  await rest(request, 'POST', 'finance_periods', { id: PERIOD, org_id: ORG, label: `Q3 ${run}`, starts_on: '2026-07-01', ends_on: '2026-09-30', created_by: PRODUCER_ID });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test('1 · payees are made through the route; duplicates and bank numbers are refused', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner);
  const post = (data: unknown) => ctx.request.post(`/api/org/${ORG}/finance/payees`, { data });
  const nova = await post({ party_id: P_NOVA, artist_contact_id: NOVA, currency: 'usd', payment_reference: 'wire details on file' });
  expect(nova.status(), await nova.text()).toBe(201);
  expect((await nova.json()).payee).toMatchObject({ partyId: P_NOVA, artistContactId: NOVA, currency: 'USD' });
  expect((await post({ party_id: P_KILO, artist_contact_id: KILO })).status()).toBe(201);
  expect((await post({ party_id: P_PAT, artist_contact_id: null, currency: 'EUR' })).status()).toBe(201);
  expect((await post({ party_id: P_NOVA, artist_contact_id: NOVA })).status()).toBe(409);
  expect((await post({ party_id: P_PAT, artist_contact_id: null, payment_reference: 'GB29 NWBK 6016 1331 9268 19' })).status()).toBe(400);
  const events = (await rest(ctx.request, 'GET', `activity_events?select=verb,visibility,payload&org_id=eq.${ORG}&verb=eq.payee.created`)) as Row[];
  expect(events).toHaveLength(3);
  expect(events.every((e) => e.visibility === 'internal')).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/wire|EUR/);
  await ctx.close();
});

test('2 · statements move draft → approved → issued under the database’s own rules', async ({ request }) => {
  const payees = (await rest(request, 'GET', `payees?select=id,party_id&org_id=eq.${ORG}`)) as Row[];
  const payee = (party: string) => String(payees.find((p) => p.party_id === party)!.id);
  const mk = async (key: string, party: string, lines: number[], toStatus: 'draft' | 'issued', period = PERIOD) => {
    const [st] = (await rest(request, 'POST', 'statements', { org_id: ORG, payee_id: payee(party), period_id: period, currency: party === P_PAT ? 'EUR' : 'USD', created_by: PRODUCER_ID })) as Row[];
    statementIds[key] = String(st.id);
    for (const [i, amount] of lines.entries()) {
      await rest(request, 'POST', 'statement_lines', { org_id: ORG, statement_id: st.id, kind: amount < 0 ? 'recoupment' : 'earning', description: `line ${i}`, amount_minor: amount, currency: st.currency, position: i });
    }
    if (toStatus === 'issued') {
      const net = lines.reduce((a, b) => a + b, 0);
      const wrong = await request.fetch(`${REST}/statements?id=eq.${st.id}`, {
        method: 'PATCH',
        headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
        data: JSON.stringify({ net_minor: net + 1, status: 'approved', approved_by: PRODUCER_ID, approved_at: new Date().toISOString() }),
      });
      expect(wrong.ok(), 'a total that is not the sum of the lines must be refused').toBe(false);
      expect(await wrong.text()).toMatch(/sum of its lines/);
      await rest(request, 'PATCH', `statements?id=eq.${st.id}`, { net_minor: net, status: 'approved', approved_by: PRODUCER_ID, approved_at: new Date().toISOString() });
      await rest(request, 'PATCH', `statements?id=eq.${st.id}`, { status: 'issued', issued_at: new Date().toISOString() });
    }
  };
  await mk('novaIssued', P_NOVA, [100000, -25000], 'issued');
  // A second period for Nova's draft (one live statement per payee per period).
  const P2 = randomUUID();
  await rest(request, 'POST', 'finance_periods', { id: P2, org_id: ORG, label: `Q4 ${run}`, starts_on: '2026-10-01', ends_on: '2026-12-31' });
  await mk('novaDraft', P_NOVA, [4200], 'draft', P2);
  await mk('kiloIssued', P_KILO, [5000], 'issued');
  await mk('patIssued', P_PAT, [700], 'issued');
  // The database froze the approved statement.
  const res = await request.fetch(`${REST}/statement_lines`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ org_id: ORG, statement_id: statementIds.novaIssued, kind: 'earning', amount_minor: 1, currency: 'USD' }),
  });
  expect(res.ok()).toBe(false);
  expect(await res.text()).toMatch(/left draft/);
});

test('3 · staff: the owner reads all, a scoped finance member only Nova’s, marketing and outsiders nothing', async ({ browser, baseURL, request }) => {
  const ownerCtx = await as(browser, baseURL!, owner);
  const all = await (await ownerCtx.request.get(`/api/org/${ORG}/finance/statements`)).json();
  expect(all).toMatchObject({ schemaReady: true, own: false });
  expect(ids(all.statements)).toEqual(Object.values(statementIds).sort());
  const nova = all.statements.find((s: Row) => s.id === statementIds.novaIssued);
  expect(nova.netMinor).toBe('75000');
  expect((nova.lines as Row[]).map((l) => l.amountMinor)).toEqual(['100000', '-25000']);
  const payees = await (await ownerCtx.request.get(`/api/org/${ORG}/finance/payees`)).json();
  expect(payees.payees).toHaveLength(3);
  expect(payees.payees.find((p: Row) => p.partyId === P_NOVA).paymentReference).toBe('wire details on file');
  await ownerCtx.close();

  const fin = await as(browser, baseURL!, financeScoped);
  const scoped = await (await fin.request.get(`/api/org/${ORG}/finance/statements`)).json();
  expect(ids(scoped.statements)).toEqual([statementIds.novaDraft, statementIds.novaIssued].sort());
  const scopedPayees = await (await fin.request.get(`/api/org/${ORG}/finance/payees`)).json();
  expect(scopedPayees.payees.map((p: Row) => p.partyId)).toEqual([P_NOVA]);
  // PostgREST on the same person's JWT agrees.
  const direct = await readAs(request, financeScoped, 'statements?select=id');
  expect(ids(direct.body)).toEqual([statementIds.novaDraft, statementIds.novaIssued].sort());
  expect((await readAs(request, financeScoped, 'earnings_lines?select=id')).body).toEqual([]);
  // Their scope does not reach a party outside it.
  expect((await fin.request.post(`/api/org/${ORG}/finance/payees`, { data: { party_id: P_PAT, artist_contact_id: null } })).status()).toBe(404);
  await fin.close();

  // Marketing: the same member, with a function that has no finance.
  await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${ARTIST_A_ID}`, { functions: ['marketing'] });
  const mkt = await as(browser, baseURL!, financeScoped);
  expect((await mkt.request.get(`/api/org/${ORG}/finance/statements`)).status()).toBe(403);
  expect((await mkt.request.get(`/api/org/${ORG}/finance/payees`)).status()).toBe(403);
  expect((await readAs(request, financeScoped, 'statements?select=id')).body).toEqual([]);
  expect((await readAs(request, financeScoped, 'payees?select=id')).body).toEqual([]);
  await mkt.close();

  const out = await as(browser, baseURL!, outsider);
  expect((await out.request.get(`/api/org/${ORG}/finance/statements`)).status()).toBeGreaterThanOrEqual(403);
  expect((await readAs(request, outsider, 'statements?select=id')).body).toEqual([]);
  await out.close();
});

test('4 · Nova’s artist reads only her ISSUED statement — through the route and straight from PostgREST', async ({ browser, baseURL, request }) => {
  // Re-scope the roster-artist account to Nova for this step.
  await rest(request, 'PATCH', `member_artist_scopes?org_id=eq.${ORG}&user_id=eq.${ARTIST_B_ID}`, { contact_id: NOVA });
  const ctx = await as(browser, baseURL!, kiloArtist);
  const body = await (await ctx.request.get(`/api/org/${ORG}/finance/statements`)).json();
  expect(body.own).toBe(true);
  expect(ids(body.statements)).toEqual([statementIds.novaIssued]);
  expect(body.statements[0]).not.toHaveProperty('approvedAt');
  expect((await ctx.request.get(`/api/org/${ORG}/finance/payees`)).status()).toBe(403);
  const direct = await readAs(request, kiloArtist, 'statements?select=id,status');
  expect(direct.body).toEqual([{ id: statementIds.novaIssued, status: 'issued' }]);
  expect((await readAs(request, kiloArtist, 'statement_lines?select=amount_minor&order=position')).body.map((l) => l.amount_minor)).toEqual([100000, -25000]);
  expect((await readAs(request, kiloArtist, 'advances?select=id')).body).toEqual([]);
  expect((await readAs(request, kiloArtist, 'earnings_imports?select=id')).body).toEqual([]);
  const ref = await request.fetch(`${REST}/payees?select=payment_reference`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(kiloArtist.id, kiloArtist.email)}` } });
  expect([401, 403]).toContain(ref.status()); // the column is not granted to any API role
  await ctx.close();
});

test('5 · a party linked to your account grants nothing: Kilo’s artist (linked to Nova’s party) reads only Kilo’s', async ({ browser, baseURL, request }) => {
  await rest(request, 'PATCH', `member_artist_scopes?org_id=eq.${ORG}&user_id=eq.${ARTIST_B_ID}`, { contact_id: KILO });
  const ctx = await as(browser, baseURL!, kiloArtist);
  const body = await (await ctx.request.get(`/api/org/${ORG}/finance/statements`)).json();
  expect(ids(body.statements)).toEqual([statementIds.kiloIssued]);
  expect(ids((await readAs(request, kiloArtist, 'statements?select=id')).body)).toEqual([statementIds.kiloIssued]);
  expect(ids((await readAs(request, kiloArtist, 'payees?select=id')).body)).toHaveLength(1);
  await ctx.close();
});

test('6 · with the finance module off, nobody reads anything', async ({ browser, baseURL, request }) => {
  // The seed makes the producer a platform operator; the licence is set through the console's own function.
  await rest(request, 'POST', 'rpc/labelos_platform_set_entitlements', {
    p_actor: PRODUCER_ID, p_org: ORG, p_modules: ['contracts'], p_max_seats: null, p_max_artists: null, p_payload: { modules: ['contracts'] },
  });
  for (const who of [owner, kiloArtist]) {
    const ctx = await as(browser, baseURL!, who);
    expect((await ctx.request.get(`/api/org/${ORG}/finance/statements`)).status()).toBe(404);
    expect((await ctx.request.get(`/api/org/${ORG}/finance/payees`)).status()).toBe(404);
    expect((await readAs(request, who, 'statements?select=id')).body).toEqual([]);
    await ctx.close();
  }
  // (the licence row goes with the organization when it is deleted)
});

test('6b · an artist who is paid through finance cannot be removed from the directory, and the message says why', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const res = await ctx.request.delete(`/api/org/${ORG}/contacts/${NOVA}`);
  expect(res.status(), await res.text()).toBe(409);
  expect((await res.json()).error).toMatch(/finance/i);
  expect(await rest(request, 'GET', `contacts?select=id&id=eq.${NOVA}`)).toHaveLength(1);
  await ctx.close();
});

test('7 · the producer dashboard, the org shell and /store still load (1440 and 390)', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  for (const [name, path] of [['library', '/library'], ['org', `/o/${SLUG}`], ['store', '/store']] as const) {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      const res = await page.goto(path);
      expect(res?.status(), `${path} at ${w}`).toBeLessThan(400);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.screenshot({ path: `${D}/${name}-${w}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} scrolls sideways at ${w}px`).toBeLessThanOrEqual(0);
    }
  }
  await ctx.close();
});
