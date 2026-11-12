/**
 * Contract editor and document generation (LABEL-58) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true, migrations through 176).
 *
 * Seeded with the service key: the cast only (org, members, an artist, two
 * parties, a song in a project). The split sheet, the draft contract, every
 * edit, the version history, the send and the downloads go through the real
 * routes and pages:
 *   1 · a master split sheet is circulated; a draft Feature agreement is started;
 *   2 · the editor: live preview beside the form (blank values bracketed),
 *       a split-sheet suggestion applied with one click, a clause edited — all
 *       reflected in the preview BEFORE saving; saving makes version 2, the
 *       history names the clause, the clause is marked as edited;
 *   3 · "Send for signature" with a value still empty is refused, naming it;
 *       when complete it is sent: audit event with field names only, a
 *       restricted PDF filed in the song's project, content frozen (409);
 *   4 · the stored PDF is downloaded through the Files route (audited as
 *       file.restricted_downloaded) and carries the filled values; a marketing
 *       member can neither download it nor make a PDF;
 *   5 · 390 px: no sideways scroll on the editor (both tabs);
 *   6 · the producer dashboard and /store still load.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';
import { pdfText } from '../src/lib/labelos/contracts/pdf-text';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `editor-${run}`;
const NOVA = randomUUID();
const EP = randomUUID();
const SONG = randomUUID();
const P_NOVA = randomUUID();
const P_KILO = randomUUID();
const D = 'e2e-artifacts/LABEL-58';
void ANON_KEY;

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

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const owner = { id: PRODUCER_ID, email: 'producer@local.test' };
const marketing = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
type Row = Record<string, unknown>;
let contractId = '';

async function noSideways(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
}

test.beforeAll(async ({ request }) => {
  mkdirSync(D, { recursive: true });
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Editor Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', { id: EP, org_id: ORG, user_id: null, name: `Nova EP ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', { id: SONG, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${SONG}.mp3` });
  await rest(request, 'POST', 'project_tracks', { project_id: EP, track_id: SONG, position: 0 });
  const party = (id: string, name: string, extra: Record<string, unknown>) => ({ id, org_id: ORG, kind: 'person', display_name: name, legal_name: null, ipi: null, contact_id: null, user_id: null, ...extra });
  await rest(request, 'POST', 'parties', [
    party(P_NOVA, `Nova ${run}`, { legal_name: `Nova Okafor ${run}`, address: '2 Artist Road, Lagos', contact_id: NOVA }),
    party(P_KILO, `Kilo ${run}`, { legal_name: `Kilo Mensah ${run}`, address: '9 Feature Street, Accra' }),
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${ARTIST_A_ID}`);
});

test('1 · a split sheet in force and a draft feature agreement, through the real routes', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const made = await ctx.request.post(`/api/org/${ORG}/tracks/${SONG}/splits`, {
    data: { kind: 'master', lines: [{ party_id: P_NOVA, role: 'master_owner', share: '60' }, { party_id: P_KILO, role: 'master_owner', share: '40' }] },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const sheetId = ((await made.json()) as { sheet: { id: string } }).sheet.id;
  const circ = await ctx.request.post(`/api/org/${ORG}/tracks/${SONG}/splits/${sheetId}/circulate`);
  expect(circ.ok(), await circ.text()).toBeTruthy();

  const res = await ctx.request.post(`/api/org/${ORG}/contracts`, {
    data: {
      type: 'feature', title: `Feature deal ${run}`, artist_contact_id: NOVA, track_id: SONG,
      parties: [{ party_id: P_NOVA, role: 'artist' }, { party_id: P_KILO, role: 'featured' }],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  contractId = ((await res.json()) as { id: string }).id;
  await ctx.close();
});

test('2 · the editor: live preview, a split suggestion, a clause edit, versions and history', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('contract-editor-title')).toHaveText(`Feature deal ${run}`, { timeout: 60_000 });
  await expect(page.getByTestId('contract-preview')).toContainText(`Nova Okafor ${run}`);
  await expect(page.getByTestId('contract-preview')).toContainText(`Kilo Mensah ${run}`);
  await expect(page.getByTestId('contract-blank').first()).toBeVisible();
  await expect(page.getByTestId('contract-editor-meta')).toContainText('version 1');

  // The split sheet in force offers the artist's share; applying it shows in the preview before anything is saved.
  const suggestion = page.getByTestId(`suggest-master_share-${P_NOVA}`);
  await expect(suggestion).toContainText('60');
  await expect(suggestion).toContainText('Master split v1');
  await suggestion.click();
  await expect(page.getByTestId('contract-field-master_share')).toHaveValue('60');
  await expect(page.getByTestId('contract-preview')).toContainText('60% of the master', { timeout: 15_000 });
  await expect(page.getByTestId('contract-editor-save')).toBeEnabled();
  await page.screenshot({ path: `${D}/editor-1440.png`, fullPage: true });

  // A refused send names what is still empty (the form is dirty: it saves first, then asks).
  await page.getByTestId('contract-send').click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('contract-editor-error')).toContainText(/still empty/i, { timeout: 15_000 });
  await expect(page.getByTestId('contract-editor-error')).toContainText('Fee');
  await expect(page.getByTestId('contract-editor-meta')).toContainText('version 2');

  // Edit a clause: the preview follows, then Save makes the next version and marks the clause.
  const heading = await page.getByTestId('clause-heading-performance').inputValue();
  await page.getByTestId('clause-body-performance').fill('The Featured Artist performs on {{song.title}} only. Custom wording from our counsel.');
  await expect(page.getByTestId('contract-preview')).toContainText('Custom wording from our counsel', { timeout: 15_000 });
  await page.getByTestId('contract-editor-save').click();
  await expect(page.getByTestId('contract-editor-meta')).toContainText('version 3', { timeout: 15_000 });
  await expect(page.getByTestId('clause-mark-performance')).toContainText('Edited from the template');
  await expect(page.getByTestId('contract-history-edited').first()).toContainText(heading);

  const rows = (await rest(ctx.request, 'GET', `contracts?select=version,status,fields&id=eq.${contractId}`)) as Row[];
  expect(rows[0]).toMatchObject({ version: 3, status: 'draft' });
  const evs = (await rest(ctx.request, 'GET', `activity_events?select=payload,visibility&org_id=eq.${ORG}&verb=eq.contract.updated&order=created_at`)) as Row[];
  expect(evs.at(-1)).toMatchObject({ visibility: 'internal', payload: { changed: ['clauses'], changed_clauses: ['performance'], version: 3 } });
  expect(JSON.stringify(evs)).not.toContain('counsel');
  await ctx.close();
});

test('3 · send for signature: audited, frozen, a restricted PDF in the song’s project', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  await expect(page.getByTestId('contract-editor-title')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('contract-field-currency').fill('USD');
  await page.getByTestId('contract-field-fee').fill('1500');
  await page.getByTestId('contract-start').fill('2027-03-01');
  await page.getByTestId('contract-term').fill('24');
  await page.getByTestId('contract-territory').fill('WW');
  await page.getByTestId('contract-field-royalty_rate').fill('12.5');
  await page.getByTestId('contract-field-publishing_share').fill('25');
  await page.getByTestId('contract-field-credit_line').fill('feat. Kilo');
  await page.getByTestId('contract-field-governing_law').fill('the laws of England and Wales');
  await page.getByTestId('contract-send').click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('contract-editor-meta')).toContainText('Sent for signature', { timeout: 20_000 });
  await expect(page.getByTestId('contract-editor-form')).toHaveCount(0);
  await expect(page.getByTestId('contract-history-sent')).toBeVisible();
  await expect(page.getByTestId('contract-copy-link')).toBeVisible();

  const sent = (await rest(ctx.request, 'GET', `activity_events?select=audit,visibility,payload&org_id=eq.${ORG}&verb=eq.contract.sent`)) as Row[];
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ audit: true, visibility: 'internal', payload: { version: 4, clauses_changed: 1 } });
  expect([...(sent[0].payload as { fields: string[] }).fields].sort()).toEqual(['credit_line', 'currency', 'fee', 'governing_law', 'master_share', 'publishing_share', 'royalty_rate']);
  expect(JSON.stringify(sent)).not.toMatch(/1500|counsel/);

  const assets = (await rest(ctx.request, 'GET', `project_assets?select=id,kind,sensitivity,in_portal,project_id,mime&org_id=eq.${ORG}`)) as Row[];
  expect(assets).toMatchObject([{ kind: 'contract', sensitivity: 'restricted', in_portal: false, project_id: EP, mime: 'application/pdf' }]);

  // Frozen: the route and the database both refuse.
  const edit = await ctx.request.patch(`/api/org/${ORG}/contracts/${contractId}`, { data: { title: 'Changed' } });
  expect(edit.status()).toBe(409);
  const raw = await ctx.request.fetch(`${REST}/contracts?id=eq.${contractId}`, {
    method: 'PATCH', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }, data: { title: 'Changed' },
  });
  expect(raw.ok()).toBeFalsy();
  await page.screenshot({ path: `${D}/sent-1440.png`, fullPage: true });
  await ctx.close();
});

test('4 · the PDF carries the filled values; its download is audited; marketing gets nothing', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const assets = (await rest(ctx.request, 'GET', `project_assets?select=id&org_id=eq.${ORG}&kind=eq.contract`)) as { id: string }[];
  const stored = await ctx.request.get(`/api/org/${ORG}/projects/${EP}/assets/${assets[0].id}/download`);
  expect(stored.status()).toBe(200);
  const body = Buffer.from(await stored.body());
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  const text = pdfText(body);
  expect(text).toContain(`Nova Okafor ${run}`);
  expect(text).toContain('USD 1500');
  expect(text).toContain('60% of the master');
  expect(text).toContain('Custom wording from our counsel');
  expect(text).toContain('Sent for signature');
  // The filed contract cannot be declassified by editing the file.
  const declass = await ctx.request.patch(`/api/org/${ORG}/projects/${EP}/assets/${assets[0].id}`, { data: { kind: 'document', sensitivity: 'normal' } });
  expect(declass.status()).toBe(409);
  // A sent contract is served as it was sent, even after a party is edited.
  await rest(ctx.request, 'PATCH', `parties?id=eq.${P_NOVA}`, { legal_name: `Nova Renamed ${run}` });
  const frozen = pdfText(Buffer.from(await (await ctx.request.get(`/api/org/${ORG}/contracts/${contractId}/document`)).body()));
  expect(frozen).toContain(`Nova Okafor ${run}`);
  expect(frozen).not.toContain('Renamed');
  const audited = (await rest(ctx.request, 'GET', `activity_events?select=audit,visibility&org_id=eq.${ORG}&verb=eq.file.restricted_downloaded`)) as Row[];
  expect(audited).toHaveLength(1);
  expect(audited[0]).toMatchObject({ audit: true, visibility: 'internal' });

  const live = await ctx.request.get(`/api/org/${ORG}/contracts/${contractId}/document`);
  expect(live.status()).toBe(200);
  expect(pdfText(Buffer.from(await live.body()))).toContain('USD 1500');
  const dl = (await rest(ctx.request, 'GET', `activity_events?select=audit&org_id=eq.${ORG}&verb=eq.contract.document_downloaded`)) as Row[];
  // one for the filled-values check above, one for the sent-as-sent check: every request is audited
  expect(dl).toHaveLength(2);
  await ctx.close();

  const mkt = await as(browser, baseURL!, marketing.id, marketing.email);
  expect([403, 404]).toContain((await mkt.request.get(`/api/org/${ORG}/projects/${EP}/assets/${assets[0].id}/download`)).status());
  expect([403, 404]).toContain((await mkt.request.get(`/api/org/${ORG}/contracts/${contractId}/document`)).status());
  expect([403, 404]).toContain((await mkt.request.post(`/api/org/${ORG}/contracts/${contractId}/document`)).status());
  expect([403, 404]).toContain((await mkt.request.post(`/api/org/${ORG}/contracts/${contractId}/send`, { data: { version: 4 } })).status());
  const page = await mkt.newPage();
  const res = await page.goto(`/o/${SLUG}/rights/contracts/${contractId}`);
  expect(res?.status()).toBe(404);
  await mkt.close();
});

test('5 · a second draft: 390 px, both tabs, no sideways scroll; the no-project case', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const res = await ctx.request.post(`/api/org/${ORG}/contracts`, {
    data: { type: 'nda', title: `NDA ${run}`, parties: [{ party_id: P_NOVA, role: 'disclosing' }, { party_id: P_KILO, role: 'receiving' }] },
  });
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${SLUG}/rights/contracts/${id}`);
  await expect(page.getByTestId('contract-editor-title')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('contract-not-storable')).toBeVisible();
  await expect(page.getByTestId('contract-file-copy')).toHaveCount(0);
  await noSideways(page, 'editor edit tab');
  await page.screenshot({ path: `${D}/editor-edit-390.png`, fullPage: true });
  await page.getByTestId('contract-tab-preview').click();
  await expect(page.getByTestId('contract-preview')).toBeVisible();
  await noSideways(page, 'editor preview tab');
  await page.screenshot({ path: `${D}/editor-preview-390.png`, fullPage: true });
  await page.getByTestId('contract-tab-edit').click();
  await page.getByTestId('clause-add').click();
  await noSideways(page, 'editor with an added clause');

  // No project: the stored copy is refused with the reason; the live PDF still downloads.
  const filed = await ctx.request.post(`/api/org/${ORG}/contracts/${id}/document`);
  expect(filed.status()).toBe(409);
  expect(((await filed.json()) as { reason: string }).reason).toBe('no_project');
  expect((await ctx.request.get(`/api/org/${ORG}/contracts/${id}/document`)).status()).toBe(200);
  await ctx.close();
});

test('6 · the producer dashboard and the store still load', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, owner.id, owner.email);
  const page = await ctx.newPage();
  const lib = await page.goto('/library');
  expect(lib?.status()).toBeLessThan(400);
  const store = await page.goto('/store');
  expect(store?.status()).toBeLessThan(400);
  await ctx.close();
});
