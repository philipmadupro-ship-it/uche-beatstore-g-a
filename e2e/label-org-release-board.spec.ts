/**
 * The release board, a release's page and delivery (LABEL-33) end to end
 * against a REAL database (scripts/local-db: Postgres + PostgREST + RLS,
 * LABEL_OS_ENABLED=true). What mocks cannot prove: the board's gate strip is
 * what LABEL-32 derives from real credits, splits, approvals and metadata;
 * the tracklist controls keep positions 1..n through PostgREST; a release
 * goes from draft to delivered through the page — once gates are satisfied by
 * the REAL approval, split and credit routes, or by an owner's written
 * override — and each delivery writes exactly one audit event.
 *
 * Cast: the producer owns the label (and is the writer on the ready song).
 * ARTIST_A is a_and_r — release.write, not an owner. ARTIST_B is a_and_r
 * scoped to Kilo only. The seed BUYER is marketing (reads, cannot write, no
 * rights.read).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `board-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();
const PARTY = randomUUID();
// Songs: the ready one with its master, two for the blocked single, one of Kilo's.
const READY_SONG = randomUUID();
const READY_MASTER = randomUUID();
const SONG_A = randomUUID();
const SONG_B = randomUUID();
const SONG_C = randomUUID();
const KILO_SONG = randomUUID();
const ART = randomUUID();

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

/** A solid RGB PNG of the given size (a few KB deflated), so the artwork size rule (09 §4) reads a real file header. */
function solidPng(size: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + size * 3, 0x30);
  row[0] = 0; // filter: none
  const raw = Buffer.alloc(row.length * size);
  for (let y = 0; y < size; y++) row.copy(raw, y * row.length);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const shots = 'e2e-artifacts/LABEL-52';
mkdirSync(shots, { recursive: true });

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const aAndR = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const scoped = { id: ARTIST_B_ID, email: 'artist-b@local.test' };
const marketing = { id: BUYER_ID, email: 'buyer@local.test' };

const api = `/api/org/${ORG}`;
const ids: Record<string, string> = {};

const song = (id: string, title: string, stage: string | null) => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', song_stage: stage, audio_url: `/uploads/labelos-e2e-${id}.mp3`,
});

