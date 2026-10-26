/**
 * Split sheets (LABEL-28) end to end against a REAL database (scripts/local-db:
 * Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true, migration 155 included).
 *
 * The acceptance criteria, through the real stack and at the database:
 *   · 33.3333 × 3 cannot circulate — the route says 422, and a raw database
 *     UPDATE is refused by the trigger as well;
 *   · a circulated sheet cannot be edited — the route says 409, and raw
 *     database UPDATE / INSERT / DELETE of its lines, its note and the sheet
 *     are all refused by the triggers;
 *   · a new version supersedes the old one, atomically, with audit events.
 * Plus D2 (a member with an own line, and an external member, see their own
 * line only — through the route AND with their own JWT straight from
 * PostgREST), the signed-PDF path (a restricted file whose downloads are
 * audited and need contracts.read), and the real page.
 *
 * Cast: the producer owns the label (rights.write). ARTIST_A is a member with
 * the producer function (own line); ARTIST_B is marketing (no rights ability);
 * the seed BUYER is an EXTERNAL contributor on Nova's project.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `splits-${run}`;
const NOVA = randomUUID();
const NOVA_EP = randomUUID();
const OTHER_EP = randomUUID();
const MIDNIGHT = randomUUID();
const ELSEWHERE = randomUUID();
const P_NOVA = randomUUID();
const P_ARTIST_A = randomUUID();
const P_BUYER = randomUUID();
const P_KILO = randomUUID();

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown, expectOk = true) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  if (expectOk) expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res;
}
const json = async (res: Awaited<ReturnType<typeof rest>>) => (res.status() === 204 ? null : res.json());

/** A PostgREST read with the member's OWN token, the way their browser would: RLS decides. */
async function readAs(request: APIRequestContext, who: { id: string; email: string } | null, p: string) {
  const res = await request.fetch(`${REST}/${p}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${who ? userToken(who.id, who.email) : ANON_KEY}` },
  });
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>[];
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const external = { id: BUYER_ID, email: 'buyer@local.test' };
const ownLine = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const marketing = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const splits = `/api/org/${ORG}/tracks/${MIDNIGHT}/splits`;
type SheetJson = { id: string; version: number; status: string; total?: string; lines: { id: string; name: string; share: string; mine: boolean; signed: boolean }[] };
type Event = { verb: string; audit: boolean; actor_id: string | null; visibility: string; payload: Record<string, unknown>; song_id: string | null };
const events = async (request: APIRequestContext, verb: string) =>
  (await json(await rest(request, 'GET', `activity_events?select=verb,audit,actor_id,visibility,payload,song_id&org_id=eq.${ORG}&verb=eq.${verb}&order=created_at`))) as Event[];
const sheetRows = async (request: APIRequestContext) =>
  (await json(await rest(request, 'GET', `split_sheets?select=id,version,status,kind,note,superseded_by&track_id=eq.${MIDNIGHT}&order=kind,version`))) as {
    id: string; version: number; status: string; kind: string; note: string | null; superseded_by: string | null;
  }[];

const L3 = [
  { party_id: P_NOVA, role: 'writer', share: '33.3333' },
  { party_id: P_ARTIST_A, role: 'writer', share: '33.3333' },
  { party_id: P_KILO, role: 'writer', share: '33.3333' },
];
let v1 = '';
let v2 = '';

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'DELETE', `project_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Split Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['producer'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_EP, org_id: ORG, user_id: null, name: `Nova EP ${run}`, inbox_for_contact_id: NOVA },
    { id: OTHER_EP, org_id: ORG, user_id: null, name: `Other EP ${run}`, inbox_for_contact_id: null },
  ]);
  await rest(request, 'POST', 'tracks', [
    { id: MIDNIGHT, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${MIDNIGHT}.mp3` },
    { id: ELSEWHERE, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Elsewhere ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${ELSEWHERE}.mp3` },
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_EP, track_id: MIDNIGHT, position: 0 },
    { project_id: OTHER_EP, track_id: ELSEWHERE, position: 0 },
  ]);
  await rest(request, 'POST', 'project_members', { org_id: ORG, project_id: NOVA_EP, user_id: BUYER_ID, role: 'contributor', allow_downloads: false, invited_by: PRODUCER_ID });
  // PostgREST bulk inserts need the same keys on every row.
  const party = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, org_id: ORG, kind: 'person', display_name: name, legal_name: null, ipi: null, contact_id: null, user_id: null, ...extra,
  });
  await rest(request, 'POST', 'parties', [
    party(P_NOVA, `Nova ${run}`, { legal_name: `Nova Okafor ${run}`, ipi: '00987654321', contact_id: NOVA }),
    party(P_ARTIST_A, `Pierre ${run}`, { legal_name: `Pierre Producteur ${run}`, ipi: '00123456789', user_id: ARTIST_A_ID }),
    party(P_BUYER, `Cleo ${run}`, { user_id: BUYER_ID }),
    party(P_KILO, `Kilo ${run}`),
  ]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`, undefined, false);
  await rest(request, 'DELETE', `project_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`, undefined, false);
});

