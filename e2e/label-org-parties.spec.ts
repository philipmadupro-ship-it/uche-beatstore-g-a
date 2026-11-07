/**
 * Parties and payee data (LABEL-54) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true,
 * migrations 153, 155 and 174 included).
 *
 * The journey is driven through the real page and routes — nothing the
 * acceptance criteria are about is seeded with the service key:
 *   1 · the owner adds a party on /o/<slug>/rights/parties with address,
 *       country, tax id and payment instructions; an IBAN is refused in plain
 *       words and nothing is stored;
 *   2 · no member's OWN JWT reads tax_id / payment_instructions (permission
 *       denied), the owner included — only the routes serve them;
 *   3 · finance (finance.read) reads the payee fields, read-only, and no
 *       legal block;
 *   4 · a roster artist (role artist, scoped to Nova) sees the names of
 *       Nova's song's co-writers and no contact data, in the page, the API
 *       and straight from PostgREST;
 *   5 · invite-to-confirm: the owner links a party to a member and asks; the
 *       member confirms (and corrects an IPI) on their own page;
 *   6 · the lock: once a circulated split sheet names a party, renaming it is
 *       refused in the page, the route AND the database;
 *   7 · a credited person withdraws their own credit; the audit event stays.
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
const SLUG = `parties-${run}`;
const NOVA = randomUUID();
const NOVA_EP = randomUUID();
const MIDNIGHT = randomUUID();
const CO_WRITER = randomUUID();
const OUTSIDER = randomUUID();
const D = 'e2e-artifacts/LABEL-54';

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

/** A PostgREST read with the member's OWN token; returns the status too, so a permission error can be asserted. */
async function readAsRaw(request: APIRequestContext, who: { id: string; email: string }, p: string) {
  const res = await request.fetch(`${REST}/${p}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}` } });
  return { status: res.status(), text: await res.text() };
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const finance = { id: BUYER_ID, email: 'buyer@local.test' };
const ownLine = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const rosterArtist = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

type Event = { verb: string; audit: boolean; actor_id: string | null; visibility: string; payload: Record<string, unknown> };
const events = async (request: APIRequestContext, verb: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,actor_id,visibility,payload&org_id=eq.${ORG}&verb=eq.${verb}&order=created_at`)) as Event[];
const partyRow = async (request: APIRequestContext, name: string) =>
  ((await rest(request, 'GET', `parties?select=*&org_id=eq.${ORG}&display_name=eq.${encodeURIComponent(name)}`)) as Record<string, unknown>[])[0];

const credits = `/api/org/${ORG}/tracks/${MIDNIGHT}/credits`;
const splits = `/api/org/${ORG}/tracks/${MIDNIGHT}/splits`;
const writerName = `Writer ${run}`;
const adaName = `Ada ${run}`;

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Party Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['finance'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['producer'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'user_profiles', [
    { user_id: BUYER_ID, display_name: 'Fiona Finance' },
    { user_id: ARTIST_A_ID, display_name: 'Ada Producer' },
    { user_id: ARTIST_B_ID, display_name: 'Nova Artist' },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_B_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', { id: NOVA_EP, org_id: ORG, user_id: null, name: `Nova EP ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'project_contacts', { user_id: null, project_id: NOVA_EP, contact_id: NOVA, role: 'artist' });
  await rest(request, 'POST', 'tracks', [
    { id: MIDNIGHT, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${MIDNIGHT}.mp3` },
    { id: OUTSIDER, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Outside ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${OUTSIDER}.mp3` },
  ]);
  await rest(request, 'POST', 'project_tracks', { project_id: NOVA_EP, track_id: MIDNIGHT, position: 0 });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `user_profiles?user_id=in.(${users})`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
});