type EventRow = { verb: string; audit: boolean; visibility: string; actor_id: string | null; release_id: string | null; payload: Record<string, unknown> };
const deliveredEvents = async (request: APIRequestContext, release: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,visibility,actor_id,release_id,payload&verb=eq.release.delivered&release_id=eq.${release}`)) as EventRow[];

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Board Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_B_ID, contact_id: KILO });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA },
    { id: KILO_INBOX, org_id: ORG, user_id: null, name: `Inbox · Kilo ${run}`, inbox_for_contact_id: KILO },
  ]);
  await rest(request, 'POST', 'tracks', [
    song(READY_SONG, 'Ready Song', 'selected'),
    song(READY_MASTER, 'Ready Song (master)', null),
    song(SONG_A, 'Alpha', 'selected'),
    song(SONG_B, 'Bravo', 'selected'),
    song(SONG_C, 'Charlie', 'selected'),
    song(KILO_SONG, 'Kilo Song', 'selected'),
  ]);
  await rest(request, 'PATCH', `tracks?id=eq.${READY_MASTER}`, { isrc: 'USRC17607839' });
  await rest(request, 'POST', 'project_tracks', [READY_SONG, READY_MASTER, SONG_A, SONG_B, SONG_C].map((track_id, position) => ({ project_id: NOVA_INBOX, track_id, position })));
  await rest(request, 'POST', 'project_tracks', { project_id: KILO_INBOX, track_id: KILO_SONG, position: 0 });
  await rest(request, 'POST', 'track_links', { from_track_id: READY_SONG, to_track_id: READY_MASTER, user_id: null, relation: 'master' });
  // The writer on the ready song is the producer themself, so they can acknowledge their own split line.
  await rest(request, 'POST', 'parties', {
    id: PARTY, org_id: ORG, kind: 'person', display_name: `Nova ${run}`, legal_name: `Nova Okafor ${run}`, ipi: null, contact_id: NOVA, user_id: PRODUCER_ID, pro_affiliation: 'not_affiliated',
  });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

const releasePayload = (title: string, contact: string, extra: Record<string, unknown> = {}) => ({ title, contact_id: contact, type: 'single', ...extra });

test('1 · the releases exist: a half-finished single, a fully-specified one, and Kilo’s', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const blocked = await ctx.request.post(`${api}/releases`, { data: releasePayload(`Blocked Single ${run}`, NOVA) });
  expect(blocked.status(), await blocked.text()).toBe(201);
  ids.blocked = (await blocked.json()).release.id;
  const ready = await ctx.request.post(`${api}/releases`, {
    data: releasePayload(`Ready Single ${run}`, NOVA, {
      upc: '036000291452', label_name: 'Board Records', p_line: '℗ 2026 Board Records', c_line: '© 2026 Board Records', primary_genre: 'Alt', target_date: '2026-12-01',
    }),
  });
  expect(ready.status(), await ready.text()).toBe(201);
  const view = (await ready.json()).release;
  ids.ready = view.id;
  ids.readyProject = view.projectId;
  const kilo = await ctx.request.post(`${api}/releases`, { data: releasePayload(`Kilo Single ${run}`, KILO) });
  expect(kilo.status(), await kilo.text()).toBe(201);
  ids.kilo = (await kilo.json()).release.id;
  await ctx.close();
});

test('2 · the board: a gate strip per release, derived — and a Releases entry in the nav', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases`);
  const board = page.getByTestId('release-board');
  await expect(board).toBeVisible({ timeout: 90_000 });

  const row = page.getByTestId(`release-row-${ids.blocked}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('release-gate-strip')).toBeVisible();
  await expect(row.locator('[data-gate]')).toHaveCount(7);
  // No tracks, no artwork, no metadata: those gates are not satisfied.
  await expect(row.locator('[data-gate="tracklist"]')).toHaveAttribute('data-status', 'blocked');
  await expect(row.locator('[data-gate="artwork"]')).toHaveAttribute('data-status', 'blocked');
  await expect(row.locator('[data-gate="metadata"]')).toHaveAttribute('data-status', 'blocked');
  await expect(row).toHaveAttribute('data-stage', 'in_progress');
  // Kilo's release is on the board for the owner too.
  await expect(page.getByTestId(`release-row-${ids.kilo}`)).toBeVisible();

  // The filter narrows the list and lives in the URL; nothing can be dragged to a stage.
  await page.getByTestId('release-filter-ready').click();
  await expect(page.getByTestId('release-board-empty')).toBeVisible();
  expect(page.url()).toContain('state=ready');
  await page.getByTestId('release-filter-all').click();
  await expect(row).toBeVisible();
  expect(await page.locator('[draggable="true"]').count()).toBe(0);

  await row.getByTestId('release-row-link').click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/releases/${ids.blocked}$`));
  await ctx.close();
});

