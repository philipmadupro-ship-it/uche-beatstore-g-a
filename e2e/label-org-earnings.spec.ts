/**
 * Earnings import and royalty calculation (LABEL-62) end to end against a REAL
 * database (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true,
 * migrations 179 and 180 included).
 *
 * The import is driven through the page, a file picker and the real routes —
 * nothing a finance person does is seeded with the service key. Seeded with the
 * service key: the cast, the songs, their circulated split sheets and an
 * advance (advances have no screen until LABEL-64).
 *
 *   1 · the owner imports a DistroKid-style CSV on /o/<slug>/finance/earnings:
 *       fractional cents are refused until "round fractional cents" is ticked;
 *       the result says what was allocated and what waits;
 *   2 · the stored rows add up: allocations of a line sum to the line, the
 *       advance is recouped first, nothing is negative;
 *   3 · the same file again changes nothing (no new import, no new rows);
 *   4 · the review queue lists the three waiting lines with their reasons;
 *   5 · a finance member limited to Nova sees only Nova's waiting line (not the
 *       unmatched one, not Kilo's), and cannot import;
 *   6 · circulating the missing sheet and pressing "Re-run" allocates that line;
 *   7 · 390 px; the producer dashboard and /store still load;
 *   8 · marketing, a roster artist and an outsider are refused; the module off → 404.
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
const SLUG = `earnings-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const P_NOVA = randomUUID();
const P_PAT = randomUUID();
const P_KILO = randomUUID();
const PROJ_NOVA = randomUUID();
const PROJ_KILO = randomUUID();
const SONG_NIGHT = randomUUID(); // Nova's, sheet: Nova 70 / Pat 30
const SONG_NOSHEET = randomUUID(); // Nova's, no sheet yet
const SONG_KILO = randomUUID(); // Kilo's, no sheet
const D = 'e2e-artifacts/LABEL-62';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const financeScoped = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const rosterArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const outsider = { id: BUYER_ID, email: 'buyer@local.test' };

const CSV = [
  'Reporting Date,Sale Month,Store,Artist,Title,ISRC,UPC,Quantity,Team Percentage,Song/Album,Country of Sale,Songwriter Royalties Withheld,Earnings (USD)',
  '2026-10-01,2026-09,Spotify,Nova,Night Shift,US-ABC-26-00001,,1200,100,Song,US,0,100.01',
  '2026-10-01,2026-09,Apple Music,Nova,Night Shift,USABC2600001,,10,100,Song,GB,0,1.005',
  '2026-10-01,2026-09,Spotify,Kilo,Kilo Tune,US-ABC-26-00002,,5,100,Song,US,0,2.00',
  '2026-10-01,2026-09,Spotify,Nobody,Ghost,US-ZZZ-26-00000,,5,100,Song,US,0,3.00',
  '2026-10-01,2026-09,Spotify,Nova,Waiting,US-ABC-26-00003,,5,100,Song,US,0,4.00',
].join('\n');

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
const PAGE = `/o/${SLUG}/finance/earnings`;
let importId = '';

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  const users = [ARTIST_A_ID, ARTIST_B_ID, BUYER_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Earnings Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
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
  await rest(request, 'POST', 'parties', [
    { id: P_NOVA, org_id: ORG, kind: 'person', display_name: `Nova ${run}`, contact_id: NOVA },
    { id: P_PAT, org_id: ORG, kind: 'person', display_name: `Pat ${run}`, contact_id: null },
    { id: P_KILO, org_id: ORG, kind: 'person', display_name: `Kilo ${run}`, contact_id: KILO },
  ]);
  await rest(request, 'POST', 'projects', [
    { id: PROJ_NOVA, org_id: ORG, user_id: null, name: 'Nova EP', inbox_for_contact_id: NOVA },
    { id: PROJ_KILO, org_id: ORG, user_id: null, name: 'Kilo EP', inbox_for_contact_id: KILO },
  ]);
  const song = (id: string, title: string, isrc: string) => ({ id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', audio_url: `r2://private/orgs/${ORG}/${id}`, song_stage: 'inbox', isrc });
  await rest(request, 'POST', 'tracks', [song(SONG_NIGHT, 'Night Shift', 'USABC2600001'), song(SONG_KILO, 'Kilo Tune', 'USABC2600002'), song(SONG_NOSHEET, 'Waiting', 'USABC2600003')]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: PROJ_NOVA, track_id: SONG_NIGHT, position: 0 },
    { project_id: PROJ_NOVA, track_id: SONG_NOSHEET, position: 1 },
    { project_id: PROJ_KILO, track_id: SONG_KILO, position: 0 },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test('1 · the owner makes payees through the route, a sheet circulates, an advance exists', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const post = (data: unknown) => ctx.request.post(`/api/org/${ORG}/finance/payees`, { data });
  expect((await post({ party_id: P_NOVA, artist_contact_id: NOVA })).status()).toBe(201);
  expect((await post({ party_id: P_PAT, artist_contact_id: null })).status()).toBe(201);
  expect((await post({ party_id: P_KILO, artist_contact_id: KILO })).status()).toBe(201);
  await ctx.close();

  // Night Shift: Nova 70 % / Pat 30 % master sheet, circulated.
  const [sheet] = (await rest(request, 'POST', 'split_sheets', { org_id: ORG, track_id: SONG_NIGHT, kind: 'master', version: 1 })) as Row[];
  await rest(request, 'POST', 'split_lines', [
    { split_sheet_id: sheet.id, party_id: P_NOVA, role: 'master_owner', share: 70, position: 0 },
    { split_sheet_id: sheet.id, party_id: P_PAT, role: 'master_owner', share: 30, position: 1 },
  ]);
  await rest(request, 'PATCH', `split_sheets?id=eq.${sheet.id}`, { status: 'circulated', circulated_at: new Date().toISOString() });
  // Nova's recoupable advance: $50.00.
  const payees = (await rest(request, 'GET', `payees?select=id,party_id&org_id=eq.${ORG}`)) as Row[];
  const nova = String(payees.find((p) => p.party_id === P_NOVA)!.id);
  await rest(request, 'POST', 'advances', { org_id: ORG, payee_id: nova, kind: 'recoupable', amount_minor: 5000, currency: 'USD', note: 'signing' });
});

test('2 · import through the page: fractional cents are refused, then rounded on request', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PAGE);
  await expect(page.getByTestId('earnings-form')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('earnings-imports')).toContainText('No file imported yet');

  await page.getByTestId('earnings-file').setInputFiles({ name: 'distrokid-sept.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByTestId('earnings-submit')).toBeEnabled();
  await page.getByTestId('earnings-submit').click();
  await expect(page.getByTestId('earnings-error')).toContainText('could not be read', { timeout: 25_000 });
  await expect(page.getByTestId('earnings-error')).toContainText('Line 3');
  await expect(page.getByTestId('earnings-imports')).toContainText('No file imported yet');
  await page.screenshot({ path: `${D}/01-refused-1440.png`, fullPage: true });

  await page.getByTestId('earnings-round').check();
  await expect(page.getByTestId('earnings-submit')).toBeEnabled();
  await page.getByTestId('earnings-submit').click();
  await expect(page.getByTestId('earnings-result')).toContainText('Imported 5 lines: 2 allocated, 3 waiting for review, 1 rounded to the cent', { timeout: 25_000 });
  await expect(page.getByTestId('import-row')).toHaveCount(1);
  await expect(page.getByTestId('import-row')).toContainText('distrokid-sept.csv');
  await expect(page.getByTestId('import-row')).toContainText('110.01 USD');
  await page.screenshot({ path: `${D}/02-imported-1440.png`, fullPage: true });

  // 4 · the queue: three waiting lines, each with its reason.
  const reasons = await page.getByTestId('queue-line').evaluateAll((els) => els.map((e) => e.getAttribute('data-reason')).sort());
  expect(reasons).toEqual(['no_match', 'no_sheet', 'no_sheet']);
  await expect(page.getByTestId('earnings-queue')).toContainText('Needs review · 3');
  await ctx.close();
});

test('3 · the stored rows add up, the advance is recouped first, nothing goes negative', async ({ request }) => {
  const [imp] = (await rest(request, 'GET', `earnings_imports?select=id,row_count,total_minor,source&org_id=eq.${ORG}`)) as Row[];
  importId = String(imp.id);
  expect(imp).toMatchObject({ row_count: 5, total_minor: 11001, source: 'DistroKid' });
  const lines = (await rest(request, 'GET', `earnings_lines?select=id,line_no,gross_minor,review_reason&import_id=eq.${importId}&order=line_no`)) as Row[];
  expect(lines.map((l) => [l.line_no, l.gross_minor, l.review_reason])).toEqual([
    [2, 10001, null], [3, 100, null], [4, 200, 'no_sheet'], [5, 300, 'no_match'], [6, 400, 'no_sheet'],
  ]);
  const allocs = (await rest(request, 'GET', `earnings_allocations?select=line_id,payee_id,party_id,payable_minor,basis&import_id=eq.${importId}`)) as Row[];
  for (const l of lines.filter((x) => x.review_reason === null)) {
    expect(allocs.filter((a) => a.line_id === l.id).reduce((s, a) => s + Number(a.payable_minor), 0)).toBe(l.gross_minor);
  }
  const byParty = (party: string, lineNo: number) => allocs.find((a) => a.party_id === party && a.line_id === lines.find((l) => l.line_no === lineNo)!.id)!;
  // 10001 × 70/30: largest remainder gives the extra cent to Nova (7001 / 3000); 100 splits 70 / 30.
  expect([Number(byParty(P_NOVA, 2).payable_minor), Number(byParty(P_PAT, 2).payable_minor)]).toEqual([7001, 3000]);
  expect([Number(byParty(P_NOVA, 3).payable_minor), Number(byParty(P_PAT, 3).payable_minor)]).toEqual([70, 30]);
  const rec = (await rest(request, 'GET', `earnings_recoupments?select=amount_minor&import_id=eq.${importId}`)) as Row[];
  // The $50.00 advance is taken from Nova's first allocation only: 5000 of 7001.
  expect(rec.map((r) => Number(r.amount_minor))).toEqual([5000]);
  const [adv] = (await rest(request, 'GET', `advances?select=amount_minor&org_id=eq.${ORG}`)) as Row[];
  expect(Number(adv.amount_minor) - rec.reduce((s, r) => s + Number(r.amount_minor), 0)).toBe(0);
  // The activity feed has the event with counts only.
  const events = (await rest(request, 'GET', `activity_events?select=verb,visibility,payload&org_id=eq.${ORG}&verb=eq.earnings.imported`)) as Row[];
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ visibility: 'internal', payload: { lines: 5, allocated: 2, waiting: 3, allocations: 4, recoupments: 1 } });
  expect(JSON.stringify(events)).not.toMatch(/Night Shift|Spotify|11001/);
});

test('4 · importing the same file again changes nothing', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.getByTestId('earnings-file').setInputFiles({ name: 'again.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await page.getByTestId('earnings-round').check();
  await page.getByTestId('earnings-submit').click();
  await expect(page.getByTestId('earnings-result')).toContainText('imported before', { timeout: 25_000 });
  await ctx.close();
  expect(((await rest(request, 'GET', `earnings_imports?select=id&org_id=eq.${ORG}`)) as Row[]).length).toBe(1);
  expect(((await rest(request, 'GET', `earnings_lines?select=id&org_id=eq.${ORG}`)) as Row[]).length).toBe(5);
  expect(((await rest(request, 'GET', `earnings_allocations?select=id&org_id=eq.${ORG}`)) as Row[]).length).toBe(4);
  expect(((await rest(request, 'GET', `activity_events?select=id&org_id=eq.${ORG}&verb=eq.earnings.imported`)) as Row[]).length).toBe(1);
});

test('5 · a finance member limited to Nova sees only Nova’s waiting line and cannot import', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, financeScoped);
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await expect(page.getByTestId('earnings-queue')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('earnings-form')).toHaveCount(0);
  await expect(page.getByTestId('earnings-readonly')).toBeVisible();
  await expect(page.getByTestId('queue-line')).toHaveCount(1);
  await expect(page.getByTestId('queue-line')).toContainText('Waiting');
  await expect(page.getByTestId('earnings-queue')).not.toContainText('Kilo Tune');
  await expect(page.getByTestId('earnings-queue')).not.toContainText('Ghost');
  await expect(page.getByTestId('earnings-queue')).not.toContainText('US-ZZZ');
  await page.screenshot({ path: `${D}/03-scoped-1440.png`, fullPage: true });
  const post = await ctx.request.post(`/api/org/${ORG}/finance/earnings/imports`, { multipart: { file: { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('ISRC,Amount\nUSABC2600001,1.00\n') }, preset: 'generic', currency: 'USD', mapping: JSON.stringify({ isrc: 'ISRC', amount: 'Amount' }) } });
  expect(post.status()).toBe(403);
  // PostgREST on the same person's JWT: their artist's allocations, no earnings lines.
  const allocs = await readAs(request, financeScoped, 'earnings_allocations?select=party_id');
  expect(allocs.body.map((a) => a.party_id)).toEqual([P_NOVA, P_NOVA]);
  expect((await readAs(request, financeScoped, 'earnings_lines?select=id')).body).toEqual([]);
  await ctx.close();
});

test('6 · circulating the missing sheet and pressing Re-run allocates that line', async ({ browser, baseURL, request }) => {
  const [sheet] = (await rest(request, 'POST', 'split_sheets', { org_id: ORG, track_id: SONG_NOSHEET, kind: 'master', version: 1 })) as Row[];
  await rest(request, 'POST', 'split_lines', { split_sheet_id: sheet.id, party_id: P_NOVA, role: 'master_owner', share: 100, position: 0 });
  await rest(request, 'PATCH', `split_sheets?id=eq.${sheet.id}`, { status: 'circulated', circulated_at: new Date().toISOString() });
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await expect(page.getByTestId('import-rerun')).toContainText('Re-run 3 waiting', { timeout: 25_000 });
  await page.getByTestId('import-rerun').click();
  await expect(page.getByTestId('earnings-queue')).toContainText('Needs review · 2', { timeout: 25_000 });
  await expect(page.getByTestId('import-row')).toContainText('1 line allocated, 2 still waiting');
  await ctx.close();
  const lines = (await rest(request, 'GET', `earnings_lines?select=line_no,review_reason&import_id=eq.${importId}&order=line_no`)) as Row[];
  expect(lines.map((l) => l.review_reason)).toEqual([null, null, 'no_sheet', 'no_match', null]);
  const allocs = (await rest(request, 'GET', `earnings_allocations?select=payable_minor,line_id&import_id=eq.${importId}`)) as Row[];
  expect(allocs.reduce((s, a) => s + Number(a.payable_minor), 0)).toBe(10001 + 100 + 400);
  // Nova's advance is spent: the re-run recoups nothing more, and nothing negative exists.
  expect(((await rest(request, 'GET', `earnings_recoupments?select=id&import_id=eq.${importId}`)) as Row[]).length).toBe(1);
  expect(((await rest(request, 'GET', `activity_events?select=payload&org_id=eq.${ORG}&verb=eq.earnings.recalculated`)) as Row[])[0]).toMatchObject({ payload: { tried: 3, resolved: 1, waiting: 2 } });
});

test('7 · 390 px, and the producer dashboard and /store still load', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE);
  await expect(page.getByTestId('earnings-form')).toBeVisible({ timeout: 25_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${D}/04-390.png`, fullPage: true });
  await ctx.close();

  const prod = await as(browser, baseURL!, owner);
  const store = await prod.newPage();
  expect((await store.goto('/store'))?.status()).toBe(200);
  const lib = await prod.newPage();
  const res = await lib.goto('/library');
  expect(res?.status()).toBeLessThan(400);
  await lib.screenshot({ path: `${D}/05-library.png` });
  await prod.close();
});

test('8 · marketing, a roster artist and an outsider are refused; the module off is a 404', async ({ browser, baseURL, request }) => {
  const asRoster = await as(browser, baseURL!, rosterArtist);
  const rosterPage = await asRoster.newPage();
  expect((await rosterPage.goto(PAGE))?.status()).toBe(404);
  expect((await asRoster.request.get(`/api/org/${ORG}/finance/earnings/unmatched`)).status()).toBe(403);
  await asRoster.close();
  const asOutsider = await as(browser, baseURL!, outsider);
  expect((await asOutsider.request.get(`/api/org/${ORG}/finance/earnings/unmatched`)).status()).toBeGreaterThanOrEqual(403);
  const outsiderPage = await asOutsider.newPage();
  await outsiderPage.goto(PAGE);
  // A buyer is sent to the buyer account, never to this page.
  expect(outsiderPage.url()).not.toContain('/finance/earnings');
  await expect(outsiderPage.getByTestId('earnings')).toHaveCount(0);
  await asOutsider.close();
  expect((await readAs(request, rosterArtist, 'earnings_allocations?select=id')).body).toEqual([]);

  await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${ARTIST_A_ID}`, { functions: ['marketing'] });
  const mkt = await as(browser, baseURL!, financeScoped);
  expect((await mkt.request.get(`/api/org/${ORG}/finance/earnings/unmatched`)).status()).toBe(403);
  expect((await (await mkt.newPage()).goto(PAGE))?.status()).toBe(404);
  await mkt.close();

  // The seed makes the producer a platform operator; the licence is set through the console's own function.
  await rest(request, 'POST', 'rpc/labelos_platform_set_entitlements', {
    p_actor: PRODUCER_ID, p_org: ORG, p_modules: ['contracts'], p_max_seats: null, p_max_artists: null, p_payload: { modules: ['contracts'] },
  });
  const off = await as(browser, baseURL!, owner);
  expect((await off.request.get(`/api/org/${ORG}/finance/earnings/unmatched`)).status()).toBe(404);
  expect((await off.request.get(`/api/org/${ORG}/finance/earnings/imports`)).status()).toBe(404);
  expect((await (await off.newPage()).goto(PAGE))?.status()).toBe(404);
  await off.close();
  // (the licence row goes with the organization when it is deleted)
});