test('1 · the owner adds a party with payee data in the page; an IBAN is refused and nothing is stored', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/parties`);
  await expect(page.getByRole('heading', { name: 'Parties' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('party-new').click();
  await page.getByTestId('display-name').fill(writerName);
  await page.getByTestId('legal-name').fill(`Winnie Writer ${run}`);
  await page.getByTestId('address').fill('12 rue du Test, 75010 Paris');
  await page.getByTestId('country').fill('fr');
  await page.getByTestId('pro').fill('SACEM');
  await page.getByTestId('ipi').fill('00 111.222-333');
  await page.getByTestId('tax-id').fill('FR12345678901');

  // The refusal is in plain words, before anything is sent, and the database holds nothing.
  await page.getByTestId('payment-instructions').fill('Transfer to GB29 NWBK 6016 1331 9268 19');
  await page.getByTestId('party-save').click();
  await expect(page.getByTestId('party-error')).toContainText(/bank or card number/i);
  expect(await partyRow(ctx.request, writerName)).toBeUndefined();
  // The same refusal from the route (a client that skips the page) and from the column itself.
  const direct = await ctx.request.post(`/api/org/${ORG}/parties`, { data: { display_name: 'Direct', payment_instructions: '4111 1111 1111 1111' } });
  expect(direct.status()).toBe(400);
  const raw = await ctx.request.fetch(`${REST}/parties`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ org_id: ORG, display_name: 'Raw', payment_instructions: 'GB29 NWBK 6016 1331 9268 19' }),
  });
  expect(raw.status()).toBeGreaterThanOrEqual(400);
  expect(await raw.text()).toMatch(/parties_payment_instructions_check/);

  await page.getByTestId('payment-instructions').fill('Wise link in the contract');
  await page.getByTestId('party-save').click();
  await expect(page.getByTestId('party-row').filter({ hasText: writerName })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${D}/owner-1440.png`, fullPage: true });

  const row = await partyRow(ctx.request, writerName);
  expect(row).toMatchObject({ country: 'FR', ipi: '00111222333', tax_id: 'FR12345678901', payment_instructions: 'Wise link in the contract', address: '12 rue du Test, 75010 Paris', created_by: PRODUCER_ID });
  const made = await events(ctx.request, 'party.created');
  expect(made.map((e) => [e.actor_id, e.visibility])).toEqual([[PRODUCER_ID, 'internal']]);
  expect(JSON.stringify(made)).not.toMatch(/FR12345678901|Wise|rue du Test|00111222333/);

  // 390 px: the same page is usable, one column.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('party-row').filter({ hasText: writerName }).click();
  await expect(page.getByTestId('party-editor')).toBeVisible();
  await page.screenshot({ path: `${D}/owner-390.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('2 · no member’s own JWT reads tax_id or payment_instructions — not even the owner’s', async ({ request }) => {
  for (const who of [owner, finance, ownLine, rosterArtist]) {
    for (const column of ['tax_id', 'payment_instructions', '*']) {
      const res = await readAsRaw(request, who, `parties?select=${encodeURIComponent(column)}&display_name=eq.${encodeURIComponent(writerName)}`);
      expect(res.status, `${who.email} ${column}`).toBeGreaterThanOrEqual(400);
      expect(res.text).not.toContain('FR12345678901');
    }
  }
  // Filtering on it is refused too (no guessing it a character at a time).
  expect((await readAsRaw(request, owner, `parties?select=id&tax_id=like.FR*`)).status).toBeGreaterThanOrEqual(400);
  // The rest of the row is still the owner's to read.
  const ok = await readAsRaw(request, owner, `parties?select=display_name,country&display_name=eq.${encodeURIComponent(writerName)}`);
  expect(ok.status).toBe(200);
  expect(JSON.parse(ok.text)).toEqual([{ display_name: writerName, country: 'FR' }]);
});

test('3 · finance reads the payee fields (read-only) and no legal block', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, finance.id, finance.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/parties`);
  await page.getByTestId('party-row').filter({ hasText: writerName }).click({ timeout: 60_000 });
  const editor = page.getByTestId('party-editor');
  await expect(editor.getByTestId('tax-id')).toHaveValue('FR12345678901');
  await expect(editor.getByTestId('payment-instructions')).toHaveValue('Wise link in the contract');
  await expect(editor.getByTestId('tax-id')).toBeDisabled();
  await expect(page.getByTestId('legal-name')).toHaveCount(0);
  await expect(page.getByTestId('party-save')).toHaveCount(0);
  await page.screenshot({ path: `${D}/finance-1440.png`, fullPage: true });

  const api = ctx.request;
  const list = await (await api.get(`/api/org/${ORG}/parties`)).json();
  expect(list).toMatchObject({ canWrite: false, canSeePayee: true });
  expect(JSON.stringify(list)).not.toMatch(/rue du Test|00111222333|Winnie/);
  expect((await api.patch(`/api/org/${ORG}/parties/${(list.parties as { id: string }[])[0].id}`, { data: { tax_id: 'x' } })).status()).toBe(403);
  expect((await api.post(`/api/org/${ORG}/parties`, { data: { display_name: 'Forged' } })).status()).toBe(403);
});

