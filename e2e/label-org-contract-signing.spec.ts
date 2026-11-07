/**
 * In-app signatures and the contract store (LABEL-60) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true, migrations through 178).
 * Seeded with the service key: the cast only (org, members, an artist,
 * parties). The contract, its wording, sending it, both signatures, the
 * external link, the certificate, the stale signature, the store, the calendar
 * reminder and the supersede all go through the real pages and routes, and the
 * external signer is a browser with NO cookies:
 *
 *   1 · an NDA between the label (a party linked to the owner’s account) and
 *       Kilo (no account) is filled in on the editor and sent for signature;
 *   2 · the owner signs for the label (typed AND drawn) in the panel: 1 of 2;
 *   3 · the owner makes Kilo’s signing link (shown once, only its hash stored)
 *       and an http provider address is refused;
 *   4 · Kilo, signed out, opens the link, reads the contract and signs;
 *       the contract becomes SIGNED; the same link then shows only a receipt;
 *       a revoked / made-up link is the one plain "does not work" message;
 *   5 · the certificate lists both signers, the document hash, the plain
 *       "in-app signature, not a qualified electronic signature" statement and
 *       the https provider address the owner saved; the drawn signature shows;
 *   6 · a signature row cannot be changed through the API, and the artist
 *       (not a party) reads nothing of the contract;
 *   7 · Kilo’s legal name is edited after sending: nothing anyone signed moves
 *       (the sent copy is frozen, its hash is on the contract), both stay valid;
 *   8 · the contract store finds the contract by Kilo’s name and shows when it
 *       ends; the calendar feed has one "Contract ends:" event, titles only;
 *   9 · supersede: the contract is voided, a draft copy opens, and Kilo’s old
 *       link is dead;
 *  10 · 390 px: no sideways scroll on the panel, the sign page, the store and
 *       the certificate; the producer dashboard and /store still load.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { ARTIST_A_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `csign-${run}`;
const NOVA = randomUUID();
const P_LABEL = randomUUID();
const P_KILO = randomUUID();
const D = 'e2e-artifacts/LABEL-60';

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

const RESEND = 'http://127.0.0.1:54400/emails';
const KILO_EMAIL = `kilo-${run}@local.test`;

/** The signing link is only ever EMAILED to the party (review M1): read it from the fake Resend. */
async function emailedLink(request: APIRequestContext, baseURL: string): Promise<string> {
  const mails = (await (await request.get(RESEND)).json()) as { body: { to: string | string[]; text: string } }[];
  const mail = [...mails].reverse().find((m) => [m.body.to].flat().includes(KILO_EMAIL));
  expect(mail, 'the signing email was sent to the party').toBeTruthy();
  const path = /\/sign\/[A-Za-z0-9_-]{43}/.exec(mail!.body.text)![0];
  return `${baseURL}${path}`;
}

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const artist = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
type Row = Record<string, unknown>;
let contractId = '';
let kiloLink = '';

async function noSideways(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
}