test('3 · the tracklist on the page: add, move with the buttons and with a position, remove — positions stay 1..n', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.blocked}`);
  await expect(page.getByTestId('release-detail')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('release-tracklist-empty')).toBeVisible();

  const add = async (title: string) => {
    await page.getByRole('button', { name: 'Song to add' }).click();
    await page.getByRole('option', { name: title }).click();
    await page.getByRole('button', { name: 'Add to tracklist' }).click();
    // The list item itself — the dropdown's own label shows the chosen title before anything is added.
    await expect(page.locator('[data-testid^="release-item-"]').filter({ hasText: title })).toBeVisible({ timeout: 30_000 });
  };
  await add('Alpha');
  await add('Bravo');
  await add('Charlie');
  const order = async () => {
    const rows = (await rest(request, 'GET', `release_items?select=position,song_track_id&release_id=eq.${ids.blocked}&order=position`)) as { position: number; song_track_id: string }[];
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i + 1));
    return rows.map((r) => r.song_track_id);
  };
  expect(await order()).toEqual([SONG_A, SONG_B, SONG_C]);

  await page.getByLabel('Move Charlie up').click();
  await expect.poll(order).toEqual([SONG_A, SONG_C, SONG_B]);

  const position = page.getByLabel('Position of Bravo');
  await position.fill('1');
  await position.blur();
  await expect.poll(order).toEqual([SONG_B, SONG_A, SONG_C]);

  await page.getByLabel('Remove Alpha').click();
  await expect.poll(order).toEqual([SONG_B, SONG_C]);
  // The tracklist gate now reads satisfied on the page.
  await expect(page.getByTestId('release-gate-tracklist')).toHaveAttribute('data-status', 'satisfied');
  await ctx.close();
});

test('4 · gates name their blockers; a member without rights.read is told how many are withheld, and cannot edit', async ({ browser, baseURL }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const page = await owner.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.blocked}`);
  await expect(page.getByTestId('release-gate-open-metadata')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('release-gate-open-metadata').click();
  await expect(page.getByTestId('release-gate-popover-metadata')).toContainText('The UPC is missing.');
  await page.keyboard.press('Escape');
  await page.getByTestId('release-gate-open-credits_splits').click();
  // The owner has rights.read: the rights detail is named.
  await expect(page.getByTestId('release-gate-popover-credits_splits')).toContainText('Track 1');
  // LABEL-34: release.write sees the export buttons (and the rights note) in the actions area.
  await expect(page.getByTestId('release-actions').getByRole('button', { name: 'Download CSV' })).toBeVisible();
  await expect(page.getByTestId('release-actions')).toContainText('Credits are included only if you have rights access.');
  await owner.close();

  const mk = await as(browser, baseURL!, marketing.id, marketing.email);
  const view = await mk.newPage();
  await view.goto(`/o/${SLUG}/releases/${ids.blocked}`);
  await expect(view.getByTestId('release-detail')).toBeVisible({ timeout: 90_000 });
  await expect(view.getByTestId('release-gate-chip-credits_splits')).toBeVisible();
  await view.getByTestId('release-gate-open-credits_splits').click().catch(() => undefined);
  await expect(view.getByTestId('release-gate-withheld')).toBeVisible();
  await expect(view.getByTestId('release-gate-popover-credits_splits')).not.toContainText('Track 1');
  // Read-only: no tracklist controls, no delivery button.
  await expect(view.getByLabel('Remove Bravo')).toHaveCount(0);
  await expect(view.getByTestId('release-deliver')).toHaveCount(0);
  // LABEL-34: no export buttons or calendar link without release.write, and the route agrees.
  await expect(view.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Calendar link' })).toHaveCount(0);
  expect((await mk.request.get(`${api}/releases/${ids.blocked}/export?format=csv`)).status()).toBe(403);
  expect((await mk.request.post(`${api}/releases/${ids.blocked}/deliver`, { data: { distributor: 'x' } })).status()).toBe(403);
  await mk.close();
});

test('5 · ACCEPTANCE: a blocked release is refused; an override needs an owner and a note', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const deliver = `${api}/releases/${ids.blocked}/deliver`;

  const refused = await owner.request.post(deliver, { data: { distributor: 'DistroKid' } });
  expect(refused.status()).toBe(422);
  const body = await refused.json();
  expect(body.readiness.readyToDeliver).toBe(false);
  expect(body.readiness.gates.artwork.status).toBe('blocked');

  // Without a note → 400, naming the field.
  for (const data of [{ distributor: 'DistroKid', override: true }, { distributor: 'DistroKid', override: true, override_note: '   ' }]) {
    const res = await owner.request.post(deliver, { data });
    expect(res.status()).toBe(400);
    expect((await res.json()).field).toBe('override_note');
  }
  // A non-owner (A&R holds release.write) cannot override at all.
  const nonOwner = await as(browser, baseURL!, aAndR.id, aAndR.email);
  const forbidden = await nonOwner.request.post(deliver, { data: { distributor: 'DistroKid', override: true, override_note: 'please' } });
  expect(forbidden.status()).toBe(403);
  expect((await nonOwner.request.post(deliver, { data: { distributor: 'DistroKid' } })).status()).toBe(422);

  const [row] = (await rest(request, 'GET', `releases?select=state,delivered_at,delivered_to&id=eq.${ids.blocked}`)) as Record<string, unknown>[];
  expect(row).toEqual({ state: 'draft', delivered_at: null, delivered_to: null });
  expect(await deliveredEvents(request, ids.blocked)).toEqual([]);
  await owner.close();
  await nonOwner.close();
});

