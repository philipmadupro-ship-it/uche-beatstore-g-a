/**
 * External project members (LABEL-21, the "Uche × Producer X" flow, W4) end to
 * end against a REAL database (scripts/local-db, LABEL_OS_ENABLED=true from
 * env.sh), migration 148 included, with TWO accounts:
 *
 *   PRODUCER  the owner of a label org (an org member)
 *   BUYER     the seed buyer, "Producer X": no org membership, no producer
 *             profile — a person with their own account and nothing else
 *
 * The producer invites X to ONE project as a contributor from the members
 * panel; the email lands in the fake Resend; X opens /join/<token> signed
 * out, signs in (the magic link is stubbed by setting the session cookie the
 * callback would set), accepts, and sees THE PROJECT — not the org. What
 * mocks cannot prove: the real RLS, 148's functions and triggers, that X
 * reaches artist, org and other-project objects NOWHERE, that a download is
 * in `activity_events`, that a role change and a removal take effect on the
 * very next request, and that what X uploaded stays, credited to them (D3).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `external-${run}`;
const NOVA = randomUUID();
const P1 = randomUUID(); // Uche × Producer X — shared with the buyer
const P2 = randomUUID(); // a secret project of the same org
const S1 = randomUUID(); // the song in P1
const S2 = randomUUID(); // a song in P2
const PROJECT_NAME = `Uche × Producer X ${run}`;
const BUYER_EMAIL = 'buyer@local.test';

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
const localFile = (id: string) => `labelos-e2e-ext-${run}-${id}.wav`;
const removeLocalUpload = (url: unknown) => {
  if (typeof url !== 'string' || !/^\/uploads\/[A-Za-z0-9_.-]+\.[a-z0-9]+$/.test(url)) return;
  fs.rmSync(path.join(process.cwd(), 'public', url), { force: true });
};

type Event = { verb: string; audit: boolean; actor_id: string | null; subject_id: string | null; project_id: string | null; payload: Record<string, unknown> };
const events = async (request: APIRequestContext, verb?: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,actor_id,subject_id,project_id,payload&org_id=eq.${ORG}${verb ? `&verb=eq.${verb}` : ''}&order=created_at`)) as Event[];
const members = async (request: APIRequestContext) =>
  (await rest(request, 'GET', `project_members?select=user_id,role,allow_downloads,expires_at,project_id,invited_by&org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`)) as {
    user_id: string; role: string; allow_downloads: boolean; expires_at: string | null; project_id: string; invited_by: string;
  }[];

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`);
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, localFile(S1)), wav(220));
  fs.writeFileSync(path.join(uploadsDir, localFile(S2)), wav(330));
  await rest(request, 'POST', 'organizations', { id: ORG, name: `External Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', [
    { id: P1, org_id: ORG, user_id: null, name: PROJECT_NAME, inbox_for_contact_id: NOVA },
    { id: P2, org_id: ORG, user_id: null, name: `Secret LP ${run}`, inbox_for_contact_id: null },
  ]);
  await rest(request, 'POST', 'tracks', [
    { id: S1, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', bpm: 140, key: 'F', scale: 'minor', audio_url: `/uploads/${localFile(S1)}` },
    { id: S2, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Secret ${run}`, type: 'song', song_stage: 'in_review', bpm: null, key: null, scale: null, audio_url: `/uploads/${localFile(S2)}` },
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: P1, track_id: S1, position: 0 },
    { project_id: P2, track_id: S2, position: 0 },
  ]);
});

test.afterAll(async ({ request }) => {
  const rows = (await rest(request, 'GET', `tracks?select=audio_url&org_id=eq.${ORG}`)) as { audio_url: string | null }[];
  for (const r of rows) removeLocalUpload(r.audio_url);
  // Org projects, tracks, members and invitations go with the org (FK cascade).
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`);
});

let joinToken = '';

test('1 · W4: the producer invites X; X accepts, sees the PROJECT (not the org), listens, downloads and uploads a version', async ({ browser, baseURL }) => {
  // ── The producer invites X from the members panel ──────────────────────
  const producer = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();
  await pp.request.delete(RESEND);
  await pp.goto(`/o/${SLUG}/projects/${P1}`);
  const panel = pp.getByTestId('project-members');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText(`People outside External Records ${run}`);
  await panel.getByLabel('Email address').fill(` ${BUYER_EMAIL.toUpperCase()} `);
  await panel.getByRole('button', { name: 'Role', exact: true }).click();
  await pp.getByRole('option', { name: 'Contributor' }).click();
  await panel.getByRole('button', { name: /^Invite$/ }).click();
  await expect(panel.getByText('Invited as Contributor')).toBeVisible({ timeout: 30_000 });

  const mails = (await (await pp.request.get(RESEND)).json()) as { body: { to: string | string[]; subject: string; html: string } }[];
  const mail = mails.find((m) => [m.body.to].flat().includes(BUYER_EMAIL));
  expect(mail, 'the project invitation email was sent').toBeTruthy();
  expect(mail!.body.subject).toContain(PROJECT_NAME);
  expect(mail!.body.html).toContain('You will see this project only');
  joinToken = String(mail!.body.html).match(/\/join\/([A-Za-z0-9_-]{43})"/)![1];

  // The invitation row: project-scoped, hashed token, never an org membership.
  const inv = (await rest(pp.request, 'GET', `org_invitations?select=email,project_id,project_role,project_allow_downloads,token_hash,accepted_at&org_id=eq.${ORG}&project_id=eq.${P1}`)) as Record<string, unknown>[];
  expect(inv).toHaveLength(1);
  expect(inv[0]).toMatchObject({ email: BUYER_EMAIL, project_id: P1, project_role: 'contributor', accepted_at: null });
  expect(JSON.stringify(inv)).not.toContain(joinToken);

  // ── X opens the link signed out, signs in, accepts ─────────────────────
  const xCtx = await browser.newContext();
  const x = await xCtx.newPage();
  await x.goto(`/join/${joinToken}`);
  await expect(x.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
  await expect(x.getByText('Contributor · one project')).toBeVisible();
  await expect(x.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
  // The page names the project, never the invited address or the org's slug.
  await expect(x.locator('body')).not.toContainText(BUYER_EMAIL);
  await expect(x.locator('body')).not.toContainText(SLUG);

  const c = sessionCookie(BUYER_ID, BUYER_EMAIL);
  await xCtx.addCookies([{ name: c.name, value: c.value, url: baseURL! }]);
  await x.reload();
  await x.getByRole('button', { name: 'Accept and open the project' }).click();
  await expect(x.getByRole('status')).toContainText(`You now have access to ${PROJECT_NAME}`);
  await expect(x.getByRole('link', { name: `Open ${PROJECT_NAME}` })).toHaveAttribute('href', `/shared/${P1}`);

  // 148's accept function: a PROJECT row, never an org membership; one audit event.
  const rows = await members(x.request);
  expect(rows).toEqual([{ user_id: BUYER_ID, role: 'contributor', allow_downloads: false, expires_at: null, project_id: P1, invited_by: PRODUCER_ID }]);
  expect(await rest(x.request, 'GET', `org_members?select=user_id&user_id=eq.${BUYER_ID}`)).toEqual([]);
  expect((await events(x.request, 'project.member_added')).map((e) => [e.actor_id, e.project_id, e.audit])).toEqual([[BUYER_ID, P1, true]]);
  expect((await events(x.request, 'member.joined')).filter((e) => e.actor_id === BUYER_ID)).toEqual([]);

  // ── X sees THE PROJECT, not the org ───────────────────────────────────
  await x.getByRole('link', { name: `Open ${PROJECT_NAME}` }).click();
  const view = x.getByTestId('shared-project');
  await expect(view).toBeVisible({ timeout: 60_000 });
  await expect(x.getByRole('heading', { level: 1 })).toContainText(PROJECT_NAME);
  await expect(x.getByTestId('shared-role')).toHaveText('Contributor');
  await expect(view).toContainText(`Nova ${run}`); // the artist's NAME
  await expect(x.getByTestId(`shared-rec-${S1}`)).toContainText(`Midnight ${run}`);
  await expect(x.getByTestId(`shared-rec-${S2}`)).toHaveCount(0); // another project of the same org
  await expect(view).not.toContainText(`Secret ${run}`);
  // No way into the org from here: no link to /o/…, no artist workspace link.
  expect(await x.locator('a[href^="/o/"]').count()).toBe(0);
  const orgPage = await xCtx.request.get(`/o/${SLUG}`, { maxRedirects: 0 });
  expect(orgPage.status()).toBe(404);
  const orgProject = await xCtx.request.get(`/o/${SLUG}/projects/${P1}`, { maxRedirects: 0 });
  expect(orgProject.status()).toBe(404);

  // "Shared with me": the switcher's list carries the project, and no org.
  const mine = await (await xCtx.request.get('/api/org')).json();
  expect(mine).toEqual({ orgs: [], shared: [{ id: P1, name: PROJECT_NAME, href: `/shared/${P1}` }] });

  // ── X reaches artist, org and other-project objects NOWHERE ───────────
  const api = xCtx.request;
  const refused = async (p: string, method = 'GET', data?: unknown) => {
    const res = await api.fetch(p, { method, ...(data ? { data } : {}) });
    expect([403, 404], `${method} ${p} answered ${res.status()}`).toContain(res.status());
  };
  await refused(`/api/org/${ORG}`, 'PATCH', { name: 'Mine now' });
  await refused(`/api/org/${ORG}/members`);
  await refused(`/api/org/${ORG}/invitations`);
  await refused(`/api/org/${ORG}/overview`);
  await refused(`/api/org/${ORG}/contacts`);
  await refused(`/api/org/${ORG}/artists/${NOVA}/workspace`);
  await refused(`/api/org/${ORG}/songs/${S1}`);
  await refused(`/api/org/${ORG}/releases`);
  await refused(`/api/org/${ORG}/projects/${P2}`); // another project of the same org
  await refused(`/api/org/${ORG}/projects/${P1}/members`); // their own, but managing is not theirs
  await refused(`/api/org/${ORG}/projects/${P1}/members`, 'POST', { email: 'friend@local.test', role: 'viewer' });
  await refused(`/api/org/${ORG}/projects/${P1}/assets`);
  await refused(`/api/org/${ORG}/audio/${S2}`); // a recording of the other project
  await refused(`/api/org/${ORG}/upload/targets?contactId=${NOVA}`);
  // A buyer-grade account is not a producer either.
  expect((await api.get('/api/tracks')).status()).toBe(403);
  expect((await api.get('/api/contacts')).status()).toBe(403);
  // And the real RLS gives their own JWT nothing of the project's material.
  expect((await api.get(`/api/org/${ORG}/projects/${P1}`)).status()).toBe(200);

  // ── X listens, then downloads (contributor: always) — audited ─────────
  const listen = await api.get(`/api/org/${ORG}/audio/${S1}?variant=full`);
  expect(listen.status()).toBe(200);
  expect((await listen.body()).length).toBeGreaterThan(1000);
  expect(await events(api, 'recording.downloaded')).toEqual([]); // listening is not audited
  const dl = await api.get(`/api/org/${ORG}/audio/${S1}?variant=full&download=1`);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toContain('attachment');
  const downloaded = await events(api, 'recording.downloaded');
  expect(downloaded).toHaveLength(1);
  expect(downloaded[0]).toMatchObject({ actor_id: BUYER_ID, subject_id: S1, project_id: P1, audit: true });
  expect(downloaded[0].payload).toMatchObject({ variant: 'full', role: 'contributor', by: 'project_member' });
  await expect(x.getByLabel(`Download Midnight ${run}`)).toHaveAttribute('href', `/api/org/${ORG}/audio/${S1}?variant=full&download=1`);

  // ── X uploads a new VERSION through the tray; it lands in THEIR project, credited to them ──
  await x.getByTestId('shared-upload-input').setInputFiles({ name: `Midnight ${run} v2.wav`, mimeType: 'audio/wav', buffer: wav(440) });
  await expect(x.getByText('1 file added to the uploads tray.')).toBeVisible();
  await expect
    .poll(async () => ((await rest(api, 'GET', `tracks?select=id&org_id=eq.${ORG}&created_by=eq.${BUYER_ID}`)) as unknown[]).length, { timeout: 60_000 })
    .toBe(1);
  const [version] = (await rest(api, 'GET', `tracks?select=id,org_id,user_id,created_by,type,song_stage,title&org_id=eq.${ORG}&created_by=eq.${BUYER_ID}`)) as {
    id: string; org_id: string; user_id: string | null; created_by: string; type: string; song_stage: string | null; title: string;
  }[];
  expect(version).toMatchObject({ org_id: ORG, user_id: null, created_by: BUYER_ID, type: 'song', song_stage: null });
  // The route inserts the track, then its link and placement, then records the event: wait for the last.
  await expect.poll(async () => (await events(api, 'recording.uploaded')).length, { timeout: 30_000 }).toBe(1);
  expect(await rest(api, 'GET', `project_tracks?select=project_id&track_id=eq.${version.id}`)).toEqual([{ project_id: P1 }]);
  expect(await rest(api, 'GET', `track_links?select=from_track_id,relation,user_id&to_track_id=eq.${version.id}`)).toEqual([
    { from_track_id: S1, relation: 'version', user_id: null },
  ]);
  const uploaded = await events(api, 'recording.uploaded');
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0]).toMatchObject({ actor_id: BUYER_ID, project_id: P1, payload: { relation: 'version', by: 'project_member' } });
  // It plays for them, and the project page lists it.
  await x.reload();
  await expect(x.getByTestId(`shared-rec-${version.id}`)).toBeVisible({ timeout: 30_000 });
  expect((await api.get(`/api/org/${ORG}/audio/${version.id}?variant=full`)).status()).toBe(200);

  // X may not add anything else: a new song for the artist, or a master.
  const init = (as_: unknown) => api.post(`/api/org/${ORG}/upload/init`, { data: { fileName: 'x.wav', fileSize: 1000, as: as_ } });
  expect((await init({ kind: 'song', contactId: NOVA })).status()).toBe(404);
  expect((await init({ kind: 'link', songId: S1, relation: 'master' })).status()).toBe(403);
  expect((await init({ kind: 'link', songId: S2, relation: 'version' })).status()).toBe(404);

  // The producer's side: the invitation and the member are on the list; the audit rows are all there.
  await pp.reload();
  await expect(pp.getByTestId('project-members')).toContainText(BUYER_EMAIL);
  const verbs = (await events(pp.request)).map((e) => e.verb);
  for (const verb of ['invitation.created', 'project.member_added', 'recording.uploaded', 'recording.downloaded']) expect(verbs).toContain(verb);
  await producer.close();
  await xCtx.close();
});

test('2 · a role change and a removal take effect on the very next request; the upload stays, credited to X (D3)', async ({ browser, baseURL }) => {
  const producer = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();
  const x = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);
  const api = x.request;
  const versionIds = async () => ((await rest(api, 'GET', `tracks?select=id&org_id=eq.${ORG}&created_by=eq.${BUYER_ID}`)) as { id: string }[]).map((t) => t.id);
  const [versionId] = await versionIds();
  expect(versionId).toBeTruthy();
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full&download=1`)).status()).toBe(200);

  // ── Demoted to Viewer in the members panel ────────────────────────────
  await pp.goto(`/o/${SLUG}/projects/${P1}`);
  const row = pp.locator('[data-testid^="project-member-"]');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: new RegExp(`^Role of ${BUYER_EMAIL}`) }).click();
  await pp.getByRole('option', { name: 'Viewer' }).click();
  await expect.poll(async () => (await members(api))[0]?.role, { timeout: 30_000 }).toBe('viewer');
  expect((await events(api, 'project.member_changed')).map((e) => (e.payload as { changes: Record<string, unknown> }).changes)).toEqual([
    { role: { from: 'contributor', to: 'viewer' } },
  ]);
  // The very next request: still listens; no longer downloads or uploads.
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full`)).status()).toBe(200);
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full&download=1`)).status()).toBe(403);
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=wav`)).status()).toBe(403);
  expect((await api.post(`/api/org/${ORG}/upload/init`, { data: { fileName: 'x.wav', fileSize: 1000, as: { kind: 'link', songId: S1, relation: 'version' } } })).status()).toBe(403);
  // A viewer's page has no upload control and no download link.
  const xp = await x.newPage();
  await xp.goto(`/shared/${P1}`);
  await expect(xp.getByTestId('shared-role')).toHaveText('Viewer', { timeout: 60_000 });
  await expect(xp.getByTestId('shared-upload-input')).toHaveCount(0);
  await expect(xp.getByLabel(`Download Midnight ${run}`)).toHaveCount(0);
  // ...until the producer allows downloads for this project.
  await row.getByLabel('Downloads').click();
  await expect.poll(async () => (await members(api))[0]?.allow_downloads, { timeout: 30_000 }).toBe(true);
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full&download=1`)).status()).toBe(200);
  expect((await events(api, 'recording.downloaded')).length).toBe(3); // test 1, the start of this one, and now — the refused ones wrote nothing

  // ── Removed ───────────────────────────────────────────────────────────
  await row.getByRole('button', { name: `Remove ${BUYER_EMAIL}` }).click();
  await pp.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.poll(async () => (await members(api)).length, { timeout: 30_000 }).toBe(0);
  expect((await events(api, 'project.member_removed')).map((e) => [e.actor_id, e.subject_id, e.project_id, e.audit])).toEqual([[PRODUCER_ID, BUYER_ID, P1, true]]);
  // The very next request: nothing. With no membership left anywhere the proxy's
  // coarse gate answers 403 before any route runs ("revoked → 403").
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full`)).status()).toBe(403);
  expect((await api.get(`/api/org/${ORG}/projects/${P1}`)).status()).toBe(403);
  expect((await api.post(`/api/org/${ORG}/upload/init`, { data: { fileName: 'x.wav', fileSize: 1000, as: { kind: 'link', songId: S1, relation: 'version' } } })).status()).toBe(403);
  expect((await api.post(`/api/org/${ORG}/upload/part`, { data: { sessionId: 'x', partNumber: 1 } })).status()).toBe(403);
  expect((await api.get('/api/org')).status()).toBe(403);
  // The page: no membership at all, so the proxy sends them home rather than showing anything.
  const gone = await api.get(`/shared/${P1}`, { maxRedirects: 0 });
  expect([302, 307]).toContain(gone.status());
  await xp.reload();
  await expect(xp.getByTestId('shared-project')).toHaveCount(0);

  // D3: what they uploaded stays in the project, credited to them.
  expect(await versionIds()).toEqual([versionId]);
  expect(await rest(api, 'GET', `project_tracks?select=project_id&track_id=eq.${versionId}`)).toEqual([{ project_id: P1 }]);
  // The producer still hears it.
  const owner = await producer.request.get(`/api/org/${ORG}/audio/${versionId}?variant=full`);
  expect(owner.status()).toBe(200);
  // The spent link does not readmit.
  const re = await api.post('/api/org/join', { data: { token: joinToken, action: 'accept' } });
  expect(re.status()).toBe(409);
  await producer.close();
  await x.close();
});

test('3 · an expired membership is refused; a future expiry is live', async ({ browser, baseURL, request }) => {
  const x = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);
  const api = x.request;
  await rest(request, 'POST', 'project_members', {
    org_id: ORG, project_id: P1, user_id: BUYER_ID, role: 'viewer', allow_downloads: false,
    expires_at: new Date(Date.now() - 60_000).toISOString(), invited_by: PRODUCER_ID,
  });
  expect((await api.get(`/api/org/${ORG}/projects/${P1}`)).status()).toBe(403); // no live membership: the proxy's coarse gate
  await rest(request, 'PATCH', `project_members?user_id=eq.${BUYER_ID}&project_id=eq.${P1}`, { expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  expect((await api.get(`/api/org/${ORG}/projects/${P1}`)).status()).toBe(200);
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full`)).status()).toBe(200);
  await rest(request, 'PATCH', `project_members?user_id=eq.${BUYER_ID}&project_id=eq.${P1}`, { expires_at: new Date(Date.now() - 1000).toISOString() });
  expect((await api.get(`/api/org/${ORG}/audio/${S1}?variant=full`)).status()).toBe(403);
  await rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`);
  await x.close();
});

test('4 · a revoked project invitation says withdrawn; a signed-out caller reaches nothing', async ({ browser, baseURL }) => {
  const producer = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();
  await pp.request.delete(RESEND);
  const created = await pp.request.post(`/api/org/${ORG}/projects/${P1}/members`, { data: { email: `later-${run}@local.test`, role: 'viewer' } });
  expect(created.status(), await created.text()).toBe(201);
  const { invitation } = await created.json();
  const mails = (await (await pp.request.get(RESEND)).json()) as { body: { to: string | string[]; html: string } }[];
  const token = String(mails.find((m) => [m.body.to].flat().includes(`later-${run}@local.test`))!.body.html).match(/\/join\/([A-Za-z0-9_-]{43})"/)![1];
  // A second pending invitation for the same address and project is refused.
  expect((await pp.request.post(`/api/org/${ORG}/projects/${P1}/members`, { data: { email: `LATER-${run}@local.test`, role: 'editor' } })).status()).toBe(409);
  // An org-level invitation to the same address is a different thing and is allowed.
  expect((await pp.request.post(`/api/org/${ORG}/invitations`, { data: { email: `later-${run}@local.test`, role: 'member', functions: ['marketing'] } })).status()).toBe(201);
  // Project invitations are not on the org's members list; the project's own routes revoke them.
  const orgList = await (await pp.request.get(`/api/org/${ORG}/invitations`)).json();
  expect((orgList.invitations as { id: string }[]).map((i) => i.id)).not.toContain(invitation.id);
  expect((await pp.request.delete(`/api/org/${ORG}/invitations/${invitation.id}`)).status()).toBe(404);
  expect((await pp.request.delete(`/api/org/${ORG}/projects/${P1}/invitations/${invitation.id}`)).status()).toBe(200);
  expect((await pp.request.delete(`/api/org/${ORG}/projects/${P2}/invitations/${invitation.id}`)).status()).toBe(404);

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/join/${token}`);
  await expect(page.getByText('This invitation was withdrawn')).toBeVisible();

  // A mismatched account cannot take it, and learns nothing.
  const other = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);
  const created2 = await pp.request.post(`/api/org/${ORG}/projects/${P1}/members`, { data: { email: `someone-${run}@local.test`, role: 'viewer' } });
  expect(created2.status()).toBe(201);
  const mails2 = (await (await pp.request.get(RESEND)).json()) as { body: { to: string | string[]; html: string } }[];
  const token2 = String(mails2.find((m) => [m.body.to].flat().includes(`someone-${run}@local.test`))!.body.html).match(/\/join\/([A-Za-z0-9_-]{43})"/)![1];
  const res = await other.request.post('/api/org/join', { data: { token: token2, action: 'accept' } });
  expect(res.status()).toBe(403);
  expect(await res.text()).not.toContain('@');
  expect(await members(other.request)).toEqual([]);

  // Signed out: the org's audio and upload routes want a session (a link token opens nothing here).
  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/org/${ORG}/audio/${S1}?variant=full`)).status()).toBe(401);
  expect((await anon.request.post(`/api/org/${ORG}/upload/init`, { data: {} })).status()).toBe(401);
  await rest(pp.request, 'POST', 'project_shares', { project_id: P1, token: `e2e-share-${run}`, role: 'editor' });
  expect((await anon.request.get(`/api/org/${ORG}/audio/${S1}?variant=full`, { headers: { 'x-share-token': `e2e-share-${run}` } })).status()).toBe(401);
  await producer.close();
  await other.close();
  await anon.close();
});