/** Draw a short stroke on the signature canvas (mouse = the same pointer events a finger sends). */
async function draw(page: Page, canvasTestId: string) {
  await page.getByTestId(canvasTestId).scrollIntoViewIfNeeded();
  const box = await page.getByTestId(canvasTestId).boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.15, box!.y + box!.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.3, { steps: 8 });
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.7, { steps: 8 });
  await page.mouse.up();
}

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `CSign Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA });
  const party = (id: string, kind: string, name: string, extra: Record<string, unknown>) => ({ id, org_id: ORG, kind, display_name: name, legal_name: null, ipi: null, email: null, user_linked_by: null, contact_id: null, user_id: null, details_confirmed_by: null, details_confirmed_at: null, ...extra });
  await rest(request, 'POST', 'parties', [
    party(P_LABEL, 'company', `CSign Records ${run}`, { legal_name: `CSign Records Ltd ${run}`, address: '1 Label Way, London', user_id: PRODUCER_ID, user_linked_by: ARTIST_A_ID, details_confirmed_by: PRODUCER_ID, details_confirmed_at: new Date().toISOString() }),
    party(P_KILO, 'person', `Kilo ${run}`, { legal_name: `Kilo Mensah ${run}`, address: '9 Feature Street, Accra', email: KILO_EMAIL }),
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
});

test('1 · an NDA is drafted, filled in on the editor and sent for signature', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const res = await ctx.request.post(`/api/org/${ORG}/contracts`, {
    data: { type: 'nda', title: `Studio NDA ${run}`, parties: [{ party_id: P_LABEL, role: 'disclosing' }, { party_id: P_KILO, role: 'receiving' }] },
  });
  expect(res.status(), await res.text()).toBe(201);
  contractId = ((await res.json()) as { id: string }).id;

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('contract-editor-title')).toHaveText(`Studio NDA ${run}`, { timeout: 60_000 });
  // A draft has no signing panel yet.
  await expect(page.getByTestId('signing-panel')).toHaveCount(0);
  await page.getByTestId('contract-start').fill('2026-12-01');
  await page.getByTestId('contract-term').fill('24');
  await page.getByTestId('contract-territory').fill('WW');
  await page.getByTestId('contract-field-confidentiality_years').fill('3');
  await page.getByTestId('contract-field-governing_law').fill('the laws of England and Wales');
  await page.getByTestId('contract-field-notice_days').fill('30');
  await page.getByTestId('contract-send').click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('contract-editor-meta')).toContainText('Sent for signature', { timeout: 20_000 });
  await expect(page.getByTestId('signing-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('signing-progress')).toContainText('0 of 2 parties have signed');
  await expect(page.getByTestId('signing-statement')).toContainText('not a qualified electronic signature');
  await ctx.close();
});

test('2 · the owner signs for the label, typed and drawn: 1 of 2', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('signing-panel')).toBeVisible({ timeout: 60_000 });
  // Only the label’s own party offers a Sign button to its account; Kilo’s does not.
  await expect(page.getByTestId(`sign-open-${P_LABEL}`)).toBeVisible();
  await expect(page.getByTestId(`sign-open-${P_KILO}`)).toHaveCount(0);
  await page.getByTestId(`sign-open-${P_LABEL}`).click();
  await page.getByTestId(`sign-${P_LABEL}-name`).fill(`Pat Producer ${run}`);
  await page.getByTestId(`sign-${P_LABEL}-draw-toggle`).check();
  await draw(page, `sign-${P_LABEL}-canvas`);
  const submit = page.getByTestId(`sign-${P_LABEL}-submit`);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('signing-progress')).toContainText('1 of 2 parties have signed', { timeout: 20_000 });
  await expect(page.getByTestId(`signer-receipt-${P_LABEL}`)).toContainText(`Pat Producer ${run}`);
  await expect(page.getByTestId(`signer-receipt-${P_LABEL}`)).toContainText('typed and drawn');
  await page.screenshot({ path: `${D}/panel-1-of-2-1440.png`, fullPage: true });

  const rows = (await rest(ctx.request, 'GET', `contract_signatures?select=*&contract_id=eq.${contractId}`)) as Row[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ party_id: P_LABEL, method: 'drawn', via: 'member', signed_by_user: PRODUCER_ID });
  expect(String(rows[0].signature_image)).toMatch(new RegExp(`^local://orgs/${ORG}/assets/${contractId}/`));
  expect(String(rows[0].ip_hash)).toMatch(/^[0-9a-f]{32}$/);
  expect(rows[0].document_sha256).toMatch(/^[0-9a-f]{64}$/);
  await ctx.close();
});

test('3 · Kilo’s signing link is emailed to Kilo (never shown to the issuer), only its hash is stored; an http provider address is refused', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('signing-panel')).toBeVisible({ timeout: 60_000 });
  await ctx.request.delete(RESEND);
  await page.getByTestId(`link-issue-${P_KILO}`).click();
  await expect(page.getByTestId('link-issued')).toContainText('Sent to', { timeout: 20_000 });
  // The member who issued it is shown no link at all.
  await expect(page.getByTestId('link-issued-url')).toHaveCount(0);
  kiloLink = await emailedLink(ctx.request, baseURL!);
  expect(kiloLink).toMatch(/\/sign\/[A-Za-z0-9_-]{43}$/);
  const token = kiloLink.split('/sign/')[1];
  // The database holds the hash, never the token; the event names no token.
  const signers = (await rest(ctx.request, 'GET', `contract_signers?select=*&contract_id=eq.${contractId}`)) as Row[];
  expect(signers).toHaveLength(1);
  expect(JSON.stringify(signers)).not.toContain(token);
  expect(String(signers[0].token_hash)).toMatch(/^[0-9a-f]{64}$/);
  const evs = (await rest(ctx.request, 'GET', `activity_events?select=verb,payload,audit&org_id=eq.${ORG}&order=created_at`)) as Row[];
  expect(JSON.stringify(evs)).not.toContain(token);
  expect(evs.map((e) => e.verb)).toEqual(expect.arrayContaining(['contract.sent', 'contract.signature_added', 'contract.signer_link_issued']));

  // After a reload the link is not shown again, but the panel says it is live.
  await page.reload();
  await expect(page.getByTestId('signing-panel')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('link-issued')).toHaveCount(0);
  await expect(page.getByTestId(`link-revoke-${P_KILO}`)).toBeVisible();

  await page.getByTestId('signing-provider').fill('http://sign.example.com/doc/1');
  await page.getByTestId('signing-provider-save').click();
  await expect(page.getByText('full https:// address')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('signing-provider').fill('https://sign.example.com/doc/1');
  await page.getByTestId('signing-provider-save').click();
  await expect(page.getByText('Address saved')).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});

