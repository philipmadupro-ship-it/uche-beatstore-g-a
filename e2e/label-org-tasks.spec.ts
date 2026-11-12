/**
 * Org tasks + direct-ask notifications (LABEL-23) end to end against a REAL
 * database (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * What mocks cannot prove: migration 151's rows are accepted by the real
 * table (CHECK, integrity trigger, FKs), a notification reaches ONLY its
 * recipient — through the route AND straight from PostgREST with each person's
 * own JWT (RLS) —, the producer's own bell (064) is untouched, an upload
 * notifies nobody, and My work + the bell + the inline panel work on real pages.
 *
 * Cast: the producer owns the label; the seed BUYER is an A&R member of the
 * whole org; ARTIST_A is Nova's roster artist, ARTIST_B Kilo's. Nova has the
 * song "Midnight" (selected, so any function may read it) in her Inbox.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `tasks-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const MIDNIGHT = randomUUID();
const TITLE = `Clear the sample ${run}`;

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

/** A PostgREST read with the person's OWN token, the way their browser would: RLS decides. */
async function readAs(request: APIRequestContext, who: { id: string; email: string }, p: string) {
  const res = await request.fetch(`${REST}/${p}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}` } });
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>[];
}
async function writeAs(request: APIRequestContext, who: { id: string; email: string }, method: string, p: string, body: unknown) {
  return request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(who.id, who.email)}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: JSON.stringify(body),
  });
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const buyer = { id: BUYER_ID, email: 'buyer@local.test' };
const artistA = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const artistB = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

