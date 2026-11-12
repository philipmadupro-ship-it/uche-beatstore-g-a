/**
 * Org uploads (LABEL-14) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true). What
 * mocks cannot prove: migration 141's service-only trigger and 142's
 * project_tracks trigger accept exactly the rows the routes write, the Inbox
 * is created once and reused, the uploads tray really drives the org routes,
 * and the producer's own upload path is untouched.
 *
 * The producer owns a label with artists Nova and Kilo; the seed BUYER is an
 * A&R member limited to Kilo. Without R2 there is no private bucket, so an
 * org track gets no preview at all — never a public one.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `uploads-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

/** Without R2 a master lands in public/uploads/; a run must not leave any behind. */
function removeLocalUpload(url: unknown) {
  if (typeof url !== 'string' || !/^\/uploads\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(url)) return;
  fs.rmSync(path.join(process.cwd(), 'public', url), { force: true });
}

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
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

/** init → proxied part(s) → complete, through whichever upload API root. */
async function uploadVia(api: APIRequestContext, root: string, name: string, bytes: Buffer, extra: Record<string, unknown>) {
  const init = await api.post(`${root}/init`, { data: { fileName: name, fileSize: bytes.length, fileType: 'audio/wav', ...extra } });
  expect(init.status(), await init.text()).toBe(200);
  const { sessionId, partSize, totalParts } = await init.json();
  for (let p = 1; p <= totalParts; p++) {
    const chunk = bytes.subarray((p - 1) * partSize, Math.min(bytes.length, p * partSize));
    const put = await api.put(`${root}/part`, { headers: { 'x-session-id': sessionId, 'x-part-number': String(p), 'content-type': 'application/octet-stream' }, data: chunk });
    expect(put.status(), await put.text()).toBe(200);
  }
  const done = await api.post(`${root}/complete`, { data: { sessionId, ...('as' in extra ? { as: extra.as } : {}) } });
  return done;
}

async function inboxSongs(request: APIRequestContext, contactId: string) {
  const inboxes = (await rest(request, 'GET', `projects?select=id,org_id,name&inbox_for_contact_id=eq.${contactId}`)) as { id: string; org_id: string; name: string }[];
  if (inboxes.length === 0) return { inboxes, songs: [] as Record<string, unknown>[] };
  const links = (await rest(request, 'GET', `project_tracks?select=track_id&project_id=eq.${inboxes[0].id}`)) as { track_id: string }[];
  const ids = links.map((l) => l.track_id);
  const songs = ids.length
    ? ((await rest(request, 'GET', `tracks?select=id,title,org_id,type,song_stage,user_id,created_by,preview_url,peaks_url&id=in.(${ids.join(',')})`)) as Record<string, unknown>[])
    : [];
  return { inboxes, songs };
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Upload Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'contacts', { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: BUYER_ID, contact_id: KILO });
});

test.afterAll(async ({ request }) => {
  const rows = (await rest(request, 'GET', `tracks?select=audio_url&org_id=eq.${ORG}`)) as { audio_url: string | null }[];
  for (const r of rows) removeLocalUpload(r.audio_url);
  // Org tracks / projects go with the org (FK cascade), their links and project rows with them.
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
});

test('1 · the uploads tray: 3 files → 3 songs in the artist\'s Inbox, private (no public preview)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/artists`);
  const panel = page.getByRole('region', { name: 'Upload audio' });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('button', { name: 'Artist' }).click();
  await page.getByRole('option', { name: `Nova ${run}` }).click();
  await panel.getByTestId('org-upload-input').setInputFiles([
    { name: `First ${run} 140 Fm.wav`, mimeType: 'audio/wav', buffer: wav(220) },
    { name: `Second ${run}.wav`, mimeType: 'audio/wav', buffer: wav(330) },
    { name: `Third ${run}.wav`, mimeType: 'audio/wav', buffer: wav(440) },
  ]);
  await expect(panel).toContainText('3 files added to the uploads tray.');

  await expect.poll(async () => (await inboxSongs(ctx.request, NOVA)).songs.length, { timeout: 60_000 }).toBe(3);
  const { inboxes, songs } = await inboxSongs(ctx.request, NOVA);
  expect(inboxes).toEqual([{ id: inboxes[0].id, org_id: ORG, name: `Inbox · Nova ${run}` }]);
  for (const s of songs) {
    // No owner (142): the uploader is created_by only, so the producer's own routes never see it.
    expect(s).toMatchObject({ org_id: ORG, type: 'song', song_stage: 'inbox', user_id: null, created_by: PRODUCER_ID });
  }
  expect(songs.map((s) => s.title).sort()).toEqual([`First ${run}`, `Second ${run}`, `Third ${run}`]);

  // Each song queued its processing job. With no private bucket the job
  // can only ever leave the preview and peaks empty — never public. (The
  // local PostgREST refuses the job claim's PATCH with `or=`, so the job does
  // not run here; src/lib/upload/processing-org.test.ts covers where it writes.)
  const ids = songs.map((s) => s.id as string);
  const jobs = (await rest(ctx.request, 'GET', `upload_processing_jobs?select=track_id,user_id&track_id=in.(${ids.join(',')})`)) as { track_id: string; user_id: string }[];
  expect(jobs.map((j) => j.track_id).sort()).toEqual([...ids].sort());
  for (const j of jobs) expect(j.user_id).toBe(PRODUCER_ID);
  const after = (await rest(ctx.request, 'GET', `tracks?select=preview_url,peaks_url&id=in.(${ids.join(',')})`)) as { preview_url: string | null; peaks_url: string | null }[];
  for (const t of after) expect(t).toEqual({ preview_url: null, peaks_url: null });

  // The tray's in-place editors (producer routes) are not offered for org rows.
  await expect(page.getByRole('button', { name: /Rename/i })).toHaveCount(0);
  await ctx.close();
});