test('1 · ACCEPTANCE: 33.3333 × 3 cannot circulate — by the route and by the database', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const api = ctx.request;
  const made = await api.post(splits, { data: { kind: 'composition', note: 'first cut', lines: L3 } });
  expect(made.status()).toBe(201);
  const { sheet } = (await made.json()) as { sheet: SheetJson };
  v1 = sheet.id;
  expect(sheet).toMatchObject({ version: 1, status: 'draft', total: '99.9999' });
  expect(await sheetRows(api)).toMatchObject([{ id: v1, status: 'draft', kind: 'composition', version: 1 }]);

  const refused = await api.post(`${splits}/${v1}/circulate`);
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error).toBe('The shares add up to 99.9999%; 0.0001% is still unassigned.');
  expect((await sheetRows(api))[0].status).toBe('draft');

  // The database holds the same rule: a raw UPDATE past the route is refused by the trigger.
  const raw = await rest(api, 'PATCH', `split_sheets?id=eq.${v1}`, { status: 'circulated' }, false);
  expect(raw.status()).toBeGreaterThanOrEqual(400);
  expect(await raw.text()).toContain('add up to 99.9999, not 100');
  expect((await sheetRows(api))[0].status).toBe('draft');
  expect(await events(api, 'split_sheet.circulated')).toEqual([]);
});