test('4 · Kilo, signed out, reads the contract and signs; the contract becomes signed; the link then shows a receipt only', async ({ browser, baseURL }) => {
  const anon = await browser.newContext(); // no cookies at all
  const page = await anon.newPage();
  await page.goto(kiloLink.replace(/^https?:\/\/[^/]+/, baseURL!));
  await expect(page.getByTestId('sign-title')).toHaveText(`Studio NDA ${run}`, { timeout: 60_000 });
  await expect(page.getByTestId('sign-document')).toContainText(`Kilo Mensah ${run}`);
  await expect(page.getByTestId('sign-document')).toContainText(`CSign Records Ltd ${run}`);
  await expect(page.getByTestId('sign-statement')).toContainText('not a qualified or advanced electronic signature');
  // Nothing of the org’s inside: no internal note, no other contract, no member.
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('INTERNAL');
  await page.screenshot({ path: `${D}/sign-page-1440.png`, fullPage: true });

  // Review G14: the signer can download the exact PDF whose fingerprint the page shows.
  const href = await page.getByTestId('sign-download').getAttribute('href');
  const pdf = await anon.request.get(`${baseURL}${href}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const shown = (await page.locator('body').innerText()).match(/Document fingerprint \(SHA-256\):\s*([0-9a-f]{64})/)?.[1];
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(shown);

  await page.getByTestId('sign-name').fill(`Kilo Mensah ${run}`);
  await page.getByTestId('sign-draw-toggle').check();
  await draw(page, 'sign-canvas');
  await page.getByTestId('sign-submit').click();
  await expect(page.getByTestId('sign-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sign-receipt')).toContainText('Every party has now signed');

  // The contract is signed, with both events, written in the same transaction as the signature.
  const [row] = (await rest(anon.request, 'GET', `contracts?select=status&id=eq.${contractId}`)) as Row[];
  expect(row.status).toBe('signed');
  const evs = (await rest(anon.request, 'GET', `activity_events?select=verb,actor_id,created_at&org_id=eq.${ORG}&verb=in.(contract.signature_added,contract.signed)&order=created_at`)) as Row[];
  expect(evs.map((e) => e.verb).sort()).toEqual(['contract.signature_added', 'contract.signature_added', 'contract.signed']);
  // Kilo’s signature and the move to signed share one transaction: the same timestamp, and he has no account.
  const signedAt = evs.find((e) => e.verb === 'contract.signed')!.created_at;
  const last = evs.filter((e) => e.verb === 'contract.signature_added').find((e) => e.created_at === signedAt);
  expect(last).toBeTruthy();
  expect(last!.actor_id).toBeNull();
  const sigs = (await rest(anon.request, 'GET', `contract_signatures?select=*&contract_id=eq.${contractId}&order=signed_at`)) as Row[];
  expect(sigs[1]).toMatchObject({ party_id: P_KILO, via: 'link', method: 'drawn', signed_by_user: null });

  // Reload: only the receipt, no form. A made-up link is one plain message.
  await page.reload();
  await expect(page.getByTestId('sign-receipt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sign-form')).toHaveCount(0);
  await page.goto(`${baseURL}/sign/${'A'.repeat(43)}`);
  await expect(page.getByTestId('sign-gone')).toBeVisible({ timeout: 30_000 });
  await page.goto(`${baseURL}/sign/short`);
  await expect(page.getByTestId('sign-gone')).toBeVisible({ timeout: 30_000 });
  await anon.close();
});

test('5 · the certificate lists both signers, the hash, the plain statement, the provider address and the drawn signature', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}/certificate`);
  await expect(page.getByTestId('certificate')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('certificate-statement')).toContainText('in-app signature');
  await expect(page.getByTestId('certificate-statement')).toContainText('not a qualified or advanced electronic signature');
  await expect(page.getByTestId('certificate-hash')).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId(`certificate-signer-${P_LABEL}`)).toContainText(`Pat Producer ${run}`);
  await expect(page.getByTestId(`certificate-signer-${P_KILO}`)).toContainText(`Kilo Mensah ${run}`);
  await expect(page.getByTestId(`certificate-signer-${P_KILO}`)).toContainText('through a signing link');
  await expect(page.getByTestId('certificate-provider')).toHaveAttribute('href', 'https://sign.example.com/doc/1');
  const img = page.getByTestId(`certificate-image-${P_KILO}`);
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: `${D}/certificate-1440.png`, fullPage: true });

  // The contract page shows a fully signed contract.
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('signing-progress')).toContainText('Every party has signed', { timeout: 60_000 });
  await expect(page.getByTestId('contract-editor-meta')).toContainText('Signed');
  await ctx.close();
});

