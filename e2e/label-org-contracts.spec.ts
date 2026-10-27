/**
 * Contract model and templates (LABEL-57) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true,
 * migration 176 included).
 *
 * Driven through the real pages and routes. The only things seeded with the
 * service key are the cast (org, members, an artist, two parties — LABEL-54's
 * data) and, in step 5, the move of a draft to `sent`, which is LABEL-58's
 * route and does not exist yet. Templates, contracts, parties on a contract,
 * fields, edits and voiding are all done in the UI:
 *   1 · the owner opens the template editor: 14 types, a sample preview, edits
 *       the recording wording twice and gets versions 1 and 2;
 *   2 · the owner starts a contract from the recording template in the page:
 *       a draft snapshotting version 2, with the label's and the artist's legal
 *       names merged into the document;
 *   3 · a later template edit (version 3) does not change that contract's text;
 *   4 · the owner edits the draft's details in the page;
 *   5 · the artist (role artist, Nova) sees no draft; once it is sent she reads
 *       her own contract and not the internal note, not Kilo's contract, and
 *       straight from PostgREST on her own JWT the same (and no template);
 *   6 · the owner voids it in the page; it can no longer be edited;
 *   7 · a marketing member has no Contracts page and cannot write.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `contracts-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const LABEL_PARTY = randomUUID();
const NOVA_PARTY = randomUUID();
const D = 'e2e-artifacts/LABEL-57';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

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
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>[];
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const marketing = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const rosterArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

type Row = Record<string, unknown>;
const contracts = (request: APIRequestContext) => rest(request, 'GET', `contracts?select=*&org_id=eq.${ORG}&order=created_at`) as Promise<Row[]>;
const events = (request: APIRequestContext, verb: string) =>
  rest(request, 'GET', `activity_events?select=verb,visibility,payload&org_id=eq.${ORG}&verb=eq.${verb}&order=created_at`) as Promise<Row[]>;

async function pick(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}


/** 390 px: nothing scrolls sideways, and the page is captured. */
async function phone(page: Page, name: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${D}/${name}-390.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });
}

const NOVA_NAME = `Nova ${run}`;
const LABEL_LEGAL = `Contracts Records ${run} Ltd`;
const NOVA_LEGAL = `Nova Okafor ${run}`;

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  const users = [ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Contracts Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'user_profiles', [{ user_id: ARTIST_A_ID, display_name: 'Mia Marketing' }, { user_id: ARTIST_B_ID, display_name: 'Nova Artist' }]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: NOVA_NAME, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_B_ID, contact_id: NOVA });
  await rest(request, 'POST', 'parties', [
    { id: LABEL_PARTY, org_id: ORG, kind: 'company', display_name: `Contracts Records ${run}`, legal_name: LABEL_LEGAL, address: '1 Label Way, London', user_id: null, created_by: PRODUCER_ID },
    { id: NOVA_PARTY, org_id: ORG, kind: 'person', display_name: `Nova ${run}`, legal_name: NOVA_LEGAL, address: '2 Artist Road, Lagos', user_id: ARTIST_B_ID, created_by: PRODUCER_ID },
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  const users = [ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${users})`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
});

test('1 · the template editor: 14 types, a sample preview, two saved versions', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/templates`);
  await expect(page.getByRole('heading', { name: 'Contract templates' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid^="template-type-"]')).toHaveCount(14);
  await expect(page.getByText(/not legal advice/i).first()).toBeVisible();

  await page.getByTestId('template-preview-toggle').click();
  await expect(page.getByTestId('template-sample')).toContainText('Sample Label');
  await expect(page.getByTestId('template-sample')).not.toContainText('{{');
  await page.screenshot({ path: `${D}/templates-preview-1440.png`, fullPage: true });
  await page.getByTestId('template-preview-toggle').click();

  // No change yet: nothing to save.
  await expect(page.getByTestId('template-save')).toBeDisabled();
  await page.getByTestId('template-body-4').fill('The Label pays the Artist an advance of {{currency}} {{advance}} (first draft by our counsel).');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-versions')).toContainText('Version 1', { timeout: 20_000 });
  await page.getByTestId('template-body-4').fill('The Label pays the Artist an advance of {{currency}} {{advance}}, recoupable from royalties (second draft).');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-versions')).toContainText('Version 2', { timeout: 20_000 });

  // An unknown merge field is refused in plain words and nothing is stored.
  await page.getByTestId('template-body-4').fill('Pay {{party.label.tax_id}}');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-error')).toContainText(/merge fields that do not exist/i);

  await phone(page, 'templates');
  const rows = (await rest(ctx.request, 'GET', `contract_templates?select=version,based_on,type&org_id=eq.${ORG}&order=version`)) as Row[];
  expect(rows.map((r) => r.version)).toEqual([1, 2]);
  expect(rows[0].based_on).toBe('platform:recording@1');
  expect(rows[1].based_on).toBe('org:1');
  const evs = await events(ctx.request, 'contract_template.saved');
  expect(evs).toHaveLength(2);
  expect(JSON.stringify(evs)).not.toMatch(/counsel|draft\)/);
  await ctx.close();
});