test('4 · a roster artist sees names, roles and shares only — no co-writer contact data', async ({ browser, baseURL, request }) => {
  const api = (await as(browser, baseURL!, owner.id, owner.email)).request;
  const made = await api.post(`/api/org/${ORG}/parties`, { data: { display_name: `Casey ${run}`, legal_name: `Casey Cowriter ${run}`, email: `casey-${run}@example.com`, ipi: '00222333444', address: '5 elsewhere', country: 'us', tax_id: 'US-TAX-9' } });
  expect(made.status()).toBe(201);
  const cowriter = (await made.json()).party as { id: string; displayName: string };
  const prop = await api.post(credits, { data: { role: 'songwriter', party_id: cowriter.id } });
  expect(prop.status()).toBe(201);
  // A party credited only on a song OUTSIDE the artist's reach.
  const other = await api.post(`/api/org/${ORG}/parties`, { data: { display_name: `Outsider ${run}`, legal_name: 'Olive Outsider' } });
  expect(other.status()).toBe(201);
  expect((await api.post(`/api/org/${ORG}/tracks/${OUTSIDER}/credits`, { data: { role: 'mixer', party_id: (await other.json()).party.id } })).status()).toBe(201);

  const ctx = await as(browser, baseURL!, rosterArtist.id, rosterArtist.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/parties`);
  await expect(page.getByTestId('party-row').filter({ hasText: cowriter.displayName })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('party-row').filter({ hasText: `Outsider ${run}` })).toHaveCount(0);
  await page.getByTestId('party-row').filter({ hasText: cowriter.displayName }).click();
  await expect(page.getByTestId('party-names-only')).toBeVisible();
  await expect(page.getByTestId('legal-name')).toHaveCount(0);
  await expect(page.getByTestId('party-payee')).toHaveCount(0);
  await expect(page.getByTestId('party-new')).toHaveCount(0);
  const body = await page.locator('body').innerText();
  for (const leak of ['Casey Cowriter', 'casey-', '00222333444', '5 elsewhere', 'US-TAX-9']) expect(body).not.toContain(leak);
  await page.screenshot({ path: `${D}/roster-artist-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${D}/roster-artist-390.png`, fullPage: true });

  // The API, the song's credits and the splits carry names and roles only …
  const list = await (await ctx.request.get(`/api/org/${ORG}/parties`)).json();
  expect(list).toMatchObject({ canWrite: false, canSeePayee: false });
  expect(JSON.stringify(list)).not.toMatch(/Casey Cowriter|casey-|00222333444|5 elsewhere|US-TAX-9|Winnie|Olive/);
  const read = await (await ctx.request.get(credits)).json();
  expect(read.credits.map((c: { name: string }) => c.name)).toContain(cowriter.displayName);
  expect(JSON.stringify(read)).not.toMatch(/Casey Cowriter|00222333444/);

  // … and the database says the same on the artist's own JWT: a co-writer's row is not theirs to read.
  const raw = await readAsRaw(request, rosterArtist, `parties?select=display_name,legal_name,email,ipi,address`);
  expect(raw.status).toBe(200);
  expect(JSON.parse(raw.text)).toEqual([]);
});

test('5 · invite-to-confirm: the owner links and asks; the member confirms and corrects an IPI on their own page', async ({ browser, baseURL }) => {
  const ownerCtx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ownerCtx.newPage();
  await page.goto(`/o/${SLUG}/rights/parties`);
  await page.getByTestId('party-new').click({ timeout: 60_000 });
  await page.getByTestId('display-name').fill(adaName);
  await page.getByTestId('legal-name').fill('Ada Lovelace');
  await page.getByTestId('ipi').fill('00111111111');
  await page.getByRole('button', { name: 'Linked account' }).click();
  await page.getByRole('option', { name: 'Ada Producer' }).click();
  await page.getByTestId('party-save').click();
  await expect(page.getByTestId('party-row').filter({ hasText: adaName })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('party-row').filter({ hasText: adaName }).getByTestId('party-unconfirmed')).toBeVisible();
  await page.getByTestId('party-invite').click();
  await expect.poll(async () => (await rest(ownerCtx.request, 'GET', `notifications?select=kind,user_id,org_id&org_id=eq.${ORG}&kind=eq.party_confirmation`)) as unknown[], { timeout: 30_000 }).toEqual([
    { kind: 'party_confirmation', user_id: ARTIST_A_ID, org_id: ORG },
  ]);
  expect((await events(ownerCtx.request, 'party.confirmation_requested')).map((e) => [e.actor_id, e.visibility])).toEqual([[PRODUCER_ID, 'internal']]);

  // The member: sees only their own party, with their own legal data, and no payee block.
  const ctx = await as(browser, baseURL!, ownLine.id, ownLine.email);
  const mine = await ctx.newPage();
  await mine.goto(`/o/${SLUG}/rights/parties`);
  await expect(mine.getByTestId('party-row')).toHaveCount(1, { timeout: 60_000 });
  await mine.getByTestId('party-row').click();
  await expect(mine.getByTestId('legal-name')).toHaveValue('Ada Lovelace');
  await expect(mine.getByTestId('party-payee')).toHaveCount(0);
  await expect(mine.getByTestId('display-name')).toBeDisabled();
  await mine.getByTestId('ipi').fill('00111111122');
  await mine.getByTestId('party-confirm').click();
  await expect(mine.getByTestId('party-row').getByTestId('party-confirmed')).toBeVisible({ timeout: 30_000 });
  await mine.screenshot({ path: `${D}/own-line-1440.png`, fullPage: true });

  const row = await partyRow(ownerCtx.request, adaName);
  expect(row).toMatchObject({ ipi: '00111111122', details_confirmed_by: ARTIST_A_ID });
  expect(row.details_confirmed_at).toBeTruthy();
  const confirmed = await events(ownerCtx.request, 'party.confirmed');
  expect(confirmed.map((e) => [e.actor_id, e.visibility, e.payload])).toEqual([[ARTIST_A_ID, 'internal', { corrected: ['ipi'] }]]);
  expect(JSON.stringify(confirmed)).not.toContain('00111111122');
  // Nobody confirms for another person: the owner cannot, and the member cannot confirm someone else's party.
  expect((await ownerCtx.request.post(`/api/org/${ORG}/parties/${row.id}/confirm`, { data: {} })).status()).toBe(404);
  const writer = await partyRow(ownerCtx.request, writerName);
  expect((await ctx.request.post(`/api/org/${ORG}/parties/${writer.id}/confirm`, { data: {} })).status()).toBe(404);
  // The identity cannot be sent through confirm.
  expect((await ctx.request.post(`/api/org/${ORG}/parties/${row.id}/confirm`, { data: { display_name: 'Hijack' } })).status()).toBe(400);
});

test('6 · the lock: a party on a circulated split sheet cannot be renamed — page, route and database', async ({ browser, baseURL }) => {
  const ownerCtx = await as(browser, baseURL!, owner.id, owner.email);
  const api = ownerCtx.request;
  const writer = await partyRow(api, writerName);
  const ada = await partyRow(api, adaName);
  // Before any sheet: a rename is fine (then put back).
  expect((await api.patch(`/api/org/${ORG}/parties/${writer.id}`, { data: { display_name: `${writerName} x` } })).status()).toBe(200);
  expect((await api.patch(`/api/org/${ORG}/parties/${writer.id}`, { data: { display_name: writerName } })).status()).toBe(200);

  const made = await api.post(splits, { data: { kind: 'composition', lines: [{ party_id: writer.id, role: 'writer', share: '60' }, { party_id: ada.id, role: 'writer', share: '40' }] } });
  expect(made.status()).toBe(201);
  const sheet = (await made.json()).sheet as { id: string };
  // A draft sheet does not lock.
  expect((await api.patch(`/api/org/${ORG}/parties/${writer.id}`, { data: { display_name: `${writerName} y` } })).status()).toBe(200);
  expect((await api.patch(`/api/org/${ORG}/parties/${writer.id}`, { data: { display_name: writerName } })).status()).toBe(200);
  expect((await api.post(`${splits}/${sheet.id}/circulate`)).status()).toBe(200);

  const page = await ownerCtx.newPage();
  await page.goto(`/o/${SLUG}/rights/parties`);
  await page.locator(`[data-party="${writer.id}"]`).click({ timeout: 60_000 });
  await page.getByTestId('display-name').fill(`${writerName} renamed`);
  await page.getByTestId('party-save').click();
  await expect(page.getByTestId('party-error')).toContainText(/circulated/i, { timeout: 30_000 });
  await page.screenshot({ path: `${D}/lock-1440.png`, fullPage: true });
  expect((await partyRow(api, writerName)).id).toBe(writer.id);

  // The route says 409 party_locked; re-linking the account of a linked party too.
  const res = await api.patch(`/api/org/${ORG}/parties/${ada.id}`, { data: { display_name: 'Renamed Ada' } });
  expect(res.status()).toBe(409);
  expect(await res.json()).toMatchObject({ code: 'party_locked' });
  expect((await api.patch(`/api/org/${ORG}/parties/${ada.id}`, { data: { user_id: null } })).status()).toBe(409);
  // The legal data is still fixable.
  expect((await api.patch(`/api/org/${ORG}/parties/${writer.id}`, { data: { legal_name: `Winnie Writer-Smith ${run}` } })).status()).toBe(200);

  // The database holds the same line against a writer that skips the route.
  const raw = await api.fetch(`${REST}/parties?id=eq.${writer.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ display_name: 'Sneaky' }),
  });
  expect(raw.status()).toBeGreaterThanOrEqual(400);
  expect(await raw.text()).toMatch(/locked/);
  expect((await partyRow(api, writerName)).display_name).toBe(writerName);
});