test('6 · a signature cannot be changed through the API; the artist (not a party) reads nothing of the contract', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const existing = (await rest(ctx.request, 'GET', `contract_signatures?select=id&contract_id=eq.${contractId}`)) as Row[];
  const id = existing[0].id as string;
  // Even the service role cannot rewrite or delete one: the trigger refuses.
  const upd = await ctx.request.fetch(`${REST}/contract_signatures?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ signer_name: 'Someone Else' }),
  });
  expect(upd.ok()).toBe(false);
  expect(await upd.text()).toMatch(/never changed/);
  const del = await ctx.request.fetch(`${REST}/contract_signatures?id=eq.${id}`, { method: 'DELETE', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } });
  expect(del.ok()).toBe(false);
  await ctx.close();

  const a = await as(browser, baseURL!, artist.id, artist.email);
  const res = await a.request.get(`/api/org/${ORG}/contracts/${contractId}/signing`);
  expect(res.status()).toBe(404);
  const cert = await a.newPage();
  await cert.goto(`/o/${SLUG}/rights/contracts/${contractId}/certificate`);
  // The page shell opens for a roster artist (they can have contracts of their own); the data does not.
  await expect(cert.getByTestId('certificate-failed')).toContainText('not yours to read', { timeout: 60_000 });
  await expect(cert.getByTestId('certificate')).toHaveCount(0);
  await a.close();
});

test('7 · renaming a party after the contract was sent changes nothing anyone signed: both signatures stay valid', async ({ browser, baseURL, request }) => {
  const before = (await rest(request, 'GET', `contract_signatures?select=*&contract_id=eq.${contractId}&order=signed_at`)) as Row[];
  const [frozenBefore] = (await rest(request, 'GET', `contracts?select=sent_document_sha256,sent_snapshot&id=eq.${contractId}`)) as Row[];
  await rest(request, 'PATCH', `parties?id=eq.${P_KILO}`, { legal_name: `Kilo Mensah-Boateng ${run}` });
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('signing-panel')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(`signer-${P_KILO}`).getByTestId('signer-state-signed')).toBeVisible();
  await expect(page.getByTestId(`signer-${P_LABEL}`).getByTestId('signer-state-signed')).toBeVisible();
  await expect(page.getByTestId('signing-stale-note')).toHaveCount(0);
  await expect(page.getByTestId('signing-progress')).toContainText('Every party has signed');
  // The certificate still names the text that was signed, by the same hash.
  const [frozenAfter] = (await rest(request, 'GET', `contracts?select=sent_document_sha256,sent_snapshot&id=eq.${contractId}`)) as Row[];
  expect(frozenAfter).toEqual(frozenBefore);
  expect(JSON.stringify(frozenAfter.sent_snapshot)).not.toContain('Boateng');
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}/certificate`);
  await expect(page.getByTestId('certificate-hash')).toHaveText(String(frozenBefore.sent_document_sha256));
  await page.screenshot({ path: `${D}/certificate-after-rename-1440.png`, fullPage: true });
  const after = (await rest(request, 'GET', `contract_signatures?select=*&contract_id=eq.${contractId}&order=signed_at`)) as Row[];
  expect(after).toEqual(before);
  expect(after.every((r) => r.document_sha256 === frozenBefore.sent_document_sha256)).toBe(true);
  await ctx.close();
});

