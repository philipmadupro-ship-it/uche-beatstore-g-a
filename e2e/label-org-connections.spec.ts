/**
 * The artist ↔ label connection (LABEL-41, D1, D6) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true from env.sh), migration 154
 * included, with FOUR accounts and TWO label orgs:
 *
 *   PRODUCER  owner of the label "Night Shift" (hears everything shared with it)
 *   BUYER     a MARKETING member of Night Shift (finished recordings only)
 *   ARTIST_A  owner of the ARTIST org "Nova"
 *   ARTIST_B  an A&R of Night Shift limited to ANOTHER roster artist, and the
 *             owner of a second label with no connection to Nova
 *
 * The label asks Nova by slug; Nova's owner accepts and — only then — chooses
 * what to share; the label hears the shared demo, marketing only the finished
 * song, a limited member nothing, another label nothing. Nova allows copies;
 * the label copies a beat with provenance and the source is unchanged. What
 * mocks cannot prove: the real RLS (a label member's own JWT reads NOTHING of
 * the artist org), 154's functions and triggers, the audit rows in both orgs,
 * and that ending the connection cuts the very next request.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, ARTIST_A_ID, ARTIST_B_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const LAB = randomUUID();
const LAB2 = randomUUID();
const ART = randomUUID();
const LAB_SLUG = `night-shift-${run}`;
const ART_SLUG = `nova-${run}`;
const ART_NAME = `Nova ${run}`;
const OTHER_ROSTER = randomUUID(); // a LAB roster artist that ARTIST_B is limited to
const AP1 = randomUUID(); // shared
const AP2 = randomUUID(); // never shared
const T_FIN = randomUUID(); // a selected song: finished
const T_DEMO = randomUUID(); // a demo: working
const T_BEAT = randomUUID(); // a beat: copyable
const T_HID = randomUUID(); // in AP2
const FIN_TITLE = `Finished ${run}`;
const DEMO_TITLE = `Demo ${run}`;
const BEAT_TITLE = `Beat ${run}`;
const HID_TITLE = `Hidden ${run}`;

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

/** A PostgREST read with the person's OWN JWT: row level security decides, not the app. */
async function asUser(request: APIRequestContext, id: string, email: string, p: string, init: { method?: string; body?: unknown } = {}) {
  const res = await request.fetch(`${REST}/${p}`, {
    method: init.method ?? 'GET',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(id, email)}`, 'content-type': 'application/json' },
    data: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status(), json: (await res.json().catch(() => null)) as unknown };
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

function wav(freq: number): Buffer {
  const rate = 22050;
  const n = rate * 2;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  return buf;
}

const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
const localFile = (id: string) => `labelos-e2e-conn-${run}-${id}.wav`;
// An org's files live under its own prefix (the copy route refuses anything else); the preview clip is a
// different file so a test can tell which one was streamed.
const masterDir = () => path.join(uploadsDir, 'orgs', ART, 'tracks');
const previewDir = () => path.join(uploadsDir, 'orgs', ART, 'previews');
const masterUrl = (id: string) => `/uploads/orgs/${ART}/tracks/${localFile(id)}`;
const previewUrl = (id: string) => `/uploads/orgs/${ART}/previews/${localFile(id)}`;
const FREQ: Record<string, number> = {};

type Event = { org_id: string; verb: string; audit: boolean };
const events = async (request: APIRequestContext, verb: string) =>
  (await rest(request, 'GET', `activity_events?select=org_id,verb,audit&verb=eq.${verb}&org_id=in.(${LAB},${ART})`)) as Event[];

let connectionId = '';
let rosterContactId = '';

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const files = [T_FIN, T_DEMO, T_BEAT, T_HID];
  fs.mkdirSync(masterDir(), { recursive: true });
  fs.mkdirSync(previewDir(), { recursive: true });
  files.forEach((t, i) => {
    FREQ[t] = 220 + i * 55;
    fs.writeFileSync(path.join(masterDir(), localFile(t)), wav(FREQ[t]));
    fs.writeFileSync(path.join(previewDir(), localFile(t)), wav(FREQ[t] + 7));
  });

  await rest(request, 'POST', 'organizations', [
    { id: LAB, name: `Night Shift ${run}`, slug: LAB_SLUG, kind: 'label', created_by: PRODUCER_ID },
    { id: LAB2, name: `Other Label ${run}`, slug: `other-${run}`, kind: 'label', created_by: ARTIST_B_ID },
    { id: ART, name: ART_NAME, slug: ART_SLUG, kind: 'artist', created_by: ARTIST_A_ID },
  ]);
  await rest(request, 'POST', 'org_members', [
    { org_id: LAB, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org' },
    { org_id: LAB, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org' },
    { org_id: LAB, user_id: ARTIST_B_ID, role: 'member', functions: ['a_and_r'], scope: 'artists' },
    { org_id: LAB2, user_id: ARTIST_B_ID, role: 'owner', functions: [], scope: 'org' },
    { org_id: ART, user_id: ARTIST_A_ID, role: 'owner', functions: [], scope: 'org' },
  ]);
  await rest(request, 'POST', 'contacts', { id: OTHER_ROSTER, org_id: LAB, user_id: null, name: `Someone Else ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: LAB, user_id: ARTIST_B_ID, contact_id: OTHER_ROSTER });
  await rest(request, 'POST', 'projects', [
    { id: AP1, org_id: ART, user_id: null, name: `Nova demos ${run}` },
    { id: AP2, org_id: ART, user_id: null, name: `Nova private ${run}` },
  ]);
  const track = (id: string, title: string, extra: Record<string, unknown>) => ({
    id, org_id: ART, user_id: null, created_by: ARTIST_A_ID, title, bpm: 140, key: 'F', scale: 'minor', audio_url: masterUrl(id), preview_url: previewUrl(id), ...extra,
  });
  await rest(request, 'POST', 'tracks', [
    track(T_FIN, FIN_TITLE, { type: 'song', song_stage: 'selected' }),
    track(T_DEMO, DEMO_TITLE, { type: 'song', song_stage: 'inbox' }),
    track(T_BEAT, BEAT_TITLE, { type: 'beat', song_stage: null }),
    track(T_HID, HID_TITLE, { type: 'song', song_stage: 'selected' }),
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: AP1, track_id: T_FIN, position: 0 },
    { project_id: AP1, track_id: T_DEMO, position: 1 },
    { project_id: AP1, track_id: T_BEAT, position: 2 },
    { project_id: AP2, track_id: T_HID, position: 0 },
  ]);
});