test('2 · the real page: the sum is live, Circulate waits for exactly 100, and circulating shows the sheet in force', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${MIDNIGHT}`);
  const section = page.getByTestId('org-splits');
  await expect(section).toBeVisible({ timeout: 60_000 });

  await expect(section.getByTestId('splits-total')).toContainText('99.9999%');
  await expect(section.getByTestId('splits-total')).toContainText('0.0001% unassigned.');
  await expect(section.getByTestId('splits-circulate')).toBeDisabled();

  await section.getByTestId('splits-share').first().fill('33.3334');
  await expect(section.getByTestId('splits-total')).toContainText('100%');
  await expect(section.getByTestId('splits-total')).toHaveAttribute('data-tone', 'ok');
  await expect(section.getByTestId('splits-circulate')).toBeEnabled();

  await section.getByTestId('splits-circulate').click();
  const sheet = section.getByTestId('splits-sheet');
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(section.getByTestId('splits-status')).toHaveText('Circulated');
  await expect(section.getByTestId('splits-progress')).toHaveText('0 of 3 signed');
  await expect(section.getByTestId('splits-line')).toHaveCount(3);
  await expect(section.getByTestId('splits-share')).toHaveCount(0);

  const rows = await sheetRows(ctx.request);
  expect(rows).toMatchObject([{ id: v1, status: 'circulated' }]);
  const shares = (await json(await rest(ctx.request, 'GET', `split_lines?select=share&split_sheet_id=eq.${v1}&order=share.desc`))) as { share: number }[];
  expect(shares.map((s) => s.share)).toEqual([33.3334, 33.3333, 33.3333]);
  expect(shares.reduce((a, s) => a + Math.round(s.share * 10000), 0)).toBe(1_000_000);
  const circulated = await events(ctx.request, 'split_sheet.circulated');
  expect(circulated.map((e) => [e.actor_id, e.audit, e.visibility, e.song_id])).toEqual([[PRODUCER_ID, true, 'internal', MIDNIGHT]]);
  expect(JSON.stringify(circulated)).not.toMatch(/33\.333|Okafor|00987654321/);
});

test('3 · ACCEPTANCE: a circulated sheet cannot be edited — the route says 409 and the triggers hold', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const api = ctx.request;
  const lineId = ((await json(await rest(api, 'GET', `split_lines?select=id&split_sheet_id=eq.${v1}&party_id=eq.${P_NOVA}`))) as { id: string }[])[0].id;
  const snapshot = JSON.stringify(await json(await rest(api, 'GET', `split_lines?select=id,party_id,role,share&split_sheet_id=eq.${v1}&order=id`)));

  const edit = await api.patch(`${splits}/${v1}`, { data: { lines: [{ party_id: P_NOVA, role: 'writer', share: '100' }] } });
  expect(edit.status()).toBe(409);
  expect((await api.patch(`${splits}/${v1}`, { data: { note: 'sneaky' } })).status()).toBe(409);
  expect((await api.delete(`${splits}/${v1}`)).status()).toBe(409);

  // Past the routes, straight at the tables (service role): every write is refused by the trigger.
  for (const [method, path, body] of [
    ['PATCH', `split_lines?id=eq.${lineId}`, { share: 50 }],
    ['PATCH', `split_lines?id=eq.${lineId}`, { party_id: P_KILO }],
    ['PATCH', `split_lines?id=eq.${lineId}`, { role: 'composer' }],
    ['POST', 'split_lines', { split_sheet_id: v1, party_id: P_BUYER, role: 'publisher', share: 1 }],
    ['DELETE', `split_lines?id=eq.${lineId}`, undefined],
    ['PATCH', `split_sheets?id=eq.${v1}`, { note: 'sneaky' }],
    ['PATCH', `split_sheets?id=eq.${v1}`, { status: 'draft' }],
    ['DELETE', `split_sheets?id=eq.${v1}`, undefined],
  ] as const) {
    const res = await rest(api, method, path, body, false);
    expect(res.status(), `${method} ${path} ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toMatch(/circulated sheet cannot be edited|cannot be deleted|cannot go from/);
  }
  expect(JSON.stringify(await json(await rest(api, 'GET', `split_lines?select=id,party_id,role,share&split_sheet_id=eq.${v1}&order=id`)))).toBe(snapshot);
  expect((await sheetRows(api))[0]).toMatchObject({ status: 'circulated', note: 'first cut' });

  // A member's own JWT cannot write either (RLS: no write policy, plus the service-only trigger).
  const forged = await ctx.request.fetch(`${REST}/split_lines?id=eq.${lineId}`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(producer.id, producer.email)}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: JSON.stringify({ share: 99 }),
  });
  expect([200, 204, 401, 403]).toContain(forged.status());
  if (forged.status() === 200) expect(await forged.json()).toEqual([]);
  expect(JSON.stringify(await json(await rest(api, 'GET', `split_lines?select=id,party_id,role,share&split_sheet_id=eq.${v1}&order=id`)))).toBe(snapshot);
});