test('2 · material: a master added to a song is linked, in the song\'s Inbox, and plays through the org audio route', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const api = ctx.request;
  const { inboxes, songs } = await inboxSongs(api, NOVA);
  const song = songs.find((s) => s.title === `First ${run}`)!;

  const targets = await (await api.get(`/api/org/${ORG}/upload/targets?contactId=${NOVA}`)).json();
  expect(targets.songs.map((s: { id: string }) => s.id).sort()).toEqual(songs.map((s) => s.id).sort());

  const done = await uploadVia(api, `/api/org/${ORG}/upload`, `First ${run} master.wav`, wav(220), { as: { kind: 'link', songId: song.id, relation: 'master' } });
  expect(done.status(), await done.text()).toBe(200);
  const { track } = await done.json();
  expect(JSON.stringify(track)).not.toMatch(/\/uploads\/|r2:\/\//);
  expect(track).toMatchObject({ orgId: ORG, type: 'song', songStage: null, linkedTo: { songId: song.id, relation: 'master' }, projectIds: [inboxes[0].id] });

  const link = (await rest(api, 'GET', `track_links?select=from_track_id,relation&to_track_id=eq.${track.id}`)) as unknown[];
  expect(link).toEqual([{ from_track_id: song.id, relation: 'master' }]);
  const placed = (await rest(api, 'GET', `project_tracks?select=project_id&track_id=eq.${track.id}`)) as unknown[];
  expect(placed).toEqual([{ project_id: inboxes[0].id }]);

  // The master is not a song: the "add to song" list is unchanged.
  const again = await (await api.get(`/api/org/${ORG}/upload/targets?contactId=${NOVA}`)).json();
  expect(again.songs).toHaveLength(3);

  const audio = await api.get(`/api/org/${ORG}/audio/${track.id}?variant=full`);
  expect(audio.status()).toBe(200);
  expect((await audio.body()).subarray(0, 4).toString('latin1')).toBe('RIFF');
  await ctx.close();
});

test('3 · scope: a member limited to Kilo cannot upload for Nova or see her songs, and can for Kilo', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  const api = ctx.request;
  expect((await api.post(`/api/org/${ORG}/upload/init`, { data: { fileName: 'x.wav', fileSize: 10, as: { kind: 'song', contactId: NOVA } } })).status()).toBe(404);
  expect((await api.get(`/api/org/${ORG}/upload/targets?contactId=${NOVA}`)).status()).toBe(404);

  const done = await uploadVia(api, `/api/org/${ORG}/upload`, `Kilo demo ${run}.wav`, wav(550), { as: { kind: 'song', contactId: KILO } });
  expect(done.status(), await done.text()).toBe(200);
  const { songs } = await inboxSongs(request, KILO);
  expect(songs.map((s) => s.title)).toEqual([`Kilo demo ${run}`]);

  // Through PostgREST with their own JWT, Nova's songs stay invisible (141's policies).
  const novaIds = (await inboxSongs(request, NOVA)).songs.map((s) => s.id);
  const res = await request.get(`${REST}/tracks?select=id&id=in.(${novaIds.join(',')})`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
  });
  expect(await res.json()).toEqual([]);
  await ctx.close();
});

test('4 · the producer\'s own upload path is unchanged: a producer track, no org, its job queued as before', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const done = await uploadVia(ctx.request, '/api/upload', `Producer beat ${run}.wav`, wav(660), { trackType: 'beat' });
  expect(done.status(), await done.text()).toBe(200);
  const { track } = await done.json();
  // The producer route still answers its own row, as it always has.
  expect(track).toMatchObject({ type: 'beat', user_id: PRODUCER_ID, org_id: null });
  expect(String(track.audio_url)).toMatch(/^\/uploads\//);
  const jobs = (await rest(request, 'GET', `upload_processing_jobs?select=user_id&track_id=eq.${track.id}`)) as unknown[];
  expect(jobs).toEqual([{ user_id: PRODUCER_ID }]);
  await rest(request, 'DELETE', `tracks?id=eq.${track.id}`);
  removeLocalUpload(track.audio_url);
  await ctx.close();
});