test.afterAll(async ({ request }) => {
  fs.rmSync(path.join(uploadsDir, 'orgs', ART), { recursive: true, force: true });
  fs.rmSync(path.join(uploadsDir, 'orgs', LAB), { recursive: true, force: true });
  // Org projects, tracks, members, connections and events go with the orgs (FK cascade).
  await rest(request, 'DELETE', `organizations?id=in.(${LAB},${LAB2},${ART})`);
});

const audio = (page: Page, org: string, track: string, query = '') => page.request.get(`/api/org/${org}/audio/${track}${query}`);

test('1 · the label asks, the artist accepts — and nothing is shared yet', async ({ browser, baseURL }) => {
  const label = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const lp = await label.newPage();
  await lp.goto(`/o/${LAB_SLUG}/settings/connections`);
  await lp.getByLabel(/slug or an owner/i).fill(ART_SLUG);
  await lp.getByRole('button', { name: /ask to connect/i }).click();
  const row = lp.locator('[data-testid^="connection-"]').first();
  await expect(row).toContainText(ART_NAME, { timeout: 60_000 });
  await expect(row).toContainText('Request sent');

  const rows = (await rest(lp.request, 'GET', `org_connections?select=id,status,initiated_by,share_mode,allow_copies&label_org_id=eq.${LAB}&artist_org_id=eq.${ART}`)) as { id: string; status: string; initiated_by: string; share_mode: string; allow_copies: boolean }[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'requested', initiated_by: 'label', share_mode: 'selected', allow_copies: false });
  connectionId = rows[0].id;

  // A request reads the same whether or not the org exists: probing finds nothing.
  const ghost = await lp.request.post(`/api/org/${LAB}/connections`, { data: { slug: `no-such-org-${run}` } });
  expect(ghost.status()).toBe(202);
  expect(await ghost.json()).toEqual({ requested: true });
  // The starter cannot accept its own request.
  expect((await lp.request.post(`/api/org/${LAB}/connections/${connectionId}/accept`)).status()).toBe(404);

  const artist = await as(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
  const ap = await artist.newPage();
  await ap.goto(`/o/${ART_SLUG}/settings/connections`);
  const arow = ap.getByTestId(`connection-${connectionId}`);
  await expect(arow).toContainText(`Night Shift ${run}`, { timeout: 60_000 });
  await expect(arow).toContainText('Wants to connect');
  await arow.getByRole('button', { name: 'Accept' }).click();
  await expect(arow).toContainText('Connected', { timeout: 30_000 });
  await expect(arow).toContainText('Nothing yet');

  // Accepting created the label's roster contact for the artist org and pointed it at the org.
  const contacts = (await rest(lp.request, 'GET', `contacts?select=id,name,category,artist_org_id&org_id=eq.${LAB}&artist_org_id=eq.${ART}`)) as { id: string; name: string; category: string }[];
  expect(contacts).toHaveLength(1);
  expect(contacts[0]).toMatchObject({ name: ART_NAME, category: 'artist' });
  rosterContactId = contacts[0].id;

  // Connected but not shared: the label reaches nothing of Nova's.
  for (const t of [T_FIN, T_DEMO, T_BEAT]) expect((await audio(lp, LAB, t)).status(), t).toBe(404);

  // Both orgs hold the audit rows, as audit events.
  for (const verb of ['connection.requested', 'connection.accepted']) {
    const rowsFor = await events(lp.request, verb);
    expect(rowsFor.map((e) => e.org_id).sort(), verb).toEqual([LAB, ART].sort());
    expect(rowsFor.every((e) => e.audit)).toBe(true);
  }
  await label.close();
  await artist.close();
});