test('2 · the owner starts a contract in the page; the document carries the legal names', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts`);
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('contracts-empty')).toBeVisible();
  await page.getByTestId('contract-new').click();
  await page.getByTestId('contract-title').fill(`Nova recording deal ${run}`);
  await pick(page, 'Artist', NOVA_NAME);
  await pick(page, 'Party: Label', `Contracts Records ${run}`);
  await pick(page, 'Party: Artist', `Nova ${run}`);
  await page.getByTestId('contract-term').fill('24');
  await page.getByTestId('contract-territory').fill('ww');
  await page.getByTestId('contract-start').fill('2027-03-01');
  await page.getByTestId('contract-field-currency').fill('USD');
  await page.getByTestId('contract-field-advance').fill('12000');
  await page.getByTestId('contract-note').fill('Chase counsel on the option clause');

  // A bad amount is caught before anything is sent.
  await page.getByTestId('contract-field-royalty_rate').fill('abc');
  await page.getByTestId('contract-create').click();
  await expect(page.getByTestId('contract-error')).toContainText(/royalty/i);
  await page.getByTestId('contract-field-royalty_rate').fill('18.5');
  await page.screenshot({ path: `${D}/contract-form-1440.png`, fullPage: true });
  await phone(page, 'contract-form');
  await page.getByTestId('contract-create').click();

  await expect(page.getByTestId('contract-detail-title')).toHaveText(`Nova recording deal ${run}`, { timeout: 20_000 });
  const doc = page.getByTestId('contract-document');
  await expect(doc).toContainText(LABEL_LEGAL);
  await expect(doc).toContainText('USD 12000');
  await expect(doc).toContainText('18.5%');
  await expect(doc).toContainText('Worldwide');
  await expect(page.getByTestId('contract-internal-note')).toContainText('Chase counsel');
  await page.screenshot({ path: `${D}/contract-detail-1440.png`, fullPage: true });
  await phone(page, 'contract-detail');

  const [row] = await contracts(ctx.request);
  expect(row).toMatchObject({ status: 'draft', type: 'recording', template_source: 'org:2', template_version: 2, artist_contact_id: NOVA, term_months: 24 });
  const parties = (await rest(ctx.request, 'GET', `contract_parties?select=party_id,role&contract_id=eq.${row.id}`)) as Row[];
  expect(parties.map((p) => p.role).sort()).toEqual(['artist', 'label']);
  const ev = (await events(ctx.request, 'contract.created'))[0];
  expect(ev.visibility).toBe('internal');
  expect(JSON.stringify(ev.payload)).not.toMatch(/12000|Chase counsel/);
  await ctx.close();
});

test('3 · editing the template later does not rewrite that contract', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const [before] = await contracts(ctx.request);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/templates`);
  await expect(page.getByTestId('template-body-4')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('template-body-4').fill('A completely different advance clause {{advance}} (third draft).');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-versions')).toContainText('Version 3', { timeout: 20_000 });
  const [after] = await contracts(ctx.request);
  expect(after.clauses).toEqual(before.clauses);
  expect(JSON.stringify(after.clauses)).toContain('second draft');
  expect(JSON.stringify(after.clauses)).not.toContain('third draft');
  await ctx.close();
});