test('6 · the ready release: gates are satisfied through the real routes (credits, splits, samples, approvals, artwork)', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const a = ctx.request;
  const ok = async (res: Awaited<ReturnType<APIRequestContext['post']>>, what: string, ...statuses: number[]) => {
    expect(statuses.length ? statuses : [200, 201], `${what}: ${res.status()} ${await res.text()}`).toContain(res.status());
    return res;
  };

  // Tracklist: the song, released as its master.
  await ok(await a.post(`${api}/releases/${ids.ready}/items`, { data: { song_track_id: READY_SONG, master_track_id: READY_MASTER } }), 'add item');
  // Artwork, through the real file route: a cover that is too small blocks the gate (09 §4 size rule), a 3000 px square one satisfies it.
  const upload = async (size: number, name: string) => {
    const res = await a.post(`${api}/projects/${ids.readyProject}/assets`, {
      multipart: { file: { name, mimeType: 'image/png', buffer: solidPng(size) }, kind: 'artwork' },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).asset.id as string;
  };
  const small = await upload(1000, 'cover-small.png');
  await ok(await a.patch(`${api}/releases/${ids.ready}`, { data: { artwork_asset_id: small } }), 'small artwork');
  const tooSmall = await (await a.get(`${api}/releases/${ids.ready}/readiness`)).json();
  expect(tooSmall.readiness.gates.artwork.blockers.map((b: { code: string; message: string }) => b.code)).toEqual(['artwork_too_small']);
  expect(tooSmall.readiness.gates.artwork.blockers[0].message).toContain('1000×1000');
  const art = await upload(3000, 'cover.png');
  await ok(await a.patch(`${api}/releases/${ids.ready}`, { data: { artwork_asset_id: art } }), 'artwork');

  // Legal readiness of the song: a writer with a legal name, samples declared, both splits in force and signed.
  const song = `${api}/tracks/${READY_SONG}`;
  await ok(await a.post(`${song}/credits`, { data: { role: 'songwriter', party_id: PARTY } }), 'credit');
  await ok(await a.put(`${song}/samples`, { data: { samples: 'none' } }), 'samples');
  for (const [kind, role] of [['composition', 'writer'], ['master', 'master_owner']] as const) {
    const made = await ok(await a.post(`${song}/splits`, { data: { kind, lines: [{ party_id: PARTY, role, share: '100' }] } }), `${kind} sheet`);
    const sheet = (await made.json()).sheet as { id: string; lines: { id: string }[] };
    await ok(await a.post(`${song}/splits/${sheet.id}/circulate`), `${kind} circulate`);
    await ok(await a.post(`${song}/splits/${sheet.id}/signatures`, { data: { method: 'acknowledged', line_id: sheet.lines[0].id } }), `${kind} sign`);
  }

  // The five release gates that need a person, decided ON THE PAGE (no service key, no direct route calls).
  // Master, artwork, legal and metadata: the owner asks themselves (owner/admin may), then approves.
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.ready}`);
  for (const gate of ['master', 'artwork', 'legal', 'metadata']) {
    const row = page.getByTestId(`org-approval-${gate}`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByTestId('org-approval-ask').click();
    await row.getByRole('button', { name: 'Who should approve' }).click();
    await page.getByRole('option').first().click();
    await row.getByTestId('org-approval-send-request').click();
    await expect(row.getByTestId('org-approval-pending')).toBeVisible({ timeout: 30_000 });
    const approve = row.getByTestId('org-approval-approve');
    await expect(approve).toBeEnabled({ timeout: 30_000 });
    await approve.click();
    await expect(row.getByTestId(`org-approval-chip-${gate}`)).toHaveText('Approved', { timeout: 30_000 });
  }
  await page.screenshot({ path: `${shots}/release-approvals-owner-1440.png`, fullPage: true });
  await page.close();

  // Marketing is decided by the marketing member, who may approve only a request addressed to them (doc 21 #15):
  // the A&R lead asks on the page, and until then the marketing member's Approve is disabled with the reason.
  const mkt = await as(browser, baseURL!, marketing.id, marketing.email);
  const mp = await mkt.newPage();
  await mp.goto(`/o/${SLUG}/releases/${ids.ready}`);
  const mrow = mp.getByTestId('org-approval-marketing');
  await expect(mrow).toBeVisible({ timeout: 60_000 });
  await expect(mrow.getByTestId('org-approval-approve')).toBeDisabled();
  await expect(mrow.getByTestId('org-approval-blocked')).toContainText('request addressed to you');
  await mp.screenshot({ path: `${shots}/release-approvals-marketing-no-request-1440.png`, fullPage: true });

  const lead = await as(browser, baseURL!, aAndR.id, aAndR.email);
  const lp = await lead.newPage();
  await lp.goto(`/o/${SLUG}/releases/${ids.ready}`);
  const lrow = lp.getByTestId('org-approval-marketing');
  await expect(lrow).toBeVisible({ timeout: 60_000 });
  // A&R holds no approval ability: asks, cannot decide.
  await expect(lrow.getByTestId('org-approval-approve')).toHaveCount(0);
  await lrow.getByTestId('org-approval-ask').click();
  await lrow.getByRole('button', { name: 'Who should approve' }).click();
  await lp.getByRole('option').first().click();
  await lrow.getByTestId('org-approval-send-request').click();
  await expect(lrow.getByTestId('org-approval-pending')).toBeVisible({ timeout: 30_000 });

  await mp.reload();
  const mapprove = mp.getByTestId('org-approval-marketing').getByTestId('org-approval-approve');
  await expect(mapprove).toBeEnabled({ timeout: 60_000 });
  await mapprove.click();
  await expect(mp.getByTestId('org-approval-chip-marketing')).toHaveText('Approved', { timeout: 30_000 });
  await mp.screenshot({ path: `${shots}/release-approvals-marketing-approved-1440.png`, fullPage: true });
  await mkt.close();
  await lead.close();

  const view = await (await a.get(`${api}/releases/${ids.ready}/readiness`)).json();
  const open = Object.entries(view.readiness.gates as Record<string, { status: string; blockers: { message: string }[] }>).filter(([, g]) => !['approved', 'satisfied', 'not_required'].includes(g.status));
  expect(open.map(([g, s]) => `${g}: ${s.status} ${s.blockers.map((b) => b.message).join('; ')}`)).toEqual([]);
  expect(view.readiness.readyToDeliver).toBe(true);
  await ctx.close();
});

test('7 · ACCEPTANCE: a release goes from draft to delivered — on the page, by a non-owner, with one audit event', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, aAndR.id, aAndR.email);
  const page = await ctx.newPage();

  // The board shows it as ready, ahead of the others.
  await page.goto(`/o/${SLUG}/releases`);
  const row = page.getByTestId(`release-row-${ids.ready}`);
  await expect(row).toHaveAttribute('data-stage', 'ready', { timeout: 90_000 });
  await page.getByTestId('release-filter-ready').click();
  await expect(page.getByTestId(`release-row-${ids.blocked}`)).toHaveCount(0);

  await row.getByTestId('release-row-link').click();
  await expect(page.getByTestId('release-delivery-readiness')).toHaveText('Every gate is satisfied.');
  // No override control for a member who is not an owner; the button waits for a distributor.
  await expect(page.getByTestId('release-override')).toHaveCount(0);
  await expect(page.getByTestId('release-deliver')).toBeDisabled();
  await page.getByTestId('release-distributor').fill('DistroKid');
  await page.getByTestId('release-delivered-on').fill('2026-10-12');
  await page.getByTestId('release-deliver').click();

  await expect(page.getByTestId('release-delivered')).toContainText('Delivered to DistroKid', { timeout: 30_000 });
  await expect(page.getByTestId('release-state')).toContainText('Delivered');
  await expect(page.getByLabel('Remove Ready Song')).toHaveCount(0);

  const [rel] = (await rest(request, 'GET', `releases?select=state,delivered_to,delivered_at&id=eq.${ids.ready}`)) as { state: string; delivered_to: string; delivered_at: string }[];
  expect(rel).toMatchObject({ state: 'delivered', delivered_to: 'DistroKid' });
  expect(rel.delivered_at.startsWith('2026-10-12')).toBe(true);
  const events = await deliveredEvents(request, ids.ready);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ audit: true, visibility: 'artist', actor_id: ARTIST_A_ID });
  expect(events[0].payload).toMatchObject({ distributor: 'DistroKid', override: false });

  // A second delivery is a 409 and writes no second event; the tracklist is locked.
  const again = await ctx.request.post(`${api}/releases/${ids.ready}/deliver`, { data: { distributor: 'Believe' } });
  expect(again.status()).toBe(409);
  expect(await deliveredEvents(request, ids.ready)).toHaveLength(1);
  expect((await ctx.request.post(`${api}/releases/${ids.ready}/items`, { data: { song_track_id: SONG_A } })).status()).toBe(409);

  // …and the board files it under Delivered.
  await page.goto(`/o/${SLUG}/releases?state=delivered`);
  await expect(page.getByTestId(`release-row-${ids.ready}`)).toContainText('Delivered to DistroKid', { timeout: 60_000 });
  await ctx.close();
});

test('8 · an owner delivers the blocked release anyway, with a note: the page asks for it, the event is internal and keeps the note', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.blocked}`);
  await expect(page.getByTestId('release-delivery-readiness')).toContainText('still open', { timeout: 90_000 });
  await page.getByTestId('release-distributor').fill('Believe');
  await expect(page.getByTestId('release-deliver')).toBeDisabled();
  await page.getByTestId('release-override').check();
  await expect(page.getByTestId('release-deliver')).toHaveText('Deliver anyway');
  await expect(page.getByTestId('release-deliver')).toBeDisabled(); // no reason yet
  await page.getByTestId('release-override-note').fill('Label approved the masters by email; paperwork follows.');
  await page.getByTestId('release-deliver').click();

  await expect(page.getByTestId('release-delivered')).toContainText('Delivered to Believe', { timeout: 30_000 });
  const events = await deliveredEvents(request, ids.blocked);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ audit: true, visibility: 'internal', actor_id: PRODUCER_ID });
  expect(events[0].payload).toMatchObject({ distributor: 'Believe', override: true, overrideNote: 'Label approved the masters by email; paperwork follows.' });
  expect(events[0].payload.openGates).toEqual(expect.arrayContaining(['artwork', 'metadata']));
  // A delivered release does not go back to draft or to cancelled through the API.
  expect((await ctx.request.patch(`${api}/releases/${ids.blocked}`, { data: { state: 'cancelled' } })).status()).toBe(409);
  await ctx.close();
});