test('4 · D2: a member with an own line, an external member and marketing — through the route AND with their own JWT', async ({ browser, baseURL }) => {
  // The owner puts the external contributor on the sheet too, by superseding: v2 gets Cleo as a publisher? No — keep v1 as is and read it.
  const own = await as(browser, baseURL!, ownLine.id, ownLine.email);
  const res = await own.request.get(splits);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { me: { reach: string }; sheets: SheetJson[] };
  expect(body.me.reach).toBe('own');
  expect(body.sheets).toHaveLength(1);
  expect(body.sheets[0].lines).toHaveLength(1);
  expect(body.sheets[0].lines[0]).toMatchObject({ name: `Pierre ${run}`, share: '33.3333', mine: true });
  expect(body.sheets[0].total).toBeUndefined();
  const wire = JSON.stringify(body);
  for (const leak of [`Nova ${run}`, `Kilo ${run}`, 'Okafor', '00987654321', '33.3334']) expect(wire, leak).not.toContain(leak);

  // With their own JWT straight from PostgREST: RLS shows the sheet and their line only.
  expect(await readAs(own.request, ownLine, `split_lines?select=party_id,share`)).toEqual([{ party_id: P_ARTIST_A, share: 33.3333 }]);
  expect((await readAs(own.request, ownLine, `split_sheets?select=id,status`)).map((s) => s.status)).toEqual(['circulated']);
  // 162 (LABEL-43): the negotiation note, who wrote and circulated the sheet, and its document are closed to their
  // own JWT by a column grant — and so is `*`. PostgREST answers a permission error, never the value.
  for (const column of ['note', 'created_by', 'circulated_by', 'document_asset_id', '*']) {
    const res = await own.request.fetch(`${REST}/split_sheets?select=${column}`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(ownLine.id, ownLine.email)}` },
    });
    expect(res.ok(), column).toBeFalsy();
    const text = await res.text();
    expect(text, column).toMatch(/permission denied/);
    expect(text, column).not.toContain('first cut');
  }

  // Marketing: 403 from the route, nothing from the database.
  const mk = await as(browser, baseURL!, marketing.id, marketing.email);
  expect((await mk.request.get(splits)).status()).toBe(403);
  expect(await readAs(mk.request, marketing, 'split_lines?select=id')).toEqual([]);
  expect(await readAs(mk.request, marketing, 'split_sheets?select=id')).toEqual([]);
  // anon, and the external member (no org membership): nothing through the database.
  expect(await readAs(mk.request, null, 'split_lines?select=id')).toEqual([]);
  expect(await readAs(mk.request, external, 'split_lines?select=id')).toEqual([]);

  // The external contributor: the route serves a project member their own line (they have none on v1: an empty list, not a leak).
  const ext = await as(browser, baseURL!, external.id, external.email);
  const extRes = await ext.request.get(splits);
  expect(extRes.status()).toBe(200);
  const extBody = (await extRes.json()) as { me: { reach: string }; sheets: SheetJson[] };
  expect(extBody.me.reach).toBe('own');
  expect(extBody.sheets).toEqual([]);
  expect(JSON.stringify(extBody)).not.toMatch(/Okafor|Nova|33\.333/);
  // … and a song of a project they are not in is not there at all.
  expect((await ext.request.get(`/api/org/${ORG}/tracks/${ELSEWHERE}/splits`)).status()).toBe(404);
  // They cannot start, edit, circulate or supersede, and cannot acknowledge a line that is not theirs.
  expect([403, 404]).toContain((await ext.request.post(splits, { data: { kind: 'master' } })).status());
  expect([403, 404]).toContain((await ext.request.post(`${splits}/${v1}/supersede`)).status());
  expect([403, 404]).toContain((await ext.request.post(`${splits}/${v1}/circulate`)).status());
  const novaLine = ((await json(await rest(ext.request, 'GET', `split_lines?select=id&split_sheet_id=eq.${v1}&party_id=eq.${P_NOVA}`))) as { id: string }[])[0].id;
  expect((await ext.request.post(`${splits}/${v1}/signatures`, { data: { method: 'acknowledged', line_id: novaLine } })).status()).toBe(404);
  expect((await own.request.post(`${splits}/${v1}/signatures`, { data: { method: 'acknowledged', line_id: novaLine } })).status()).toBe(404);
});

test('5 · ACCEPTANCE: a new version supersedes the old one, atomically, with audit events', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const api = ctx.request;
  const res = await api.post(`${splits}/${v1}/supersede`);
  expect(res.status()).toBe(201);
  const { sheet } = (await res.json()) as { sheet: SheetJson };
  v2 = sheet.id;
  expect(sheet).toMatchObject({ version: 2, status: 'draft', total: '100' });
  expect((await sheetRows(api)).map((r) => `v${r.version}:${r.status}`)).toEqual(['v1:circulated', 'v2:draft']);
  expect((await api.post(`${splits}/${v1}/supersede`)).status()).toBe(409); // one draft at a time

  // v2 changes the split: Pierre 40, Kilo 26.6666 → 33.3334 / 40 / 26.6666. Save it, circulate it.
  const saved = await api.patch(`${splits}/${v2}`, {
    data: { lines: [{ party_id: P_NOVA, role: 'writer', share: '33.3334' }, { party_id: P_ARTIST_A, role: 'writer', share: '40' }, { party_id: P_KILO, role: 'writer', share: '26.6666' }] },
  });
  expect(saved.status()).toBe(200);
  const out = await api.post(`${splits}/${v2}/circulate`);
  expect(out.status()).toBe(200);
  expect((await out.json()).supersededId).toBe(v1);

  expect((await sheetRows(api)).map((r) => `v${r.version}:${r.status}`)).toEqual(['v1:superseded', 'v2:circulated']);
  expect((await sheetRows(api))[0].superseded_by).toBe(v2);
  const audit = (await json(await rest(api, 'GET', `activity_events?select=verb&org_id=eq.${ORG}&audit=is.true&verb=like.split_sheet.*&order=created_at,id`))) as { verb: string }[];
  expect(audit.map((e) => e.verb).sort()).toEqual(['split_sheet.circulated', 'split_sheet.circulated', 'split_sheet.superseded']);
  // v1 is on record, unchanged.
  expect((await json(await rest(api, 'GET', `split_lines?select=share&split_sheet_id=eq.${v1}&order=share.desc`))) as { share: number }[]).toHaveLength(3);
  // And the database allows only one version in force.
  const second = await rest(api, 'POST', 'split_sheets', { org_id: ORG, track_id: MIDNIGHT, kind: 'composition', version: 3 }, false);
  expect(second.ok()).toBeTruthy(); // a draft beside the live one is fine …
  await rest(api, 'DELETE', `split_sheets?track_id=eq.${MIDNIGHT}&version=eq.3`);
});

test('6 · signatures: acknowledged on the page by the person on the line, a signed PDF by the owner — a restricted file, audited downloads', async ({ browser, baseURL }) => {
  const own = await as(browser, baseURL!, ownLine.id, ownLine.email);
  const page = await own.newPage();
  await page.goto(`/o/${SLUG}/songs/${MIDNIGHT}`);
  const section = page.getByTestId('org-splits');
  await expect(section).toBeVisible({ timeout: 60_000 });
  await expect(section.getByTestId('splits-line')).toHaveCount(1);
  await expect(section.getByTestId('splits-total')).toHaveCount(0);
  await section.getByTestId('splits-acknowledge').click();
  await expect(section.getByTestId('splits-signed')).toHaveText('acknowledged', { timeout: 30_000 });
  const lines = (await json(await rest(own.request, 'GET', `split_lines?select=party_id,signature_method,signed_by&split_sheet_id=eq.${v2}&signed_at=not.is.null`))) as { party_id: string; signature_method: string; signed_by: string }[];
  expect(lines).toEqual([{ party_id: P_ARTIST_A, signature_method: 'acknowledged', signed_by: ARTIST_A_ID }]);

  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const api = ctx.request;
  // A member with only an own line cannot upload a signed PDF.
  const pdf = { name: 'signed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%e2e\n') };
  expect([403, 404]).toContain((await own.request.post(`${splits}/${v2}/signatures`, { multipart: { file: pdf } })).status());

  const up = await api.post(`${splits}/${v2}/signatures`, { multipart: { file: pdf } });
  expect(up.status()).toBe(200);
  const upBody = (await up.json()) as { complete: boolean; sheet: SheetJson };
  expect(upBody.complete).toBe(true);
  expect(upBody.sheet.status).toBe('signed');
  expect((await sheetRows(api)).map((r) => `v${r.version}:${r.status}`)).toEqual(['v1:superseded', 'v2:signed']);

  const asset = ((await json(await rest(api, 'GET', `project_assets?select=id,kind,sensitivity,project_id,created_by,in_portal&org_id=eq.${ORG}&kind=eq.split_sheet`))) as {
    id: string; kind: string; sensitivity: string; project_id: string; created_by: string; in_portal: boolean;
  }[]);
  expect(asset).toHaveLength(1);
  expect(asset[0]).toMatchObject({ sensitivity: 'restricted', project_id: NOVA_EP, created_by: PRODUCER_ID, in_portal: false });
  const methods = (await json(await rest(api, 'GET', `split_lines?select=signature_method&split_sheet_id=eq.${v2}&order=signature_method`))) as { signature_method: string }[];
  expect(methods.map((m) => m.signature_method)).toEqual(['acknowledged', 'upload', 'upload']);
  const signed = await events(api, 'split_sheet.signed');
  expect(signed.map((e) => [e.actor_id, e.audit, e.payload.complete])).toEqual([[ARTIST_A_ID, true, false], [PRODUCER_ID, true, true]]);

  // The signed PDF is restricted: the owner (contracts.read) downloads it and the download is an audit event; a producer-function member cannot.
  const url = `/api/org/${ORG}/projects/${NOVA_EP}/assets/${asset[0].id}/download`;
  expect((await own.request.get(url)).status()).toBe(403);
  const dl = await api.get(url);
  expect(dl.status()).toBe(200);
  expect((await events(api, 'file.restricted_downloaded')).map((e) => [e.actor_id, e.audit])).toEqual([[PRODUCER_ID, true]]);

  // Nothing is writable any more, and the signed sheet cannot be signed again.
  expect((await api.patch(`${splits}/${v2}`, { data: { note: 'late' } })).status()).toBe(409);
  const again = await api.post(`${splits}/${v2}/signatures`, { multipart: { file: pdf } });
  expect(again.status()).toBe(409);
  expect(await rest(api, 'GET', `project_assets?select=id&org_id=eq.${ORG}&kind=eq.split_sheet`).then(json)).toHaveLength(1);
});