test('4 · the owner edits the draft in the page', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts`);
  await page.locator('[data-testid^="contract-row-"]').first().click();
  await page.getByTestId('contract-edit').click();
  await page.getByTestId('contract-term').fill('36');
  await page.getByTestId('contract-field-advance').fill('15000');
  await page.getByTestId('contract-save').click();
  await expect(page.getByTestId('contract-document')).toContainText('USD 15000', { timeout: 20_000 });
  const [row] = await contracts(ctx.request);
  expect(row.term_months).toBe(36);
  expect((await events(ctx.request, 'contract.updated'))[0].payload).toEqual({ changed: expect.arrayContaining(['fields', 'term_months']), version: 2 });

  // A second contract for Kilo, to prove the artist cannot read it.
  await page.getByTestId('contract-new').click();
  await page.getByTestId('contract-title').fill(`Kilo deal ${run}`);
  await pick(page, 'Artist', `Kilo ${run}`);
  await page.getByTestId('contract-create').click();
  await expect(page.getByTestId('contract-detail-title')).toHaveText(`Kilo deal ${run}`, { timeout: 20_000 });
  await ctx.close();
});

test('5 · the artist reads her own sent contract only, in the page and on her own JWT', async ({ browser, baseURL }) => {
  const rows = await (async () => {
    const ctx = await browser.newContext();
    const r = (await rest(ctx.request, 'GET', `contracts?select=id,title&org_id=eq.${ORG}&order=created_at`)) as Row[];
    await ctx.close();
    return r;
  })();
  const nova = rows.find((r) => String(r.title).startsWith('Nova'))!;
  const kilo = rows.find((r) => String(r.title).startsWith('Kilo'))!;

  const ctx = await as(browser, baseURL!, rosterArtist.id, rosterArtist.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts`);
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('contracts-empty')).toBeVisible(); // a draft is not hers to read yet
  await expect(page.getByTestId('contract-new')).toHaveCount(0);

  // Sending for signature is LABEL-58; here the service key moves the draft to `sent`.
  await rest(ctx.request, 'PATCH', `contracts?id=in.(${nova.id},${kilo.id})`, { status: 'sent' });
  await page.reload();
  await expect(page.locator('[data-testid^="contract-row-"]')).toHaveCount(1);
  await page.locator('[data-testid^="contract-row-"]').first().click();
  await expect(page.getByTestId('contract-document')).toContainText(NOVA_LEGAL);
  await expect(page.getByTestId('contract-internal-note')).toHaveCount(0);
  await expect(page.getByTestId('contract-edit')).toHaveCount(0);
  await expect(page.getByTestId('contract-void')).toHaveCount(0);
  await page.screenshot({ path: `${D}/artist-contract-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${D}/artist-contract-390.png`, fullPage: true });

  // The same on her own JWT, straight from PostgREST.
  const own = await readAs(ctx.request, rosterArtist, 'contracts?select=id,title,status');
  expect(own.map((r) => r.id)).toEqual([nova.id]);
  // The business columns are not readable on her JWT at all (column grants), not merely empty.
  for (const col of ['internal_note', 'void_reason', 'created_by', 'voided_by']) {
    const res = await ctx.request.fetch(`${REST}/contracts?select=${col}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(rosterArtist.id, rosterArtist.email)}` } });
    expect(res.status(), col).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain('Chase counsel');
  }
  expect(await readAs(ctx.request, rosterArtist, `contracts?select=id&id=eq.${kilo.id}`)).toEqual([]);
  expect(await readAs(ctx.request, rosterArtist, 'contract_templates?select=id')).toEqual([]);
  // The API says the same: Kilo's contract does not exist for her.
  const apiKilo = await ctx.request.get(`/api/org/${ORG}/contracts/${kilo.id}`);
  expect(apiKilo.status()).toBe(404);
  const apiList = await (await ctx.request.get(`/api/org/${ORG}/contracts`)).text();
  expect(apiList).not.toContain('Chase counsel');
  expect((await ctx.request.post(`/api/org/${ORG}/contracts`, { data: { type: 'nda', title: 'x' } })).status()).toBe(403);
  await ctx.close();
});

test('6 · the owner voids the contract in the page; it is final', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts`);
  await page.getByText(`Nova recording deal ${run}`).first().click();
  await page.getByTestId('contract-void').click();
  await page.getByRole('button', { name: 'Void', exact: true }).last().click();
  await expect(page.getByTestId('contract-detail')).toContainText('Void', { timeout: 20_000 });
  await expect(page.getByTestId('contract-void')).toHaveCount(0);
  await expect(page.getByTestId('contract-edit')).toHaveCount(0);
  const novaRow = (await contracts(ctx.request)).find((r) => String(r.title).startsWith('Nova'))!;
  expect(novaRow.status).toBe('void');
  // The database refuses to bring it back, whoever asks.
  const back = await ctx.request.fetch(`${REST}/contracts?id=eq.${novaRow.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ status: 'sent' }),
  });
  expect(back.ok()).toBeFalsy();
  expect((await events(ctx.request, 'contract.voided'))).toHaveLength(1);
  await ctx.close();
});

test('7 · a marketing member has no Contracts page and cannot write', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, marketing.id, marketing.email);
  const page = await ctx.newPage();
  const res = await page.goto(`/o/${SLUG}/rights/contracts`);
  expect(res?.status()).toBe(404);
  expect((await ctx.request.post(`/api/org/${ORG}/contracts`, { data: { type: 'nda', title: 'x' } })).status()).toBe(403);
  expect((await ctx.request.get(`/api/org/${ORG}/contract-templates`)).status()).toBe(403);
  await ctx.close();
});