test('8 · the store finds the contract by a party and shows when it ends; the calendar feed has the reminder, titles only', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  // A second, unrelated contract so the search has something to exclude.
  const other = await ctx.request.post(`/api/org/${ORG}/contracts`, { data: { type: 'nda', title: `Vendor NDA ${run}`, parties: [{ party_id: P_LABEL, role: 'disclosing' }] } });
  expect(other.status()).toBe(201);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts`);
  await expect(page.getByTestId('contracts-search-input')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(`contract-row-${contractId}`)).toBeVisible();
  await page.getByTestId('contracts-search-input').fill(`mensah-boateng ${run}`);
  await expect(page.getByTestId('contracts-count')).toContainText('1 of 2');
  await expect(page.getByTestId(`contract-row-${contractId}`)).toBeVisible();
  await expect(page.getByTestId(`contract-expiry-${contractId}`)).toContainText('ends 2028-11-30');
  await page.screenshot({ path: `${D}/store-1440.png`, fullPage: true });
  await page.getByTestId('contracts-search-input').fill('zzz-nothing');
  await expect(page.getByTestId('contracts-none-match')).toBeVisible();
  await page.getByTestId('contracts-none-match').getByRole('button', { name: 'Clear the search' }).click();
  await expect(page.getByTestId('contracts-count')).toContainText('2 contracts');

  // Calendar feed: the member’s own link, then the .ics with no cookies.
  const feed = await ctx.request.post(`/api/org/${ORG}/calendar/feed`);
  expect(feed.status(), await feed.text()).toBeLessThan(300);
  const { path } = (await feed.json()) as { active: boolean; path: string };
  expect(path).toContain('calendar.ics?token=');
  const anon = await browser.newContext();
  const ics = await anon.request.get(`${baseURL}${path}`);
  expect(ics.status()).toBe(200);
  const body = await ics.text();
  expect(body).toContain(`SUMMARY:Contract ends: Studio NDA ${run}`);
  expect(body).toContain('DTSTART;VALUE=DATE:20281130');
  expect(body).toContain('TRIGGER:-P30D');
  expect(body).not.toContain('Kilo');
  expect(body).not.toContain('Mensah');
  expect(body).not.toContain(`CSign Records Ltd`);
  expect(body).not.toContain(contractId);
  expect(body).not.toContain(`Vendor NDA ${run}`); // a draft with no term never expires
  await anon.close();
  await ctx.close();
});

test('9 · superseding voids the contract, opens a draft copy, and kills Kilo’s old link', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('signing-supersede')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('signing-supersede').click();
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`${contractId}$`), { timeout: 30_000 });
  await expect(page.getByTestId('contract-editor-title')).toHaveText(`Studio NDA ${run}`, { timeout: 60_000 });
  await expect(page.getByTestId('contract-editor-meta')).toContainText('Draft');
  const rows = (await rest(ctx.request, 'GET', `contracts?select=id,status,superseded_by,supersedes_id,internal_note&or=(id.eq.${contractId},supersedes_id.eq.${contractId})`)) as Row[];
  const old = rows.find((r) => r.id === contractId)!;
  const copy = rows.find((r) => r.id !== contractId)!;
  expect(old).toMatchObject({ status: 'void', superseded_by: copy.id });
  expect(copy).toMatchObject({ status: 'draft', supersedes_id: contractId, internal_note: null });
  // The old signatures remain on the old contract as the record.
  const sigs = (await rest(ctx.request, 'GET', `contract_signatures?select=id&contract_id=eq.${contractId}`)) as Row[];
  expect(sigs).toHaveLength(2);
  await ctx.close();

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(kiloLink.replace(/^https?:\/\/[^/]+/, baseURL!));
  await expect(p.getByTestId('sign-gone')).toBeVisible({ timeout: 30_000 });
  await anon.close();
});

test('10 · 390 px: no sideways scroll anywhere; the producer dashboard and /store still load', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const c = sessionCookie(owner.id, owner.email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  const page = await ctx.newPage();

  // A fresh, still-open contract for the mobile pass.
  const made = await ctx.request.post(`/api/org/${ORG}/contracts`, {
    data: { type: 'nda', title: `Mobile NDA ${run}`, parties: [{ party_id: P_LABEL, role: 'disclosing' }, { party_id: P_KILO, role: 'receiving' }], effective_date: '2026-12-01', term_months: 12, territories: ['WW'], fields: { confidentiality_years: '2', governing_law: 'England', notice_days: '30' } },
  });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { id: string }).id;
  const sent = await ctx.request.post(`/api/org/${ORG}/contracts/${id}/send`, { data: { version: 1 } });
  expect(sent.status(), await sent.text()).toBe(200);

  await page.goto(`/o/${SLUG}/rights/contracts/${id}`);
  await expect(page.getByTestId('signing-panel')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(`sign-open-${P_LABEL}`).click();
  await page.getByTestId(`sign-${P_LABEL}-draw-toggle`).check();
  await noSideways(page, 'signing panel');
  await page.screenshot({ path: `${D}/panel-390.png`, fullPage: true });
  await ctx.request.delete(RESEND);
  await page.getByTestId(`link-issue-${P_KILO}`).click();
  await expect(page.getByTestId('link-issued')).toContainText('Sent to', { timeout: 20_000 });
  const link = await emailedLink(ctx.request, baseURL!);

  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sign = await anon.newPage();
  await sign.goto(link);
  await expect(sign.getByTestId('sign-title')).toBeVisible({ timeout: 60_000 });
  await sign.getByTestId('sign-draw-toggle').check();
  await noSideways(sign, 'sign page');
  await sign.screenshot({ path: `${D}/sign-page-390.png`, fullPage: true });
  await anon.close();

  await page.goto(`/o/${SLUG}/rights/contracts`);
  await expect(page.getByTestId('contracts-search-input')).toBeVisible({ timeout: 60_000 });
  await noSideways(page, 'contract store');
  await page.screenshot({ path: `${D}/store-390.png`, fullPage: true });
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}/certificate`);
  await expect(page.getByTestId('certificate')).toBeVisible({ timeout: 60_000 });
  await noSideways(page, 'certificate');
  await page.screenshot({ path: `${D}/certificate-390.png`, fullPage: true });

  // Nothing existing moved.
  const lib = await page.goto('/library');
  expect(lib!.status()).toBeLessThan(400);
  const store = await page.goto('/store');
  expect(store!.status()).toBe(200);
  await ctx.close();
});

