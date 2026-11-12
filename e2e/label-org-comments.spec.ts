/**
 * Org comments (LABEL-22) end to end against a REAL database (scripts/local-db,
 * LABEL_OS_ENABLED=true from env.sh), migration 150 included:
 *
 *   PRODUCER  the owner of a label org            — the team
 *   ART       a roster artist (role `artist`)     — never reads a team-only note
 *   BUYER     an external COMMENTER of one project — never reads a team-only note
 *
 * The team writes an artist-visible comment and a team-only one, pinned to a
 * moment, from the project page; the external member and the roster artist
 * read and reply; a thread open on the first mix is carried forward onto the
 * current version ("from mix v1") until it is resolved. The security bar is
 * proven three ways at once: the routes' JSON, the REAL row-level security
 * with the member's OWN JWT through PostgREST, and the public share endpoint.
 * A portal thread cannot hold an internal row at all (the table's CHECK).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ANON_KEY, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `comments-${run}`;
const NOVA = randomUUID();
const P1 = randomUUID();
const S1 = randomUUID(); // the song = mix v1
const V2 = randomUUID(); // a version added to it = mix v2 (the current one)
const ART = randomUUID();
const ART_EMAIL = `artist-${run}@local.test`;
const BUYER_EMAIL = 'buyer@local.test';
const SHARE = `share${run}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const OPEN_NOTE = `The vocal is too bright ${run}`;
const TEAM_NOTE = `TEAM ONLY: clear the sample ${run}`;
const BUYER_NOTE = `Love the groove ${run}`;
const DB_URL = (process.env.LOCAL_DB_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres').replace(/\/[^/]*$/, `/${process.env.LOCAL_DB_NAME ?? 'beatstore_local'}`);

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown, token = SERVICE_KEY, key = SERVICE_KEY) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status(), body: res.status() === 204 ? null : await res.json().catch(() => null) };
}
const must = async (p: ReturnType<typeof rest>) => {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r.body;
};

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

type Row = { id: string; body: string; visibility: string; org_id: string | null };

test.beforeAll(async ({ request }) => {
  // A second account for the roster artist (the seed has only the producer and the buyer).
  execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-c', `INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('${ART}', '${ART_EMAIL}', now()) ON CONFLICT DO NOTHING`]);
  await must(rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`));
  await must(rest(request, 'POST', 'organizations', { id: ORG, name: `Comments Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID }));
  await must(rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' },
    { org_id: ORG, user_id: ART, role: 'artist', scope: 'artists' },
  ]));
  await must(rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' }));
  await must(rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ART, contact_id: NOVA }));
  await must(rest(request, 'POST', 'projects', { id: P1, org_id: ORG, user_id: null, name: `Nova EP ${run}`, inbox_for_contact_id: NOVA }));
  await must(rest(request, 'POST', 'tracks', [
    { id: S1, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'selected', duration_seconds: 200, audio_url: '/uploads/none.wav' },
    { id: V2, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight v2 ${run}`, type: 'song', song_stage: null, duration_seconds: 201, audio_url: '/uploads/none.wav' },
  ]));
  await must(rest(request, 'POST', 'project_tracks', [
    { project_id: P1, track_id: S1, position: 0 },
    { project_id: P1, track_id: V2, position: 1 },
  ]));
  await must(rest(request, 'POST', 'track_links', { from_track_id: S1, to_track_id: V2, user_id: null, relation: 'version' }));
  await must(rest(request, 'POST', 'project_members', { org_id: ORG, project_id: P1, user_id: BUYER_ID, role: 'commenter', allow_downloads: false, invited_by: PRODUCER_ID }));
  await must(rest(request, 'POST', 'project_shares', { project_id: P1, token: SHARE, role: 'commenter', created_by: PRODUCER_ID }));
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`);
  execFileSync('psql', [DB_URL, '-q', '-c', `DELETE FROM auth.users WHERE id = '${ART}'`]);
});

test('1 · the team comments from the project page: a visible note and a team-only one, then the external member and the artist read and reply', async ({ browser, baseURL }) => {
  const producer = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();
  await pp.goto(`/o/${SLUG}/projects/${P1}`);
  const section = pp.locator('section[aria-labelledby="org-project-comments"]');
  await expect(section.getByTestId('org-comments')).toBeVisible({ timeout: 60_000 });

  // ── An artist-visible comment on the first mix ─────────────────────────
  await section.getByRole('button', { name: 'Comments on', exact: false }).click();
  await pp.getByRole('option', { name: `Midnight ${run}`, exact: true }).click();
  await expect(section.getByText(/mix v1/).first()).toBeVisible();
  await section.getByLabel('Add a comment').fill(OPEN_NOTE);
  await section.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(section.getByText(OPEN_NOTE)).toBeVisible({ timeout: 30_000 });

  // ── A team-only one: the control is there for the team ────────────────
  await section.getByLabel('Add a comment').fill(TEAM_NOTE);
  await section.getByRole('checkbox', { name: 'Team only' }).check();
  await section.getByRole('button', { name: 'Send', exact: true }).click();
  const teamThread = section.locator('[data-testid^="thread-"]', { hasText: TEAM_NOTE });
  await expect(teamThread).toBeVisible({ timeout: 30_000 });
  await expect(teamThread.getByTestId('internal-chip')).toContainText('Team only');

  // Stored by the service role with the project's org; the internal one is flagged; neither has a share token or contact.
  const rows = (await must(rest(producer.request, 'GET', `project_comments?select=id,body,visibility,org_id,share_token,contact_id,user_id&project_id=eq.${P1}&order=created_at`))) as (Row & { share_token: string | null; contact_id: string | null; user_id: string })[];
  expect(rows.map((r) => [r.body, r.visibility, r.org_id, r.share_token, r.contact_id, r.user_id])).toEqual([
    [OPEN_NOTE, 'artist', ORG, null, null, PRODUCER_ID],
    [TEAM_NOTE, 'internal', ORG, null, null, PRODUCER_ID],
  ]);

  // ── The external COMMENTER: sees the visible note only, replies ───────
  const buyer = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);
  const bp = await buyer.newPage();
  await bp.goto(`/shared/${P1}`);
  await expect(bp.getByTestId('shared-project')).toBeVisible({ timeout: 60_000 });
  await bp.getByRole('button', { name: `Comments on Midnight ${run}`, exact: true }).click();
  const rec = bp.getByTestId(`shared-rec-${S1}`);
  await expect(rec.getByText(OPEN_NOTE)).toBeVisible({ timeout: 30_000 });
  await expect(bp.locator('body')).not.toContainText(TEAM_NOTE);
  await expect(bp.getByRole('checkbox', { name: 'Team only' })).toHaveCount(0); // the control does not exist for them
  await rec.getByRole('button', { name: 'Reply' }).click();
  await rec.getByLabel('Reply', { exact: true }).fill(BUYER_NOTE);
  await rec.getByRole('button', { name: 'Send reply' }).click();
  await expect(rec.getByText(BUYER_NOTE)).toBeVisible({ timeout: 30_000 });

  // They cannot write a team-only note, even by calling the route.
  const forged = await buyer.request.post(`/api/org/${ORG}/projects/${P1}/comments`, { data: { body: 'sneaky', visibility: 'internal' } });
  expect(forged.status()).toBe(403);

  // ── The producer sees the reply on the thread ─────────────────────────
  await pp.reload();
  await section.getByRole('button', { name: 'Comments on', exact: false }).click();
  await pp.getByRole('option', { name: `Midnight ${run}`, exact: true }).click();
  await expect(section.locator('[data-testid^="thread-"]', { hasText: OPEN_NOTE }).getByText(BUYER_NOTE)).toBeVisible({ timeout: 30_000 });

  await producer.close();
  await buyer.close();
});

test('2 · carry-forward: the open thread on mix v1 shows on the current version, labelled, and leaves when it is resolved', async ({ browser, baseURL }) => {
  const producer = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const pp = await producer.newPage();
  await pp.goto(`/o/${SLUG}/projects/${P1}`);
  const section = pp.locator('section[aria-labelledby="org-project-comments"]');
  await expect(section.getByTestId('org-comments')).toBeVisible({ timeout: 60_000 });
  await section.getByRole('button', { name: 'Comments on', exact: false }).click();
  await pp.getByRole('option', { name: `Midnight v2 ${run}`, exact: true }).click();
  await expect(section.getByText(/mix v2 · current/)).toBeVisible({ timeout: 30_000 });

  // Both open threads of mix v1 show here — the team's too — each labelled, replies included.
  const openThread = section.locator('[data-testid^="thread-"]', { hasText: OPEN_NOTE });
  await expect(openThread).toBeVisible({ timeout: 30_000 });
  await expect(openThread.getByTestId('carried-label').first()).toHaveText('from mix v1');
  await expect(openThread.getByText(BUYER_NOTE)).toBeVisible();
  await expect(section.locator('[data-testid^="thread-"]', { hasText: TEAM_NOTE }).getByTestId('carried-label')).toHaveText('from mix v1');

  // The API says the same, and an external member never gets the team's one carried either.
  const asTeam = await (await producer.request.get(`/api/org/${ORG}/projects/${P1}/comments?trackId=${V2}`)).json();
  expect((asTeam.comments as { body: string; carriedFrom: { label: string } | null }[]).map((c) => [c.body, c.carriedFrom?.label ?? null])).toEqual([
    [OPEN_NOTE, 'mix v1'],
    [TEAM_NOTE, 'mix v1'],
    [BUYER_NOTE, 'mix v1'],
  ]);
  const buyer = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);
  const asBuyer = await (await buyer.request.get(`/api/org/${ORG}/projects/${P1}/comments?trackId=${V2}`)).json();
  expect((asBuyer.comments as { body: string }[]).map((c) => c.body)).toEqual([OPEN_NOTE, BUYER_NOTE]);

  // Resolve the visible thread: it no longer carries. Reopen: it is back.
  await openThread.getByRole('button', { name: 'Resolve' }).click();
  await expect(section.locator('[data-testid^="thread-"]', { hasText: OPEN_NOTE })).toHaveCount(0, { timeout: 30_000 });
  const afterResolve = await (await producer.request.get(`/api/org/${ORG}/projects/${P1}/comments?trackId=${V2}`)).json();
  expect((afterResolve.comments as { body: string }[]).map((c) => c.body)).toEqual([TEAM_NOTE]);
  const reopen = await producer.request.patch(`/api/org/${ORG}/projects/${P1}/comments/${(await openCommentId(producer.request))}`, { data: { resolved: false } });
  expect(reopen.status()).toBe(200);
  const afterReopen = await (await producer.request.get(`/api/org/${ORG}/projects/${P1}/comments?trackId=${V2}`)).json();
  expect((afterReopen.comments as { body: string }[]).map((c) => c.body)).toContain(OPEN_NOTE);

  // Events: names the comments, never what they say; the team-only note's event is team-only.
  const events = (await must(rest(producer.request, 'GET', `activity_events?select=verb,visibility,payload,subject_id&org_id=eq.${ORG}&verb=like.comment.*&order=created_at`))) as { verb: string; visibility: string; payload: unknown }[];
  expect(events.map((e) => e.verb)).toEqual(expect.arrayContaining(['comment.created', 'comment.resolved']));
  expect(JSON.stringify(events)).not.toContain(OPEN_NOTE);
  expect(JSON.stringify(events)).not.toContain(TEAM_NOTE);
  expect(events.filter((e) => e.visibility === 'internal').length).toBeGreaterThanOrEqual(1);
  await producer.close();
  await buyer.close();
});

async function openCommentId(request: APIRequestContext): Promise<string> {
  const rows = (await must(rest(request, 'GET', `project_comments?select=id&body=eq.${encodeURIComponent(OPEN_NOTE)}&project_id=eq.${P1}`))) as { id: string }[];
  return rows[0].id;
}

test('3 · the security bar: no team-only comment reaches the artist, an external member, a share page, a portal thread — by route AND by RLS', async ({ browser, baseURL, request }) => {
  const artist = await as(browser, baseURL!, ART, ART_EMAIL);
  const buyer = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);

  // ── The routes ────────────────────────────────────────────────────────
  for (const [who, ctx] of [['the roster artist', artist], ['the external commenter', buyer]] as const) {
    for (const q of ['', `?trackId=${S1}`, `?trackId=${V2}`]) {
      const res = await ctx.request.get(`/api/org/${ORG}/projects/${P1}/comments${q}`);
      expect(res.status(), `${who} ${q}`).toBe(200);
      const text = JSON.stringify(await res.json());
      expect(text, `${who} ${q}`).not.toContain(TEAM_NOTE);
      expect(text, `${who} ${q}`).not.toContain('"internal"');
    }
    expect((await ctx.request.post(`/api/org/${ORG}/projects/${P1}/comments`, { data: { body: 'sneaky', visibility: 'internal' } })).status(), who).toBe(403);
  }
  // The artist reads and may comment (artist-visible), and sees the control-free composer.
  const artistList = await (await artist.request.get(`/api/org/${ORG}/projects/${P1}/comments`)).json();
  expect(artistList.me).toEqual({ canComment: true, canPostInternal: false });
  expect((artistList.comments as { body: string }[]).map((c) => c.body)).toContain(OPEN_NOTE);
  // A team-only comment is a 404 by id for them: its existence is not theirs to learn.
  const teamId = ((await must(rest(request, 'GET', `project_comments?select=id&body=eq.${encodeURIComponent(TEAM_NOTE)}`))) as { id: string }[])[0].id;
  for (const ctx of [artist, buyer]) {
    expect((await ctx.request.patch(`/api/org/${ORG}/projects/${P1}/comments/${teamId}`, { data: { resolved: true } })).status()).toBe(404);
    expect((await ctx.request.delete(`/api/org/${ORG}/projects/${P1}/comments/${teamId}`)).status()).toBe(404);
  }

  // ── The artist's page ─────────────────────────────────────────────────
  const ap = await artist.newPage();
  await ap.goto(`/o/${SLUG}/projects/${P1}`);
  const section = ap.locator('section[aria-labelledby="org-project-comments"]');
  await expect(section.getByText(OPEN_NOTE)).toBeVisible({ timeout: 60_000 });
  await expect(ap.locator('body')).not.toContainText(TEAM_NOTE);
  await expect(section.getByRole('checkbox', { name: 'Team only' })).toHaveCount(0);

  // ── The REAL row-level security, with each person's own JWT ───────────
  const asUser = async (id: string, email: string) => (await must(rest(request, 'GET', `project_comments?select=body,visibility&project_id=eq.${P1}`, undefined, userToken(id, email), ANON_KEY))) as { body: string; visibility: string }[];
  const team = await asUser(PRODUCER_ID, 'producer@local.test');
  expect(team.map((r) => r.body)).toEqual(expect.arrayContaining([OPEN_NOTE, TEAM_NOTE]));
  const art = await asUser(ART, ART_EMAIL);
  expect(art.map((r) => r.body)).toContain(OPEN_NOTE);
  expect(art.some((r) => r.visibility === 'internal' || r.body === TEAM_NOTE)).toBe(false);
  expect(await asUser(BUYER_ID, BUYER_EMAIL)).toEqual([]); // an external member's own JWT reads no comment at all
  const anon = await rest(request, 'GET', `project_comments?select=body&project_id=eq.${P1}`, undefined, ANON_KEY, ANON_KEY);
  expect(anon.body).toEqual([]);
  // They cannot write through PostgREST either.
  const direct = await rest(request, 'POST', 'project_comments', { project_id: P1, author_name: 'x', body: 'direct', visibility: 'artist' }, userToken(ART, ART_EMAIL), ANON_KEY);
  expect(direct.status).toBeGreaterThanOrEqual(400);

  // ── The share page: the public endpoint never lists a team-only note ──
  const shared = await request.get(`/api/projects/share/${SHARE}/comments`);
  expect(shared.status()).toBe(200);
  const sharedBodies = ((await shared.json()).comments as { body: string }[]).map((c) => c.body);
  expect(sharedBodies).toContain(OPEN_NOTE);
  expect(sharedBodies).not.toContain(TEAM_NOTE);
  expect(JSON.stringify(sharedBodies)).not.toContain('TEAM ONLY');

  // ── A portal / share-link thread cannot be team-only: the table says no ──
  const asPortal = await rest(request, 'POST', 'project_comments', { project_id: P1, author_name: 'x', body: 'portal internal', visibility: 'internal', contact_id: NOVA });
  expect(asPortal.status).toBe(400);
  expect(JSON.stringify(asPortal.body)).toContain('project_comments_internal_private');
  const asShare = await rest(request, 'POST', 'project_comments', { project_id: P1, author_name: 'x', body: 'share internal', visibility: 'internal', share_token: SHARE });
  expect(asShare.status).toBe(400);

  await artist.close();
  await buyer.close();
});

test('4 · access ends with the membership: a removed external member loses read and write on the very next request', async ({ browser, baseURL, request }) => {
  const buyer = await as(browser, baseURL!, BUYER_ID, BUYER_EMAIL);
  expect((await buyer.request.get(`/api/org/${ORG}/projects/${P1}/comments`)).status()).toBe(200);
  await must(rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}&project_id=eq.${P1}`));
  // With no membership left anywhere the proxy's coarse gate answers 403 before the route runs.
  expect((await buyer.request.get(`/api/org/${ORG}/projects/${P1}/comments`)).status()).toBe(403);
  expect((await buyer.request.post(`/api/org/${ORG}/projects/${P1}/comments`, { data: { body: 'still here?' } })).status()).toBe(403);
  await buyer.close();
});
