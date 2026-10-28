/**
 * Contract ↔ split sheets (LABEL-59) end to end against a REAL database
 * (scripts/local-db, LABEL_OS_ENABLED=true, migrations through 176; no new
 * migration). Seeded with the service key: the cast only (org, members, an
 * artist, parties, a song in a project). The contract, its fields, the pre-fill,
 * the circulation, the revision and the drift all go through the real pages and
 * routes:
 *   1 · a draft feature agreement is filled in on the editor (33.3333% master —
 *       an odd share on purpose) and its panel shows the sheet it implies;
 *   2 · "Create draft split sheet" makes a master and a composition DRAFT with
 *       the exact shares (33.3333 / 66.6667 sum to 100); pressing it again
 *       never overwrites the draft (the page asks first, "Keep my draft"
 *       changes nothing); the draft appears on the song's Splits tab;
 *   3 · the sheets are circulated from the song page; the contract is sent; no
 *       drift while they agree;
 *   4 · a revised sheet (25 / 75) circulated: BOTH the contract page and the
 *       song's splits view warn, the owner sees who and how much; the artist
 *       (a party, roster role) is told only that it differs — no share on the
 *       wire (D2); the internal note never leaves the route;
 *   5 · the superseded v1 stays as a record; the new draft pre-fill never
 *       touched the circulated sheet;
 *   6 · 390 px: no sideways scroll; the producer dashboard and /store load.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ARTIST_A_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `csplits-${run}`;
const NOVA = randomUUID();
const EP = randomUUID();
const SONG = randomUUID();
const P_NOVA = randomUUID();
const P_KILO = randomUUID();
const D = 'e2e-artifacts/LABEL-59';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const artist = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
type Row = Record<string, unknown>;
let contractId = '';

async function noSideways(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
}

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `CSplits Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', { id: EP, org_id: ORG, user_id: null, name: `Nova EP ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', { id: SONG, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${SONG}.mp3` });
  await rest(request, 'POST', 'project_tracks', { project_id: EP, track_id: SONG, position: 0 });
  const party = (id: string, name: string, extra: Record<string, unknown>) => ({ id, org_id: ORG, kind: 'person', display_name: name, legal_name: null, ipi: null, contact_id: null, user_id: null, ...extra });
  await rest(request, 'POST', 'parties', [
    party(P_NOVA, `Nova ${run}`, { legal_name: `Nova Okafor ${run}`, address: '2 Artist Road, Lagos', contact_id: NOVA, user_id: ARTIST_A_ID }),
    party(P_KILO, `Kilo ${run}`, { legal_name: `Kilo Mensah ${run}`, address: '9 Feature Street, Accra' }),
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
});

test('1 · a draft feature agreement is filled in on the editor; its panel shows the sheet it implies', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const res = await ctx.request.post(`/api/org/${ORG}/contracts`, {
    data: { type: 'feature', title: `Feature deal ${run}`, artist_contact_id: NOVA, track_id: SONG, parties: [{ party_id: P_NOVA, role: 'artist' }, { party_id: P_KILO, role: 'featured' }] },
  });
  expect(res.status(), await res.text()).toBe(201);
  contractId = ((await res.json()) as { id: string }).id;
  await rest(ctx.request, 'PATCH', `contracts?id=eq.${contractId}`, { internal_note: 'INTERNAL-NOTE-chase-kilo' });

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('contract-editor-title')).toHaveText(`Feature deal ${run}`, { timeout: 60_000 });
  // Nothing is stated yet: the panel says so instead of inventing a split.
  await expect(page.getByTestId('contract-split-skip-master')).toContainText('does not state the share', { timeout: 30_000 });

  await page.getByTestId('contract-field-currency').fill('USD');
  await page.getByTestId('contract-field-fee').fill('1500');
  await page.getByTestId('contract-start').fill('2027-03-01');
  await page.getByTestId('contract-term').fill('24');
  await page.getByTestId('contract-territory').fill('WW');
  await page.getByTestId('contract-field-royalty_rate').fill('12.5');
  await page.getByTestId('contract-field-master_share').fill('33.3333');
  await page.getByTestId('contract-field-publishing_share').fill('10');
  await page.getByTestId('contract-field-credit_line').fill('feat. Kilo');
  await page.getByTestId('contract-field-governing_law').fill('the laws of England and Wales');
  // The stock wording asks for a release title this contract has none of: edit that clause, as a lawyer would.
  await page.getByTestId('clause-body-performance').fill('The Featured Artist performs on {{song.title}} only.');
  await page.getByTestId('contract-editor-save').click();
  await expect(page.getByTestId('contract-editor-meta')).toContainText('version', { timeout: 20_000 });

  const plan = page.getByTestId('contract-split-plan-master');
  await expect(plan).toContainText(`Kilo Mensah ${run}`, { timeout: 30_000 });
  await expect(plan).toContainText('33.3333%');
  await expect(plan).toContainText('66.6667%');
  await expect(page.getByTestId('contract-split-plan-composition')).toContainText('90%');
  await expect(page.getByTestId('contract-splits-prefill')).toBeVisible();
  await page.screenshot({ path: `${D}/contract-panel-1440.png`, fullPage: true });
  await ctx.close();
});

test('2 · the pre-fill makes exact DRAFTS, never overwrites one, and shows on the song', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('contract-splits-prefill')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('contract-splits-prefill').click();
  await expect.poll(async () => ((await rest(ctx.request, 'GET', `split_sheets?select=kind,status,version&org_id=eq.${ORG}&order=kind`)) as Row[]).length, { timeout: 20_000 }).toBe(2);
  const sheets = (await rest(ctx.request, 'GET', `split_sheets?select=id,kind,status,version&org_id=eq.${ORG}&order=kind`)) as { id: string; kind: string; status: string; version: number }[];
  expect(sheets.map((s) => [s.kind, s.status, s.version])).toEqual([['composition', 'draft', 1], ['master', 'draft', 1]]);
  const master = sheets.find((s) => s.kind === 'master')!;
  const lines = (await rest(ctx.request, 'GET', `split_lines?select=party_id,role,share::text&split_sheet_id=eq.${master.id}&order=position`)) as { party_id: string; role: string; share: string }[];
  expect(lines.map((l) => [l.party_id, l.role, l.share])).toEqual([[P_KILO, 'master_owner', '33.3333'], [P_NOVA, 'master_owner', '66.6667']]);
  // The event is written right after the sheet (best effort), so wait for it rather than race it.
  await expect.poll(async () => ((await rest(ctx.request, 'GET', `activity_events?select=payload&org_id=eq.${ORG}&verb=eq.split_sheet.created`)) as Row[]).length, { timeout: 20_000 }).toBe(2);
  const ev = (await rest(ctx.request, 'GET', `activity_events?select=payload&org_id=eq.${ORG}&verb=eq.split_sheet.created`)) as Row[];
  expect(JSON.stringify(ev)).not.toMatch(/33\.3333|Kilo|Nova/);
  expect(ev.every((e) => (e.payload as { source: string }).source === 'contract')).toBe(true);

  // A hand edit, then the button again: the page asks, "keep" changes nothing.
  const edit = await ctx.request.patch(`/api/org/${ORG}/tracks/${SONG}/splits/${master.id}`, {
    data: { lines: [{ party_id: P_KILO, role: 'master_owner', share: '40' }, { party_id: P_NOVA, role: 'master_owner', share: '60' }] },
  });
  expect(edit.ok(), await edit.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('contract-splits-prefill')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('contract-splits-prefill').click();
  await expect(page.getByTestId('contract-splits-confirm')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${D}/contract-confirm-replace-1440.png`, fullPage: true });
  await page.getByRole('button', { name: 'Keep my draft' }).click();
  const kept = (await rest(ctx.request, 'GET', `split_lines?select=share::text&split_sheet_id=eq.${master.id}&order=position`)) as { share: string }[];
  expect(kept.map((l) => l.share)).toEqual(['40.0000', '60.0000']);

  // Replacing is the explicit second step.
  await page.getByTestId('contract-splits-prefill').click();
  await page.getByTestId('contract-splits-replace').click();
  await expect.poll(async () => ((await rest(ctx.request, 'GET', `split_lines?select=share::text&split_sheet_id=eq.${master.id}&order=position`)) as { share: string }[]).map((l) => l.share), { timeout: 20_000 }).toEqual(['33.3333', '66.6667']);

  // The draft is on the song's Splits tab.
  const song = await ctx.newPage();
  await song.goto(`/o/${SLUG}/songs/${SONG}`);
  await song.getByTestId('splits-tab-master').click();
  await expect(song.getByTestId('splits-draft')).toBeVisible({ timeout: 60_000 });
  await expect(song.getByTestId('splits-total')).toContainText('100%');
  await song.screenshot({ path: `${D}/song-draft-1440.png`, fullPage: true });
  await ctx.close();
});

test('3 · circulate from the song, send the contract: no drift while they agree', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const song = await ctx.newPage();
  await song.goto(`/o/${SLUG}/songs/${SONG}`);
  for (const kind of ['master', 'composition'] as const) {
    await song.getByTestId(`splits-tab-${kind}`).click();
    const circulate = song.getByTestId('splits-circulate');
    await expect(circulate).toBeEnabled({ timeout: 60_000 });
    await circulate.click();
    await expect(song.getByTestId('splits-status').first()).toContainText(/circulated/i, { timeout: 20_000 });
  }

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('contract-send')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('contract-send').click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('contract-editor-meta')).toContainText('Sent for signature', { timeout: 30_000 });
  await expect(page.getByTestId('contract-split-plan-master')).toBeVisible();
  await expect(page.getByTestId('drift-master')).toHaveCount(0);
  await expect(page.getByTestId('drift-composition')).toHaveCount(0);
  await song.reload();
  await expect(song.getByTestId('org-splits')).toBeVisible({ timeout: 60_000 });
  await expect(song.getByTestId('drift-master')).toHaveCount(0);
  await ctx.close();
});

test('4 · a revised sheet that disagrees: both pages warn; the artist learns only that it differs', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const sheets = (await rest(ctx.request, 'GET', `split_sheets?select=id,kind,status&org_id=eq.${ORG}&kind=eq.master&status=eq.circulated`)) as { id: string }[];
  const v1 = sheets[0].id;
  const sup = await ctx.request.post(`/api/org/${ORG}/tracks/${SONG}/splits/${v1}/supersede`, { data: {} });
  expect(sup.ok(), await sup.text()).toBeTruthy();
  const v2 = ((await sup.json()) as { sheet: { id: string } }).sheet.id;
  const patched = await ctx.request.patch(`/api/org/${ORG}/tracks/${SONG}/splits/${v2}`, {
    data: { lines: [{ party_id: P_KILO, role: 'master_owner', share: '25' }, { party_id: P_NOVA, role: 'master_owner', share: '75' }] },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();
  // While the revision is a draft, the sheet IN FORCE is still v1 and still agrees.
  const before = await (await ctx.request.get(`/api/org/${ORG}/contracts/${contractId}/splits`)).json();
  expect(before.drift.filter((d: { drifted: boolean }) => d.drifted)).toHaveLength(0);
  const circ = await ctx.request.post(`/api/org/${ORG}/tracks/${SONG}/splits/${v2}/circulate`, { data: {} });
  expect(circ.ok(), await circ.text()).toBeTruthy();

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  const warn = page.getByTestId('drift-master');
  await expect(warn).toContainText('differs from this contract', { timeout: 60_000 });
  await expect(page.getByTestId('drift-master-items')).toContainText(`Kilo ${run}: contract 33.3333%, sheet 25%`);
  await expect(page.getByTestId('drift-composition')).toHaveCount(0);
  await page.screenshot({ path: `${D}/contract-drift-1440.png`, fullPage: true });

  const song = await ctx.newPage();
  await song.goto(`/o/${SLUG}/songs/${SONG}`);
  await song.getByTestId('splits-tab-master').click();
  await expect(song.getByTestId('drift-master')).toContainText(`differs from its contract “Feature deal ${run}”`, { timeout: 60_000 });
  await expect(song.getByTestId('drift-master-items')).toContainText('sheet 25%');
  await song.screenshot({ path: `${D}/song-drift-1440.png`, fullPage: true });
  await expect(song.getByTestId('drift-master').getByRole('link', { name: 'Open it' })).toHaveAttribute('href', `/o/${SLUG}/rights/contracts/${contractId}`);

  // The superseded v1 is still on record, and the pre-fill never touched what was circulated.
  const all = (await rest(ctx.request, 'GET', `split_sheets?select=version,status&org_id=eq.${ORG}&kind=eq.master&order=version`)) as Row[];
  expect(all).toMatchObject([{ version: 1, status: 'superseded' }, { version: 2, status: 'circulated' }]);
  await ctx.close();

  // D2: the artist (a party, roster role) is told THAT it differs, with no number and no name from the sheet.
  const actx = await as(browser, baseURL!, artist.id, artist.email);
  const raw = await actx.request.get(`/api/org/${ORG}/contracts/${contractId}/splits`);
  expect(raw.status()).toBe(200);
  const text = await raw.text();
  const body = JSON.parse(text);
  expect(body.drift.filter((d: { drifted: boolean }) => d.drifted)).toEqual([expect.objectContaining({ kind: 'master', drifted: true })]);
  expect(body.drift.every((d: { items?: unknown }) => d.items === undefined)).toBe(true);
  expect(body.canPrefill).toBe(false);
  expect(text).not.toMatch(/"sheet"|INTERNAL-NOTE/);
  const songRaw = await (await actx.request.get(`/api/org/${ORG}/tracks/${SONG}/splits`)).text();
  expect(songRaw).not.toContain('INTERNAL-NOTE');
  expect(JSON.parse(songRaw).contracts[0].drift.every((d: { items?: unknown }) => d.items === undefined)).toBe(true);
  const apage = await actx.newPage();
  await apage.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(apage.getByTestId('drift-master')).toContainText('differs from this contract', { timeout: 60_000 });
  await expect(apage.getByTestId('drift-master-items')).toHaveCount(0);
  await expect(apage.getByTestId('contract-splits-prefill')).toHaveCount(0);
  await apage.screenshot({ path: `${D}/contract-drift-artist-1440.png`, fullPage: true });
  // An artist cannot pre-fill: 403, nothing written.
  const denied = await actx.request.post(`/api/org/${ORG}/contracts/${contractId}/splits`, { data: {} });
  expect(denied.status()).toBe(403);
  await actx.close();
});

test('5 · 390 px has no sideways scroll; the producer dashboard and /store still load', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('drift-master')).toBeVisible({ timeout: 60_000 });
  await noSideways(page, 'contract page');
  await page.screenshot({ path: `${D}/contract-390.png`, fullPage: true });
  await page.goto(`/o/${SLUG}/songs/${SONG}`);
  await page.getByTestId('splits-tab-master').click();
  await expect(page.getByTestId('drift-master')).toBeVisible({ timeout: 60_000 });
  await noSideways(page, 'song splits');
  await page.screenshot({ path: `${D}/song-390.png`, fullPage: true });

  const store = await ctx.request.get('/store');
  expect(store.status()).toBe(200);
  const dash = await page.goto('/library');
  expect(dash?.status()).toBeLessThan(500);
  await ctx.close();
});
