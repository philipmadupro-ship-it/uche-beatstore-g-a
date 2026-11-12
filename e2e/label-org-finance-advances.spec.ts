/**
 * Advances, finance overview and period close (LABEL-64) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true, migrations 179–182).
 *
 * Driven through the pages and the real routes. The advances are NOT seeded with the service key:
 * the owner records and corrects them on the Advances page.
 *
 *   1 · the owner records a recoupable and a non-recoupable advance on the page, corrects one;
 *   2 · an earnings file recoups the advance; the row becomes fixed and says so;
 *   3 · the overview shows the position; the draft statement blocks the close; once issued the
 *       owner closes the period on the page;
 *   4 · a closed period refuses a new import and statement; a finance admin cannot reopen, the
 *       owner can, on the page;
 *   5 · a roster artist gets 404 on both pages; 390 px; /store and the producer dashboard load.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';
import { circulateSplitSheet } from './support/real-flows';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `finance64-${run}`;
const NOVA = randomUUID();
const P_NOVA = randomUUID();
const P_PAT = randomUUID();
const PROJ = randomUUID();
const SONG = randomUUID();
const D = 'e2e-artifacts/LABEL-64';

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

const ADV = `/o/${SLUG}/finance/advances`;
const OVERVIEW = `/o/${SLUG}/finance`;
const EARNINGS = `/o/${SLUG}/finance/earnings`;
let periodQ3 = '';
let payeeNova = '';
let novaStatement = '';

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  const users = [ARTIST_A_ID, ARTIST_B_ID, BUYER_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Finance Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
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
  // A release of Nova's song with a marketing plan that spent 15.00 (LABEL-65's table, seeded: not this task's feature).
  const [rel] = (await rest(request, 'POST', 'releases', { org_id: ORG, project_id: PROJ, contact_id: NOVA, title: 'Night Shift EP', type: 'single', created_by: PRODUCER_ID })) as Row[];
  await rest(request, 'POST', 'release_items', { release_id: rel.id, org_id: ORG, position: 1, song_track_id: SONG, master_track_id: SONG });
  const [plan] = (await rest(request, 'POST', 'marketing_plans', { org_id: ORG, release_id: rel.id })) as Row[];
  await rest(request, 'POST', 'marketing_budget_lines', [
    { org_id: ORG, plan_id: plan.id, label: 'Ads', amount_minor: 1500, currency: 'USD', status: 'spent' },
    { org_id: ORG, plan_id: plan.id, label: 'Video', amount_minor: 4000, currency: 'USD', status: 'planned' },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test('1 · the owner records and corrects advances on the page', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const post = (data: unknown) => ctx.request.post(`/api/org/${ORG}/finance/payees`, { data });
  expect((await post({ party_id: P_NOVA, artist_contact_id: NOVA })).status()).toBe(201);
  expect((await post({ party_id: P_PAT, artist_contact_id: null })).status()).toBe(201);
  await circulateSplitSheet(ctx.request, ORG, SONG, 'master', [
    { party_id: P_NOVA, role: 'master_owner', share: 70 },
    { party_id: P_PAT, role: 'master_owner', share: 30 },
  ]);
  payeeNova = String(((await rest(request, 'GET', `payees?select=id&party_id=eq.${P_NOVA}`)) as Row[])[0].id);

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ADV);
  await expect(page.getByTestId('advance-form')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('advances-empty')).toBeVisible();

  async function record(payee: string, kindLabel: RegExp | null, amount: string, note: string) {
    await page.getByRole('button', { name: 'Payee', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(payee) }).click();
    if (kindLabel) {
      await page.getByRole('button', { name: 'Kind', exact: true }).first().click();
      await page.getByRole('option', { name: kindLabel }).click();
    }
    await page.getByTestId('advance-amount').fill(amount);
    await page.getByTestId('advance-note').fill(note);
    await expect(page.getByTestId('advance-submit')).toBeEnabled();
    await page.getByTestId('advance-submit').click();
    await expect(page.getByTestId('advance-message')).toContainText('Advance recorded', { timeout: 25_000 });
  }
  await page.getByTestId('advance-amount').fill('abc');
  await page.getByTestId('advance-submit').click();
  await expect(page.getByTestId('advance-message')).toContainText(/Choose who|Enter an amount/);
  await record(`Nova ${run}`, null, '50.00', 'signing');
  await record(`Pat ${run}`, /^Non-recoupable/, '10.00', 'goodwill');
  await expect(page.getByTestId('advance-row')).toHaveCount(2);
  const rows = (await rest(request, 'GET', `advances?select=kind,amount_minor,currency,payee_id&org_id=eq.${ORG}&order=created_at`)) as Row[];
  expect(rows.map((r) => [r.kind, Number(r.amount_minor), r.currency])).toEqual([['recoupable', 5000, 'USD'], ['non_recoupable', 1000, 'USD']]);

  // Correct Nova's advance (nothing references it yet): 50.00 → 100.00.
  await page.getByTestId('advance-row').filter({ hasText: 'signing' }).getByTestId('advance-edit').click();
  await page.getByTestId('advance-edit-amount').fill('100.00');
  await page.getByTestId('advance-save').click();
  await expect(page.getByTestId('advance-row').filter({ hasText: 'signing' }).getByTestId('advance-amount-shown')).toHaveText('100.00 USD', { timeout: 25_000 });
  await page.screenshot({ path: `${D}/01-advances-1440.png`, fullPage: true });
  const events = (await rest(request, 'GET', `activity_events?select=verb,visibility,audit,payload&org_id=eq.${ORG}&verb=like.advance.*`)) as Row[];
  expect(events.map((e) => e.verb).sort()).toEqual(['advance.created', 'advance.created', 'advance.updated']);
  expect(events.every((e) => e.audit === true && e.visibility === 'internal')).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/10000|5000|1000"/);
  await ctx.close();
});

test('2 · an earnings file recoups the advance and the row becomes fixed', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const made = await ctx.request.post(`/api/org/${ORG}/finance/periods`, { data: { label: 'Q3 2026', starts_on: '2026-07-01', ends_on: '2026-09-30' } });
  expect(made.status()).toBe(201);
  periodQ3 = String(((await rest(request, 'GET', `finance_periods?select=id&org_id=eq.${ORG}`)) as Row[])[0].id);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EARNINGS);
  await expect(page.getByTestId('earnings-form')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Period', exact: true }).click();
  await page.getByRole('option', { name: 'Q3 2026' }).click();
  await page.getByTestId('earnings-file').setInputFiles({ name: 'q3.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_Q3) });
  await expect(page.getByTestId('earnings-submit')).toBeEnabled();
  await page.getByTestId('earnings-submit').click();
  await expect(page.getByTestId('earnings-result')).toContainText('Imported 2 lines: 2 allocated', { timeout: 25_000 });

  await page.goto(ADV);
  const row = page.getByTestId('advance-row').filter({ hasText: 'signing' });
  await expect(row).toBeVisible({ timeout: 25_000 });
  await expect(row.getByTestId('advance-status')).toHaveText('Partly recouped');
  // Nova earns 70 % of 120.00 = 84.00, all recouped against 100.00: 16.00 is left.
  await expect(row.getByTestId('advance-remaining')).toContainText('16.00 USD left');
  await expect(row.getByTestId('advance-fixed')).toBeVisible();
  await expect(row.getByTestId('advance-void')).toHaveCount(0);
  await row.getByTestId('advance-edit').click();
  await expect(page.getByTestId('advance-edit-amount')).toBeDisabled();
  await page.screenshot({ path: `${D}/02-advance-fixed-1440.png`, fullPage: true });

  const adv = (await rest(request, 'GET', `advances?select=id&org_id=eq.${ORG}&payee_id=eq.${payeeNova}`)) as Row[];
  const refused = await ctx.request.patch(`/api/org/${ORG}/finance/advances/${adv[0].id}`, { data: { amount_minor: '9999' } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe('advance_referenced');
  expect((await ctx.request.patch(`/api/org/${ORG}/finance/advances/${adv[0].id}`, { data: { note: 'signing (recouped)' } })).status()).toBe(200);
  expect((await ctx.request.post(`/api/org/${ORG}/finance/advances/${adv[0].id}/void`)).status()).toBe(409);
  const recs = (await rest(request, 'GET', `earnings_recoupments?select=amount_minor&org_id=eq.${ORG}`)) as Row[];
  expect(recs.reduce((s, r) => s + Number(r.amount_minor), 0)).toBe(8400);
  await ctx.close();
});

test('3 · the overview shows the position; a draft blocks the close; the owner closes', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const gen = await ctx.request.post(`/api/org/${ORG}/finance/statements`, { data: { payee_id: payeeNova, period_id: periodQ3 } });
  expect(gen.status()).toBe(201);
  novaStatement = (await gen.json()).id;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(OVERVIEW);
  await expect(page.getByTestId('finance-dashboard')).toBeVisible({ timeout: 25_000 });
  const nova = page.getByTestId('position-row').filter({ hasText: `Nova ${run}` });
  await expect(nova.getByTestId('pos-unrecouped')).toHaveText('16.00 USD');
  // Income against cost: 120.00 earned on Nova's one release, 120.00 owed out as royalties, 15.00 spent (planned spend is not a cost).
  const release = page.getByTestId('release-row').filter({ hasText: 'Night Shift EP' });
  await expect(release.getByTestId('rel-gross')).toHaveText('120.00 USD');
  await expect(release.getByTestId('rel-margin')).toHaveText('-15.00 USD');
  const period = page.getByTestId('period-row').first();
  await expect(period.getByTestId('period-blocked')).toContainText('draft statement');
  await expect(period.getByTestId('period-close')).toHaveCount(0);
  const blocked = await ctx.request.post(`/api/org/${ORG}/finance/periods/${periodQ3}/close`);
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).code).toBe('drafts_open');

  // approved by a different person, then issued
  const fin = await as(browser, baseURL!, finance);
  expect((await fin.request.post(`/api/org/${ORG}/finance/statements/${novaStatement}/approve`)).status()).toBe(200);
  await fin.close();
  expect((await ctx.request.post(`/api/org/${ORG}/finance/statements/${novaStatement}/issue`)).status()).toBe(200);

  await page.reload();
  await expect(page.getByTestId('period-row').first().getByTestId('period-close')).toBeVisible({ timeout: 25_000 });
  await page.screenshot({ path: `${D}/03-overview-1440.png`, fullPage: true });
  await page.getByTestId('period-close').click();
  await page.getByRole('button', { name: 'Close period' }).click();
  await expect(page.getByTestId('period-row').first().getByTestId('period-status')).toHaveText('Closed', { timeout: 25_000 });
  const [p] = (await rest(request, 'GET', `finance_periods?select=status,closed_by&id=eq.${periodQ3}`)) as Row[];
  expect(p).toMatchObject({ status: 'closed', closed_by: PRODUCER_ID });
  const events = (await rest(request, 'GET', `activity_events?select=verb,audit&org_id=eq.${ORG}&verb=eq.period.closed`)) as Row[];
  expect(events).toHaveLength(1);
  await ctx.close();
});

test('4 · a closed period refuses new work; only the owner reopens', async ({ browser, baseURL, request }) => {
  const fin = await as(browser, baseURL!, finance);
  const csv = [CSV_Q3.split('\n')[0], '2026-10-01,2026-09,Tidal,Nova,Night Shift,USABC2600001,,5,100,Song,US,0,5.00'].join('\n');
  const form = { multipart: { file: { name: 'late.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }, preset: 'auto', period_id: periodQ3, income_class: 'master' } };
  const late = await fin.request.post(`/api/org/${ORG}/finance/earnings/imports`, form);
  expect(late.ok()).toBeFalsy();
  expect(await late.text()).toMatch(/closed|not open/i);
  expect(((await rest(request, 'GET', `earnings_imports?select=id&org_id=eq.${ORG}&period_id=eq.${periodQ3}`)) as Row[]).length).toBe(1);
  const gen = await fin.request.post(`/api/org/${ORG}/finance/statements`, { data: { payee_id: payeeNova, period_id: periodQ3 } });
  expect(gen.ok()).toBeFalsy();
  expect((await fin.request.post(`/api/org/${ORG}/finance/periods/${periodQ3}/reopen`)).status()).toBe(403);
  const page = await fin.newPage();
  await page.goto(OVERVIEW);
  await expect(page.getByTestId('period-row').first().getByTestId('period-status')).toHaveText('Closed', { timeout: 25_000 });
  await expect(page.getByTestId('period-reopen')).toHaveCount(0);
  await fin.close();

  const ctx = await as(browser, baseURL!, owner);
  const op = await ctx.newPage();
  await op.setViewportSize({ width: 1440, height: 900 });
  await op.goto(OVERVIEW);
  await op.getByTestId('period-reopen').click();
  await op.getByRole('button', { name: 'Reopen period' }).click();
  await expect(op.getByTestId('period-row').first().getByTestId('period-status')).toHaveText('Open', { timeout: 25_000 });
  const ev = (await rest(request, 'GET', `activity_events?select=verb&org_id=eq.${ORG}&verb=eq.period.reopened`)) as Row[];
  expect(ev).toHaveLength(1);
  await ctx.close();
});

test('5 · a roster artist is refused; 390 px; producer dashboard and /store still load', async ({ browser, baseURL }) => {
  const art = await as(browser, baseURL!, novaArtist);
  for (const path of [ADV, OVERVIEW]) {
    const res = await art.request.get(path);
    expect(res.status()).toBe(404);
  }
  expect((await art.request.get(`/api/org/${ORG}/finance/advances`)).status()).toBeGreaterThanOrEqual(403);
  expect((await art.request.get(`/api/org/${ORG}/finance/dashboard`)).status()).toBeGreaterThanOrEqual(403);
  await art.close();

  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(OVERVIEW);
  await expect(page.getByTestId('finance-dashboard')).toBeVisible({ timeout: 25_000 });
  await page.screenshot({ path: `${D}/04-overview-390.png`, fullPage: true });
  await page.goto(ADV);
  await expect(page.getByTestId('advances')).toBeVisible({ timeout: 25_000 });
  await page.screenshot({ path: `${D}/05-advances-390.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect((await ctx.request.get('/store')).status()).toBe(200);
  expect((await ctx.request.get('/library')).status()).toBe(200);
  await ctx.close();
});