test('9 · artist scope: a member limited to Kilo sees only Kilo’s release; Nova’s is a 404 on the page and on deliver', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, scoped.id, scoped.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases`);
  await expect(page.getByTestId(`release-row-${ids.kilo}`)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId(`release-row-${ids.ready}`)).toHaveCount(0);
  await expect(page.getByTestId(`release-row-${ids.blocked}`)).toHaveCount(0);

  const res = await page.goto(`/o/${SLUG}/releases/${ids.ready}`);
  expect(res?.status()).toBe(404);
  expect((await ctx.request.post(`${api}/releases/${ids.ready}/deliver`, { data: { distributor: 'x' } })).status()).toBe(404);
  expect((await ctx.request.get(`${api}/releases/${ids.ready}/readiness`)).status()).toBe(404);

  // Kilo's own release opens (no gates satisfied, so it stays a draft).
  await page.goto(`/o/${SLUG}/releases/${ids.kilo}`);
  await expect(page.getByTestId('release-detail')).toBeVisible({ timeout: 60_000 });
  const [kilo] = (await rest(request, 'GET', `releases?select=state&id=eq.${ids.kilo}`)) as { state: string }[];
  expect(kilo.state).toBe('draft');
  await ctx.close();
});

test('10 · doc 21 #13: a song on a release has no Approve of its own — the song page says legal is approved on the release (1440 and 390 px)', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${READY_SONG}`);
  const row = page.getByTestId('org-approval-legal');
  await expect(row).toBeVisible({ timeout: 90_000 });
  await expect(row.getByTestId('org-approval-on-release')).toContainText('Legal is approved on the release');
  await expect(row.getByTestId('org-approval-approve')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/song-legal-on-release-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('org-approval-legal').getByTestId('org-approval-on-release')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${shots}/song-legal-on-release-390.png`, fullPage: true });

  // A draft release page at a phone width: the five gates and their controls stay usable (the ready and blocked ones are delivered by now).
  await page.goto(`/o/${SLUG}/releases/${ids.kilo}`);
  await expect(page.getByTestId('org-approvals')).toBeVisible({ timeout: 60_000 });
  for (const g of ['master', 'artwork', 'legal', 'marketing', 'metadata']) await expect(page.getByTestId(`org-approval-${g}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${shots}/release-approvals-owner-390.png`, fullPage: true });
  await ctx.close();
});