/** Without R2 a master lands in public/uploads/; a run must not leave any behind. */
function removeLocalUpload(url: unknown) {
  if (typeof url !== 'string' || !/^\/uploads\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(url)) return;
  fs.rmSync(path.join(process.cwd(), 'public', url), { force: true });
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

const notesOf = async (request: APIRequestContext, userId: string) =>
  (await rest(request, 'GET', `notifications?user_id=eq.${userId}&org_id=eq.${ORG}&select=id,kind,title,body,read,data`)) as { id: string; kind: string; title: string; body: string | null; read: boolean; data: { taskId: string; target: { kind: string; id: string } | null } }[];

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Task Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
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
  await rest(request, 'POST', 'projects', { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  await rest(request, 'POST', 'tracks', { id: MIDNIGHT, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Midnight', type: 'song', song_stage: 'selected', audio_url: `/uploads/labelos-e2e-${MIDNIGHT}.mp3` });
  await rest(request, 'POST', 'project_tracks', { project_id: NOVA_INBOX, track_id: MIDNIGHT, position: 0 });
  // A producer-bell notification that must keep behaving exactly as before.
  await rest(request, 'POST', 'notifications', { user_id: PRODUCER_ID, kind: 'purchase', title: `Sale ${run}`, body: null });
});

test.afterAll(async ({ request }) => {
  const rows = (await rest(request, 'GET', `tracks?select=audio_url&org_id=eq.${ORG}`)) as { audio_url: string | null }[];
  for (const r of rows) removeLocalUpload(r.audio_url);
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `notifications?title=eq.Sale ${run}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · assigning a task notifies ONLY the assignee (route and database, with each person\'s own JWT)', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const res = await owner.request.post(`/api/org/${ORG}/tasks`, { data: { title: TITLE, assignee_id: BUYER_ID, due_at: new Date(Date.now() - 86_400_000).toISOString(), target: { kind: 'song', id: MIDNIGHT } } });
  expect(res.status(), await res.text()).toBe(201);
  const { task } = await res.json();
  expect(task).toMatchObject({ title: TITLE, assignee: { id: BUYER_ID }, mine: false, canDelete: true });

  // The real row: one object only, in this org.
  const rows = (await rest(request, 'GET', `tasks?id=eq.${task.id}&select=org_id,song_id,artist_id,project_id,release_id,assignee_id,created_by`)) as Record<string, string | null>[];
  expect(rows).toEqual([{ org_id: ORG, song_id: MIDNIGHT, artist_id: null, project_id: null, release_id: null, assignee_id: BUYER_ID, created_by: PRODUCER_ID }]);

  // Exactly one notification, to the assignee, in this org; the owner who asked and everyone else got none.
  const note = await notesOf(request, BUYER_ID);
  expect(note).toHaveLength(1);
  expect(note[0]).toMatchObject({ kind: 'task_assigned', body: TITLE, read: false });
  expect(note[0].data).toEqual({ taskId: task.id, target: { kind: 'song', id: MIDNIGHT } });
  for (const id of [PRODUCER_ID, ARTIST_A_ID, ARTIST_B_ID]) expect(await notesOf(request, id)).toEqual([]);

  // RLS, from PostgREST with each JWT: the assignee reads their notification and task; the owner reads the task
  // (holds everything) but no notification; a roster artist reads neither.
  expect((await readAs(request, buyer, `notifications?org_id=eq.${ORG}&select=id`)).length).toBe(1);
  expect((await readAs(request, producer, `notifications?org_id=eq.${ORG}&select=id`)).length).toBe(0);
  expect((await readAs(request, artistA, `notifications?org_id=eq.${ORG}&select=id`)).length).toBe(0);
  expect((await readAs(request, buyer, `tasks?org_id=eq.${ORG}&select=id`)).length).toBe(1);
  expect((await readAs(request, producer, `tasks?org_id=eq.${ORG}&select=id`)).length).toBe(1);
  expect((await readAs(request, artistA, `tasks?org_id=eq.${ORG}&select=id`)).length).toBe(0);
  expect((await readAs(request, artistB, `tasks?org_id=eq.${ORG}&select=id`)).length).toBe(0);
  await owner.close();
});

test('2 · nothing writes tasks or org notifications through PostgREST; the route refuses what the role may not do', async ({ browser, baseURL, request }) => {
  // PostgREST with a member's own token: refused by RLS / the service-only trigger.
  const forgedTask = await writeAs(request, buyer, 'POST', 'tasks', { org_id: ORG, title: 'sneaky', created_by: BUYER_ID });
  expect(forgedTask.ok()).toBe(false);
  const forgedNote = await writeAs(request, buyer, 'POST', 'notifications', { user_id: BUYER_ID, org_id: ORG, kind: 'task_assigned', title: 'forged' });
  expect(forgedNote.ok()).toBe(false);
  const readNote = await writeAs(request, buyer, 'PATCH', `notifications?org_id=eq.${ORG}`, { read: true });
  expect(readNote.ok()).toBe(false);
  expect(((await rest(request, 'GET', `tasks?org_id=eq.${ORG}&select=id`)) as unknown[]).length).toBe(1);
  expect((await notesOf(request, BUYER_ID))[0].read).toBe(false);

  // Routes: a roster artist cannot create; the A&R cannot hand Nova's song to Kilo's artist; another org's id is not an object.
  const a = await as(browser, baseURL!, artistA.id, artistA.email);
  expect((await a.request.post(`/api/org/${ORG}/tasks`, { data: { title: 'x' } })).status()).toBe(403);
  const ar = await as(browser, baseURL!, buyer.id, buyer.email);
  expect((await ar.request.post(`/api/org/${ORG}/tasks`, { data: { title: 'x', assignee_id: ARTIST_B_ID, target: { kind: 'song', id: MIDNIGHT } } })).status()).toBe(400);
  expect((await ar.request.post(`/api/org/${ORG}/tasks`, { data: { title: 'x', target: { kind: 'song', id: randomUUID() } } })).status()).toBe(404);
  // A task for yourself asks nobody.
  expect((await ar.request.post(`/api/org/${ORG}/tasks`, { data: { title: `mine ${run}`, assignee_id: BUYER_ID, target: { kind: 'artist', id: NOVA } } })).status()).toBe(201);
  expect(await notesOf(request, BUYER_ID)).toHaveLength(1);
  // The artist (not a party to any task) sees no task on her own song.
  const res = await a.request.get(`/api/org/${ORG}/tasks?kind=song&id=${MIDNIGHT}`);
  expect(res.status()).toBe(200);
  expect((await res.json()).tasks).toEqual([]);
  await a.close();
  await ar.close();
});

test('3 · the producer\'s own bell is untouched: /api/notifications shows the sale and never an org ask', async ({ browser, baseURL, request }) => {
  const ar = await as(browser, baseURL!, buyer.id, buyer.email);
  // The A&R hands the owner a task, so the PRODUCER now holds an org notification as well as their sale.
  const res = await ar.request.post(`/api/org/${ORG}/tasks`, { data: { title: `for the owner ${run}`, assignee_id: PRODUCER_ID } });
  expect(res.status(), await res.text()).toBe(201);
  expect(await notesOf(request, PRODUCER_ID)).toHaveLength(1);

  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const bell = await (await owner.request.get('/api/notifications')).json();
  const titles = (bell.notifications as { title: string }[]).map((n) => n.title);
  expect(titles).toContain(`Sale ${run}`);
  expect(titles.some((t) => /assigned you a task/.test(t))).toBe(false);
  expect(bell.notifications.every((n: { kind: string }) => n.kind !== 'task_assigned')).toBe(true);
  // Mark-all on the producer bell does not clear the org's ask.
  expect((await owner.request.patch('/api/notifications?action=read_all')).status()).toBe(200);
  expect((await notesOf(request, PRODUCER_ID))[0].read).toBe(false);

  // The org bell is the other half: their own ask, in this org only.
  const org = await (await owner.request.get(`/api/org/${ORG}/notifications`)).json();
  expect(org.notifications).toHaveLength(1);
  expect(org.notifications[0]).toMatchObject({ kind: 'task_assigned', title: expect.stringMatching(/assigned you a task/) });
  expect(org.unread).toBe(1);
  // …and a stranger to the org gets nothing and is refused.
  const a = await as(browser, baseURL!, artistB.id, artistB.email);
  expect((await (await a.request.get(`/api/org/${ORG}/notifications`)).json()).notifications).toEqual([]);
  await owner.close();
  await ar.close();
  await a.close();
});

test('4 · an upload notifies nobody — not the owner, not an A&R, not the artist', async ({ browser, baseURL, request }) => {
  const before = await Promise.all([PRODUCER_ID, BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].map(async (id) => (await notesOf(request, id)).length));
  const ar = await as(browser, baseURL!, buyer.id, buyer.email);
  const bytes = wav(330);
  const init = await ar.request.post(`/api/org/${ORG}/upload/init`, { data: { fileName: `Fresh idea ${run}.wav`, fileSize: bytes.length, fileType: 'audio/wav', as: { kind: 'song', contactId: NOVA } } });
  expect(init.status(), await init.text()).toBe(200);
  const { sessionId, partSize, totalParts } = await init.json();
  for (let p = 1; p <= totalParts; p++) {
    const put = await ar.request.put(`/api/org/${ORG}/upload/part`, { headers: { 'x-session-id': sessionId, 'x-part-number': String(p), 'content-type': 'application/octet-stream' }, data: bytes.subarray((p - 1) * partSize, Math.min(bytes.length, p * partSize)) });
    expect(put.status(), await put.text()).toBe(200);
  }
  const done = await ar.request.post(`/api/org/${ORG}/upload/complete`, { data: { sessionId, as: { kind: 'song', contactId: NOVA } } });
  expect(done.status(), await done.text()).toBe(200);
  // The song exists and the activity feed records it…
  const events = (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.song.created&select=verb`)) as unknown[];
  expect(events.length).toBeGreaterThan(0);
  // …but the bell is exactly as it was for everyone, and no notification of any non-task kind exists in the org.
  const after = await Promise.all([PRODUCER_ID, BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].map(async (id) => (await notesOf(request, id)).length));
  expect(after).toEqual(before);
  const kinds = (await rest(request, 'GET', `notifications?org_id=eq.${ORG}&select=kind`)) as { kind: string }[];
  expect([...new Set(kinds.map((k) => k.kind))]).toEqual(['task_assigned']);
  await ar.close();
});

test('5 · the pages: My work, tick-off, the bell opens the song, tasks inline on the song (desktop and phone)', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, buyer.id, buyer.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}`);
  const work = page.getByTestId('my-work');
  await expect(work).toContainText(TITLE);
  await expect(work.getByTestId('my-work-overdue')).toContainText(TITLE);
  await expect(work.getByRole('link', { name: 'Song' }).first()).toHaveAttribute('href', `/o/${SLUG}/songs/${MIDNIGHT}`);

  // The bell shows the ask under THIS org and opens the song it is about.
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText('assigned you a task').first()).toBeVisible();
  await page.getByRole('button', { name: /Open ".*assigned you a task"/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/songs/${MIDNIGHT}`));
  expect((await notesOf(request, BUYER_ID))[0].read).toBe(true);

  // Inline on the song: the task, with a form to add another.
  const panel = page.getByTestId('org-song-tasks');
  await expect(panel).toContainText(TITLE);
  await panel.getByTestId('org-song-tasks-add').click();
  await panel.getByLabel('Task').fill(`Send stems ${run}`);
  await panel.getByRole('button', { name: 'Add' }).click();
  await expect(panel).toContainText(`Send stems ${run}`);

  // Phone width: My work still reads, and ticking a task off removes it.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByTestId('my-work')).toContainText(TITLE);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('checkbox', { name: new RegExp(`Complete “${TITLE}”`) }).click();
  await expect(page.getByTestId('my-work')).not.toContainText(TITLE);
  const done = (await rest(request, 'GET', `tasks?org_id=eq.${ORG}&title=eq.${encodeURIComponent(TITLE)}&select=done_at,done_by`)) as { done_at: string | null; done_by: string | null }[];
  expect(done[0].done_at).toBeTruthy();
  expect(done[0].done_by).toBe(BUYER_ID);
  await ctx.close();
});