test('H1 · a member who links their OWN account to a party cannot confirm it or sign as it (real database)', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  // One party per account: free the owner's account from the label party first.
  const unlinked = await ctx.request.patch(`/api/org/${ORG}/parties/${P_LABEL}`, { data: { user_id: null } });
  expect(unlinked.status(), await unlinked.text()).toBe(200);
  const patched = await ctx.request.patch(`/api/org/${ORG}/parties/${P_KILO}`, { data: { user_id: PRODUCER_ID } });
  expect(patched.status(), await patched.text()).toBe(200);
  // The route stamped who made the link; the database trigger keeps the stamp honest.
  const [row] = (await rest(ctx.request, 'GET', `parties?select=user_id,user_linked_by,details_confirmed_by&id=eq.${P_KILO}`)) as Row[];
  expect(row).toMatchObject({ user_id: PRODUCER_ID, user_linked_by: PRODUCER_ID, details_confirmed_by: null });

  const confirm = await ctx.request.post(`/api/org/${ORG}/parties/${P_KILO}/confirm`, { data: {} });
  expect(confirm.status()).toBe(403);
  expect(((await confirm.json()) as { code: string }).code).toBe('self_linked');

  // Even with a confirmation forced onto the row, a link the signer made themself signs nobody.
  await rest(ctx.request, 'PATCH', `parties?id=eq.${P_KILO}`, { details_confirmed_by: PRODUCER_ID, details_confirmed_at: new Date().toISOString() });
  const sha = ((await (await ctx.request.get(`/api/org/${ORG}/contracts/${contractId}/signing`)).json()) as { documentSha256: string }).documentSha256;
  const sign = await ctx.request.post(`/api/org/${ORG}/contracts/${contractId}/signing`, { data: { party_id: P_KILO, version: 1, document_sha256: sha, name: 'Kilo Mensah' } });
  expect(sign.status()).toBe(403);
  expect(((await sign.json()) as { code: string }).code).toBe('not_your_party');
  await ctx.close();
});