test('2 · the artist shares one project; the label A&R hears it, marketing only the finished song, others nothing', async ({ browser, baseURL }) => {
  const artist = await as(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
  const ap = await artist.newPage();
  await ap.goto(`/o/${ART_SLUG}/settings/connections`);
  await ap.getByRole('button', { name: 'Sharing' }).click();
  await ap.getByRole('switch', { name: `Nova demos ${run}` }).click();
  await expect(ap.getByTestId(`connection-${connectionId}`)).toContainText('1 project', { timeout: 30_000 });

  const label = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const lp = await label.newPage();
  // The label side cannot change what is shared, whatever it holds.
  expect((await lp.request.patch(`/api/org/${LAB}/connections/${connectionId}`, { data: { share_mode: 'all' } })).status()).toBe(404);
  for (const t of [T_FIN, T_DEMO, T_BEAT]) {
    const res = await audio(lp, LAB, t);
    expect(res.status(), `owner ${t}`).toBe(200);
    expect(res.headers()['content-type']).toMatch(/audio/);
  }
  // Copies are off: what streams is the PREVIEW clip, never the stored master.
  const heard = await (await audio(lp, LAB, T_FIN)).body();
  expect(heard.equals(fs.readFileSync(path.join(previewDir(), localFile(T_FIN))))).toBe(true);
  expect(heard.equals(fs.readFileSync(path.join(masterDir(), localFile(T_FIN))))).toBe(false);
  expect((await audio(lp, LAB, T_HID)).status()).toBe(404); // outside the shared project
  expect((await audio(lp, LAB, T_FIN, '?download=1')).status()).toBe(403); // streams only
  expect((await audio(lp, LAB, T_FIN, '?variant=wav')).status()).toBe(403);

  const marketing = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const mp = await marketing.newPage();
  expect((await audio(mp, LAB, T_FIN)).status()).toBe(200);
  expect((await audio(mp, LAB, T_DEMO)).status()).toBe(403); // D4: finished only
  expect((await audio(mp, LAB, T_BEAT)).status()).toBe(403);

  const limited = await as(browser, baseURL!, ARTIST_B_ID, 'artist-b@local.test');
  const bp = await limited.newPage();
  for (const t of [T_FIN, T_DEMO]) {
    expect((await audio(bp, LAB, t)).status(), `limited ${t}`).toBe(404); // another roster artist's scope
    expect((await audio(bp, LAB2, t)).status(), `other label ${t}`).toBe(404); // another label, no connection
  }
  // Nova's owner reaches nothing of the label through the connection.
  expect((await audio(ap, LAB, T_FIN)).status()).toBe(404);
  expect((await ap.request.get(`/api/org/${LAB}/connections/${connectionId}/projects`)).status()).toBe(403);

  // The connected music page: the owner sees the three shared recordings, marketing only the finished one.
  await lp.goto(`/o/${LAB_SLUG}/connections/${connectionId}`);
  await expect(lp.getByRole('heading', { name: ART_NAME })).toBeVisible({ timeout: 60_000 });
  for (const title of [FIN_TITLE, DEMO_TITLE, BEAT_TITLE]) await expect(lp.getByText(title, { exact: true })).toBeVisible();
  await expect(lp.getByText(HID_TITLE)).toHaveCount(0);
  await mp.goto(`/o/${LAB_SLUG}/connections/${connectionId}`);
  await expect(mp.getByText(FIN_TITLE, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(mp.getByText(DEMO_TITLE)).toHaveCount(0);
  await expect(mp.getByText(BEAT_TITLE)).toHaveCount(0);
  // A limited member gets the same 404 as the API.
  const denied = await bp.goto(`/o/${LAB_SLUG}/connections/${connectionId}`);
  expect(denied?.status()).toBe(404);

  // The roster says Connected, and the artist's page links to the music.
  await lp.goto(`/o/${LAB_SLUG}/artists`);
  await expect(lp.getByTestId(`connected-${rosterContactId}`)).toBeVisible({ timeout: 60_000 });
  await lp.goto(`/o/${LAB_SLUG}/artists/${rosterContactId}`);
  await expect(lp.getByTestId('artist-connected')).toContainText(ART_NAME, { timeout: 60_000 });

  for (const c of [artist, label, marketing, limited]) await c.close();
});

test('3 · the real RLS: a label member’s own JWT reads nothing of the artist org', async ({ request }) => {
  const P = ['producer@local.test', PRODUCER_ID] as const;
  const A = ['artist-a@local.test', ARTIST_A_ID] as const;
  for (const table of ['projects', 'tracks', 'contacts', 'org_members', 'activity_events', 'project_assets', 'project_comments']) {
    const r = await asUser(request, P[1], P[0], `${table}?select=*&org_id=eq.${ART}`);
    expect(r.status, table).toBe(200);
    expect(r.json, `label owner reads ${table} of the artist org`).toEqual([]);
  }
  // …and the artist org’s owner reads nothing of the label’s.
  for (const table of ['projects', 'tracks', 'contacts', 'activity_events']) {
    const r = await asUser(request, A[1], A[0], `${table}?select=*&org_id=eq.${LAB}`);
    expect(r.json, `artist owner reads ${table} of the label`).toEqual([]);
  }
  // The connection is read by the owners / admins of each side; what is shared only by the artist's.
  expect(((await asUser(request, P[1], P[0], 'org_connections?select=id')).json as unknown[]).length).toBe(1);
  expect(((await asUser(request, A[1], A[0], 'org_connections?select=id')).json as unknown[]).length).toBe(1);
  expect(((await asUser(request, P[1], P[0], 'connection_projects?select=project_id')).json as unknown[]).length).toBe(0);
  expect(((await asUser(request, A[1], A[0], 'connection_projects?select=project_id')).json as unknown[]).length).toBe(1);
  expect(((await asUser(request, BUYER_ID, 'buyer@local.test', 'org_connections?select=id')).json as unknown[]).length).toBe(0);
  // No API role writes it.
  const write = await asUser(request, P[1], P[0], `org_connections?id=eq.${connectionId}`, { method: 'PATCH', body: { share_mode: 'all' } });
  expect([401, 403]).toContain(write.status);

  // The SQL twin of the route rule, with each person's own JWT.
  const sees = async (id: string, email: string, project: string) =>
    (await asUser(request, id, email, 'rpc/can_see_via_connection', { method: 'POST', body: { p_project: project } })).json;
  expect(await sees(PRODUCER_ID, 'producer@local.test', AP1)).toBe(true);
  expect(await sees(PRODUCER_ID, 'producer@local.test', AP2)).toBe(false);
  expect(await sees(BUYER_ID, 'buyer@local.test', AP1)).toBe(true); // catalog.read; the audio classes are the route's
  expect(await sees(ARTIST_B_ID, 'artist-b@local.test', AP1)).toBe(false); // scoped to another roster artist
  expect(await sees(ARTIST_A_ID, 'artist-a@local.test', AP1)).toBe(false); // the artist side is not the label
});

test('4 · copies are the artist’s to allow; "Use in a label song" keeps provenance and leaves the source alone', async ({ browser, baseURL }) => {
  const label = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const lp = await label.newPage();
  const before = (await rest(lp.request, 'GET', `tracks?select=id,audio_url,title,provenance&id=eq.${T_BEAT}`)) as { id: string; audio_url: string; title: string; provenance: unknown }[];

  // Off until the artist allows it.
  const refused = await lp.request.post(`/api/org/${LAB}/tracks/copy`, { data: { source: { kind: 'connection', track_id: T_BEAT } } });
  expect(refused.status()).toBe(403);

  const artist = await as(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
  const ap = await artist.newPage();
  await ap.goto(`/o/${ART_SLUG}/settings/connections`);
  await ap.getByRole('button', { name: 'Sharing' }).click();
  await ap.getByRole('switch', { name: 'Let them copy beats into their label' }).click();
  await expect(ap.getByTestId(`connection-${connectionId}`)).toContainText('may copy beats', { timeout: 30_000 });

  // Now that copies are allowed the master itself is what streams.
  expect((await (await audio(lp, LAB, T_FIN)).body()).equals(fs.readFileSync(path.join(masterDir(), localFile(T_FIN))))).toBe(true);

  await lp.goto(`/o/${LAB_SLUG}/connections/${connectionId}`);
  await expect(lp.getByTestId(`connected-recording-${T_BEAT}`)).toBeVisible({ timeout: 60_000 });
  // A song is not copied (only the beat offers it).
  await expect(lp.getByTestId(`connected-recording-${T_FIN}`).getByText('Use in a label song')).toHaveCount(0);
  await lp.getByTestId(`connected-recording-${T_BEAT}`).getByText('Use in a label song').click();
  await expect(lp.getByTestId(`connected-recording-${T_BEAT}`).getByText('Copied')).toBeVisible({ timeout: 60_000 });

  const copies = (await rest(lp.request, 'GET', `tracks?select=id,org_id,user_id,created_by,title,type,audio_url,provenance&org_id=eq.${LAB}&provenance=not.is.null`)) as {
    id: string; org_id: string; user_id: string | null; created_by: string; title: string; type: string; audio_url: string; provenance: Record<string, string>;
  }[];
  expect(copies).toHaveLength(1);
  const copy = copies[0];
  expect(copy).toMatchObject({ org_id: LAB, user_id: null, created_by: PRODUCER_ID, title: BEAT_TITLE, type: 'beat' });
  expect(copy.id).not.toBe(T_BEAT);
  expect(copy.audio_url).not.toBe(before[0].audio_url);
  expect(copy.audio_url).toContain(`/orgs/${LAB}/tracks/`);
  expect(copy.provenance).toMatchObject({ source_org_id: ART, source_track_id: T_BEAT, copied_by: PRODUCER_ID });
  expect(Number.isNaN(Date.parse(copy.provenance.copied_at))).toBe(false);
  // The copy is the label's own file and plays for the label.
  expect((await audio(lp, LAB, copy.id)).status()).toBe(200);

  // The source is exactly as it was, and the artist org gained nothing.
  const after = (await rest(lp.request, 'GET', `tracks?select=id,audio_url,title,provenance&id=eq.${T_BEAT}`)) as typeof before;
  expect(after).toEqual(before);
  expect(((await rest(lp.request, 'GET', `tracks?select=id&org_id=eq.${ART}`)) as unknown[]).length).toBe(4);
  expect(fs.existsSync(path.join(masterDir(), localFile(T_BEAT)))).toBe(true);

  // Provenance never changes, even for the service role.
  const tamper = await lp.request.fetch(`${REST}/tracks?id=eq.${copy.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ provenance: { source_track_id: 'x', copied_at: 'x', copied_by: 'x' } }),
  });
  expect(tamper.ok()).toBe(false);

  // Audit: recorded in the label and in the artist org.
  const copied = (await rest(lp.request, 'GET', `activity_events?select=org_id,verb,audit&verb=eq.recording.copied&org_id=in.(${LAB},${ART})`)) as Event[];
  // The artist sees that their master was copied: the event is in BOTH feeds.
  expect(copied.map((e) => e.org_id).sort()).toEqual([LAB, ART].sort());
  expect(copied.every((e) => e.audit)).toBe(true);

  // Marketing cannot copy; a limited member cannot; the artist org cannot.
  const marketing = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  expect((await marketing.request.post(`/api/org/${LAB}/tracks/copy`, { data: { source: { kind: 'connection', track_id: T_BEAT } } })).status()).toBe(403);
  const limited = await as(browser, baseURL!, ARTIST_B_ID, 'artist-b@local.test');
  expect((await limited.request.post(`/api/org/${LAB}/tracks/copy`, { data: { source: { kind: 'connection', track_id: T_BEAT } } })).status()).toBe(404);
  expect((await ap.request.post(`/api/org/${ART}/tracks/copy`, { data: { source: { kind: 'connection', track_id: T_BEAT } } })).status()).toBe(403);
  for (const c of [label, artist, marketing, limited]) await c.close();
});

test('5 · narrowing what is shared, then ending the connection, cuts the very next request', async ({ browser, baseURL }) => {
  const label = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const lp = await label.newPage();
  const artist = await as(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test');
  const ap = await artist.newPage();

  // Narrow: the artist unshares the project.
  expect((await ap.request.patch(`/api/org/${ART}/connections/${connectionId}`, { data: { project_ids: [] } })).status()).toBe(200);
  expect((await audio(lp, LAB, T_FIN)).status()).toBe(404);
  // …and shares it again.
  expect((await ap.request.patch(`/api/org/${ART}/connections/${connectionId}`, { data: { project_ids: [AP1] } })).status()).toBe(200);
  expect((await audio(lp, LAB, T_FIN)).status()).toBe(200);
  expect((await ap.request.patch(`/api/org/${ART}/connections/${connectionId}`, { data: { project_ids: [randomUUID()] } })).status()).toBe(400);
  expect(((await rest(lp.request, 'GET', `activity_events?select=verb&verb=in.(share.created,share.revoked)&org_id=eq.${ART}`)) as unknown[]).length).toBeGreaterThanOrEqual(3);
  expect(((await rest(lp.request, 'GET', `activity_events?select=verb&verb=in.(share.created,share.revoked)&org_id=eq.${LAB}`)) as unknown[]).length).toBe(0);

  // End it from the artist's page.
  await ap.goto(`/o/${ART_SLUG}/settings/connections`);
  const row = ap.getByTestId(`connection-${connectionId}`);
  await row.getByRole('button', { name: 'End', exact: true }).click();
  await ap.getByRole('button', { name: 'End connection', exact: true }).click();
  await expect(ap.getByText('No connections yet.')).toBeVisible({ timeout: 30_000 });

  // The label’s very next request, by every route, is a 404.
  for (const t of [T_FIN, T_DEMO, T_BEAT]) expect((await audio(lp, LAB, t)).status(), t).toBe(404);
  expect((await lp.request.get(`/api/org/${LAB}/connections/${connectionId}/projects`)).status()).toBe(404);
  expect((await lp.request.post(`/api/org/${LAB}/tracks/copy`, { data: { source: { kind: 'connection', track_id: T_BEAT } } })).status()).toBe(404);
  const gone = await lp.goto(`/o/${LAB_SLUG}/connections/${connectionId}`);
  expect(gone?.status()).toBe(404);
  const contact = (await rest(lp.request, 'GET', `contacts?select=id,artist_org_id&id=eq.${rosterContactId}`)) as { artist_org_id: string | null }[];
  expect(contact[0].artist_org_id).toBeNull(); // the roster contact stays, released
  expect(((await asUser(lp.request, PRODUCER_ID, 'producer@local.test', 'rpc/can_see_via_connection', { method: 'POST', body: { p_project: AP1 } })).json)).toBe(false);

  // What the label copied stays the label's.
  const copies = (await rest(lp.request, 'GET', `tracks?select=id&org_id=eq.${LAB}&provenance=not.is.null`)) as unknown[];
  expect(copies).toHaveLength(1);
  const ended = await events(lp.request, 'connection.ended');
  expect(ended.map((e) => e.org_id).sort()).toEqual([LAB, ART].sort());
  await label.close();
  await artist.close();
});
