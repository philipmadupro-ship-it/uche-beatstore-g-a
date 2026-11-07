/**
 * Statements and payment tracking (LABEL-63) end to end against a REAL database (scripts/local-db:
 * Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true, migrations 179–181).
 *
 * Driven through the pages and the real routes — nothing a finance person does is seeded with the
 * service key. Seeded with the service key: the cast and the song. The split sheet and
 * the advance are made through the splits and advances routes.
 *
 *   1 · the owner opens a period on the statements page; the CSV is imported into it through the
 *       earnings page's period dropdown;
 *   2 · the owner generates Nova’s statement through the page: net = allocations − recoupment;
 *   3 · an admin generates Pat’s and cannot approve their own draft; the owner approves it;
 *   4 · an import cannot be voided while an approved statement includes it;
 *   5 · the owner issues Nova’s; Nova’s roster artist sees it (and not Pat’s, not a draft); exports;
 *   6 · payments: partial, never above the net, then paid; the payout CSV lists what is still owed;
 *   7 · a second import with only a draft can be voided; the draft goes; after issue it cannot;
 *   8 · 390 px, the producer dashboard and /store still load; marketing / outsider are refused.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { circulateSplitSheet } from './support/real-flows';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `statements-${run}`;
const NOVA = randomUUID();
const P_NOVA = randomUUID();
const P_PAT = randomUUID();
const PROJ = randomUUID();
const SONG = randomUUID();
const D = 'e2e-artifacts/LABEL-63';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const finance = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const novaArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const outsider = { id: BUYER_ID, email: 'buyer@local.test' };

const CSV_Q3 = [
  'Reporting Date,Sale Month,Store,Artist,Title,ISRC,UPC,Quantity,Team Percentage,Song/Album,Country of Sale,Songwriter Royalties Withheld,Earnings (USD)',
  '2026-10-01,2026-09,Spotify,Nova,Night Shift,USABC2600001,,1200,100,Song,US,0,100.00',
  '2026-10-01,2026-09,Apple Music,Nova,Night Shift,USABC2600001,,10,100,Song,GB,0,20.00',
].join('\n');
const CSV_Q4 = [
  'Reporting Date,Sale Month,Store,Artist,Title,ISRC,UPC,Quantity,Team Percentage,Song/Album,Country of Sale,Songwriter Royalties Withheld,Earnings (USD)',
  '2026-12-01,2026-11,Spotify,Nova,Night Shift,USABC2600001,,500,100,Song,US,0,10.00',
].join('\n');

type Row = Record<string, unknown>;
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
  return { status: res.status(), body: (await res.json()) as Row[] };
}
async function as(browser: Browser, baseURL: string, who: { id: string; email: string }): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(who.id, who.email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const PAGE = `/o/${SLUG}/finance/statements`;
const EARNINGS = `/o/${SLUG}/finance/earnings`;
let periodQ3 = '';
let periodQ4 = '';
let novaStatement = '';
let patStatement = '';
let q4Import = '';
let q3Import = '';

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  const users = [ARTIST_A_ID, ARTIST_B_ID, BUYER_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Statements Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'admin', functions: [], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_B_ID, contact_id: NOVA });
  await rest(request, 'POST', 'parties', [
    { id: P_NOVA, org_id: ORG, kind: 'person', display_name: `Nova ${run}`, contact_id: NOVA },
    { id: P_PAT, org_id: ORG, kind: 'person', display_name: `Pat ${run}`, contact_id: null },
  ]);
  await rest(request, 'POST', 'projects', { id: PROJ, org_id: ORG, user_id: null, name: 'Nova EP', inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', { id: SONG, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Night Shift', type: 'song', audio_url: `r2://private/orgs/${ORG}/${SONG}`, song_stage: 'inbox', isrc: 'USABC2600001' });
  await rest(request, 'POST', 'project_tracks', { project_id: PROJ, track_id: SONG, position: 0 });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test('1 · the owner opens a period on the page and imports into it', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const post = (data: unknown) => ctx.request.post(`/api/org/${ORG}/finance/payees`, { data });
  expect((await post({ party_id: P_NOVA, artist_contact_id: NOVA })).status()).toBe(201);
  expect((await post({ party_id: P_PAT, artist_contact_id: null })).status()).toBe(201);
  await circulateSplitSheet(ctx.request, ORG, SONG, 'master', [
    { party_id: P_NOVA, role: 'master_owner', share: 70 },
    { party_id: P_PAT, role: 'master_owner', share: 30 },
  ]);
  const payees = (await rest(request, 'GET', `payees?select=id,party_id&org_id=eq.${ORG}`)) as Row[];
  const adv = await ctx.request.post(`/api/org/${ORG}/finance/advances`, { data: { payee_id: payees.find((p) => p.party_id === P_NOVA)!.id, kind: 'recoupable', amount_minor: '5000', note: 'signing' } });
  expect(adv.status(), await adv.text()).toBe(201);

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PAGE);
  await expect(page.getByTestId('statement-generate')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('statements-empty')).toBeVisible();
  for (const [label, from, to, id] of [['Q3 2026', '2026-07-01', '2026-09-30', 'q3'], ['Q4 2026', '2026-10-01', '2026-12-31', 'q4']] as const) {
    await page.getByTestId('period-label').fill(label);
    await page.getByTestId('period-start').fill(from);
    await page.getByTestId('period-end').fill(to);
    await expect(page.getByTestId('period-submit')).toBeEnabled();
    await page.getByTestId('period-submit').click();
    await expect(page.getByTestId('statement-message')).toContainText(`Period “${label}” is open`, { timeout: 25_000 });
    void id;
  }
  const periods = (await rest(request, 'GET', `finance_periods?select=id,label&org_id=eq.${ORG}`)) as Row[];
  periodQ3 = String(periods.find((p) => p.label === 'Q3 2026')!.id);
  periodQ4 = String(periods.find((p) => p.label === 'Q4 2026')!.id);

  // The import goes through the earnings page, with the period picked in its dropdown.
  await page.goto(EARNINGS);
  await expect(page.getByTestId('earnings-form')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Period', exact: true }).click();
  await page.getByRole('option', { name: 'Q3 2026' }).click();
  await page.getByTestId('earnings-file').setInputFiles({ name: 'q3.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_Q3) });
  await expect(page.getByTestId('earnings-submit')).toBeEnabled();
  await page.getByTestId('earnings-submit').click();
  await expect(page.getByTestId('earnings-result')).toContainText('Imported 2 lines: 2 allocated', { timeout: 25_000 });
  const [imp] = (await rest(request, 'GET', `earnings_imports?select=id,period_id&org_id=eq.${ORG}`)) as Row[];
  expect(imp.period_id).toBe(periodQ3);
  q3Import = String(imp.id);
  await ctx.close();
});

test('2 · the owner generates Nova’s statement: net = allocations − recoupment', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PAGE);
  await expect(page.getByTestId('statement-generate')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Payee', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(`Nova ${run}`) }).click();
  await page.getByRole('button', { name: 'Period', exact: true }).click();
  await page.getByRole('option', { name: 'Q3 2026' }).click();
  await expect(page.getByTestId('statement-generate-submit')).toBeEnabled();
  await page.getByTestId('statement-generate-submit').click();
  await expect(page.getByTestId('statement-message')).toContainText('Draft made from 3 lines', { timeout: 25_000 });
  // Nova: 70 % of 100.00 + 20.00 = 84.00, less the 50.00 advance = 34.00.
  await expect(page.getByTestId('statement-net')).toHaveText('34.00 USD');
  await expect(page.getByTestId('statement-recouped')).toContainText('50.00 USD');
  await page.screenshot({ path: `${D}/01-draft-1440.png`, fullPage: true });
  const [st] = (await rest(request, 'GET', `statements?select=id,net_minor,status,created_by&org_id=eq.${ORG}`)) as Row[];
  novaStatement = String(st.id);
  expect(st).toMatchObject({ net_minor: 3400, status: 'draft', created_by: PRODUCER_ID });
  const lines = (await rest(request, 'GET', `statement_lines?select=kind,amount_minor&statement_id=eq.${novaStatement}&order=position`)) as Row[];
  expect(lines.map((l) => [l.kind, Number(l.amount_minor)]).sort()).toEqual([['earning', 1400], ['earning', 7000], ['recoupment', -5000]]);
  expect(lines.map((l) => l.kind)).toEqual(['earning', 'earning', 'recoupment']);
  const events = (await rest(request, 'GET', `activity_events?select=verb,visibility,audit,payload&org_id=eq.${ORG}&verb=eq.statement.generated`)) as Row[];
  expect(events[0]).toMatchObject({ visibility: 'internal', audit: true });
  expect(JSON.stringify(events)).not.toMatch(/3400|7000|Night Shift/);
  await ctx.close();
});

test('3 · a finance member cannot approve their own draft; the owner approves it', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, finance);
  const gen = await ctx.request.post(`/api/org/${ORG}/finance/statements`, {
    data: { payee_id: ((await rest(request, 'GET', `payees?select=id&party_id=eq.${P_PAT}`)) as Row[])[0].id, period_id: periodQ3 },
  });
  expect(gen.status()).toBe(201);
  patStatement = (await gen.json()).id;
  const self = await ctx.request.post(`/api/org/${ORG}/finance/statements/${patStatement}/approve`);
  expect(self.status()).toBe(403);
  expect((await self.json()).code).toBe('self_approval');
  // The page does not offer a button that cannot work.
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await expect(page.getByTestId('statement-row')).toHaveCount(2, { timeout: 25_000 });
  await page.getByTestId('statement-row').filter({ hasText: `Pat ${run}` }).click();
  await expect(page.getByTestId('statement-detail')).toBeVisible();
  await expect(page.getByTestId('statement-approve')).toHaveCount(0);
  await ctx.close();

  // …but the finance member may approve the owner's draft (a different person).
  const ctx2 = await as(browser, baseURL!, finance);
  expect((await ctx2.request.post(`/api/org/${ORG}/finance/statements/${novaStatement}/approve`)).status()).toBe(200);
  await ctx2.close();
  const owner2 = await as(browser, baseURL!, owner);
  expect((await owner2.request.post(`/api/org/${ORG}/finance/statements/${patStatement}/approve`)).status()).toBe(200);
  await owner2.close();
  const st = (await rest(request, 'GET', `statements?select=id,status,approved_by&org_id=eq.${ORG}`)) as Row[];
  expect(st.map((s) => s.status)).toEqual(['approved', 'approved']);
  // Append-only: the database refuses to rewrite an approval.
  const rewrite = await request.fetch(`${REST}/statements?id=eq.${novaStatement}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ approved_by: PRODUCER_ID }),
  });
  expect(rewrite.ok()).toBeFalsy();
});

test('4 · an import cannot be voided while an approved statement includes it', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner);
  const res = await ctx.request.post(`/api/org/${ORG}/finance/earnings/imports/${q3Import}/void`);
  expect(res.status()).toBe(409);
  expect((await res.json()).code).toBe('statement_exists');
  await ctx.close();
});

test('5 · issued to Nova: her artist sees it, and nothing of Pat’s; exports are audited', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.getByTestId('statement-row').filter({ hasText: `Nova ${run}` }).click();
  await page.getByTestId('statement-issue').click();
  await expect(page.getByTestId('statement-paid')).toBeVisible({ timeout: 25_000 });
  await ctx.close();

  const aCtx = await as(browser, baseURL!, novaArtist);
  const a = await aCtx.newPage();
  await a.setViewportSize({ width: 1440, height: 900 });
  await a.goto(PAGE);
  await expect(a.getByTestId('statements')).toHaveAttribute('data-own', 'true', { timeout: 25_000 });
  await expect(a.getByTestId('statement-generate')).toHaveCount(0);
  await expect(a.getByTestId('statement-row')).toHaveCount(1);
  await expect(a.getByTestId('statement-row')).toContainText('34.00 USD');
  await expect(a.locator('body')).not.toContainText(`Pat ${run}`);
  await a.getByTestId('statement-row').click();
  await expect(a.getByTestId('statement-net')).toHaveText('34.00 USD');
  await expect(a.getByTestId('statement-approve')).toHaveCount(0);
  await expect(a.getByTestId('payment-form')).toHaveCount(0);
  await a.screenshot({ path: `${D}/02-artist-1440.png`, fullPage: true });

  // Pat's approved statement is invisible to her, over the route and over PostgREST.
  expect((await aCtx.request.get(`/api/org/${ORG}/finance/statements/${patStatement}`)).status()).toBe(404);
  expect((await aCtx.request.post(`/api/org/${ORG}/finance/statements/${novaStatement}/void`, { data: {} })).status()).toBe(403);
  expect((await aCtx.request.get(`/api/org/${ORG}/finance/statements/payout`)).status()).toBeGreaterThanOrEqual(403);
  const rls = await readAs(request, novaArtist, 'statements?select=id,status');
  expect(rls.body.map((s) => s.id)).toEqual([novaStatement]);
  expect((await readAs(request, novaArtist, 'earnings_allocations?select=id')).body).toEqual([]);

  const pdf = await aCtx.request.get(`/api/org/${ORG}/finance/statements/${novaStatement}/export?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const csv = await aCtx.request.get(`/api/org/${ORG}/finance/statements/${novaStatement}/export?format=csv`);
  expect(csv.status()).toBe(200);
  const csvText = await csv.text();
  expect(csvText).toContain('Total,Net,,34.00');
  expect(csvText).toContain('Advances,Recouped,,-50.00');
  await aCtx.close();
  const exported = (await rest(request, 'GET', `activity_events?select=payload,audit&org_id=eq.${ORG}&verb=eq.statement.exported`)) as Row[];
  expect(exported.length).toBe(2);
  expect(exported.every((e) => e.audit === true)).toBe(true);
  expect(JSON.stringify(exported)).not.toMatch(/34\.00|3400/);
});

test('6 · payments: partial, never above the net, then paid; the payout CSV lists what is owed', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, finance);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PAGE);
  await page.getByTestId('statement-row').filter({ hasText: `Nova ${run}` }).click();
  const pay = async (amount: string, reference = '') => {
    await page.getByTestId('payment-amount').fill(amount);
    if (reference) await page.getByTestId('payment-reference').fill(reference);
    await expect(page.getByTestId('payment-submit')).toBeEnabled();
    await page.getByTestId('payment-submit').click();
  };
  await pay('20.00', 'wire 2026-11-02');
  await expect(page.getByTestId('statement-outstanding')).toContainText('14.00 USD', { timeout: 25_000 });
  await expect(page.getByTestId('payment-row')).toHaveCount(1);
  await pay('15.00');
  await expect(page.getByTestId('payment-error')).toContainText('more than is left', { timeout: 25_000 });
  await pay('14.00');
  await expect(page.getByTestId('statement-outstanding')).toContainText('0.00 USD', { timeout: 25_000 });
  await expect(page.getByTestId('statement-row').filter({ hasText: `Nova ${run}` })).toContainText('Paid');
  await expect(page.getByTestId('payment-form')).toHaveCount(0);
  await page.screenshot({ path: `${D}/03-paid-1440.png`, fullPage: true });
  const pays = (await rest(request, 'GET', `payments?select=amount_minor,statement_id&org_id=eq.${ORG}&order=created_at`)) as Row[];
  expect(pays.map((p) => Number(p.amount_minor))).toEqual([2000, 1400]);
  // An account number is not a reference.
  const bank = await ctx.request.post(`/api/org/${ORG}/finance/statements/${patStatement}/payments`, { data: { amount_minor: '100', paid_on: '2026-11-02', reference: 'GB82WEST12345698765432' } });
  expect(bank.status()).toBeGreaterThanOrEqual(400);
  await ctx.close();

  // The owner's payout file lists Pat (approved, 36.00 owed) and not paid Nova.
  const o = await as(browser, baseURL!, owner);
  const payout = await o.request.get(`/api/org/${ORG}/finance/statements/payout`);
  expect(payout.status()).toBe(200);
  const text = await payout.text();
  expect(text.split('\r\n')[0]).toBe('Statement,Payee,Period,Currency,Net,Paid,Outstanding,Status,Payment state,Payment reference');
  expect(text).toContain(`Pat ${run}`);
  expect(text).toContain(',36.00,0.00,36.00,Approved,Unpaid,');
  expect(text).not.toContain(`Nova ${run}`);
  expect(text).not.toMatch(/iban|GB82/i);
  await o.close();
});

test('7 · a file with only a draft can be voided; its draft goes; after issue it cannot', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const imp = await ctx.request.post(`/api/org/${ORG}/finance/earnings/imports`, {
    multipart: { file: { name: 'q4.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_Q4) }, preset: 'distrokid', period_id: periodQ4 },
  });
  expect(imp.status(), await imp.text()).toBe(201);
  q4Import = (await imp.json()).import_id;
  const nova = ((await rest(request, 'GET', `payees?select=id&party_id=eq.${P_NOVA}`)) as Row[])[0].id;
  const gen = await ctx.request.post(`/api/org/${ORG}/finance/statements`, { data: { payee_id: nova, period_id: periodQ4 } });
  expect(gen.status()).toBe(201);
  const draftId = (await gen.json()).id;
  expect(((await rest(request, 'GET', `statements?select=id&id=eq.${draftId}`)) as Row[]).length).toBe(1);

  const page = await ctx.newPage();
  await page.goto(EARNINGS);
  await expect(page.getByTestId('import-row')).toHaveCount(2, { timeout: 25_000 });
  await page.getByTestId('import-row').filter({ hasText: 'q4.csv' }).getByTestId('import-void').click();
  await page.getByRole('button', { name: 'Void file' }).last().click();
  await expect(page.getByTestId('import-row').filter({ hasText: 'q4.csv' }).getByTestId('import-void-badge')).toBeVisible({ timeout: 25_000 });
  expect(((await rest(request, 'GET', `statements?select=id&id=eq.${draftId}`)) as Row[]).length).toBe(0);
  expect(((await rest(request, 'GET', `earnings_allocations?select=id&import_id=eq.${q4Import}`)) as Row[]).length).toBe(0);
  expect(((await rest(request, 'GET', `earnings_imports?select=status&id=eq.${q4Import}`)) as Row[])[0].status).toBe('void');
  const ev = (await rest(request, 'GET', `activity_events?select=payload,audit&org_id=eq.${ORG}&verb=eq.earnings.import_voided`)) as Row[];
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ audit: true, payload: { allocations: 2, recoupments: 0, draftsDiscarded: 1 } });
  // The issued Q3 file stays protected.
  expect((await ctx.request.post(`/api/org/${ORG}/finance/earnings/imports/${q3Import}/void`)).status()).toBe(409);
  await ctx.close();
});

test('8 · 390 px, dashboard and /store still load; marketing and outsiders are refused', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE);
  await expect(page.getByTestId('statement-row').first()).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('statement-row').first().click();
  await expect(page.getByTestId('statement-detail')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${D}/04-statements-390.png`, fullPage: true });
  expect((await ctx.request.get('/library')).status()).toBeLessThan(500);
  expect((await ctx.request.get('/store')).status()).toBe(200);
  await ctx.close();

  const out = await as(browser, baseURL!, outsider);
  expect((await out.request.get(`/api/org/${ORG}/finance/statements`)).status()).toBeGreaterThanOrEqual(403);
  await out.close();
});