test('7 · a credited person withdraws their own credit; the audit event stays', async ({ browser, baseURL }) => {
  const ownerCtx = await as(browser, baseURL!, owner.id, owner.email);
  const ada = await partyRow(ownerCtx.request, adaName);
  const proposed = await ownerCtx.request.post(credits, { data: { role: 'producer', party_id: ada.id } });
  expect(proposed.status()).toBe(201);

  const ctx = await as(browser, baseURL!, ownLine.id, ownLine.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${MIDNIGHT}`);
  const section = page.getByTestId('org-credits');
  await expect(section).toBeVisible({ timeout: 60_000 });
  await section.getByTestId('credit-person').first().click();
  await page.getByTestId('credit-withdraw').click();
  await page.getByRole('button', { name: 'Withdraw credit', exact: true }).click();
  await expect(section.getByTestId('credit-person')).toHaveCount(0, { timeout: 30_000 });

  const left = (await rest(ownerCtx.request, 'GET', `track_collaborators?select=id&track_id=eq.${MIDNIGHT}&party_id=eq.${ada.id}`)) as unknown[];
  expect(left).toEqual([]);
  const withdrawn = await events(ownerCtx.request, 'credit.withdrawn');
  expect(withdrawn.map((e) => [e.actor_id, e.audit, e.visibility, e.payload])).toEqual([[ARTIST_A_ID, true, 'artist', { role: 'producer', scope: 'recording', from: 'proposed', own: true }]]);
  // Another member cannot withdraw someone else's credit: the owner can (rights.write), the finance member cannot.
  const other = await ownerCtx.request.post(credits, { data: { role: 'mixer', name: `Mixer ${run}` } });
  const otherId = (await other.json()).credit.id as string;
  const fin = await as(browser, baseURL!, finance.id, finance.email);
  expect([403, 404]).toContain((await fin.request.delete(`${credits}/${otherId}`)).status());
  const aside = await as(browser, baseURL!, ownLine.id, ownLine.email);
  expect((await aside.request.delete(`${credits}/${otherId}`)).status()).toBe(404);
  expect((await ownerCtx.request.delete(`${credits}/${otherId}`)).status()).toBe(200);
});
