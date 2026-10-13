/**
 * Needs attention (LABEL-35) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true). What
 * mocks cannot prove: the three canonical items come out of real rows through
 * the real release-readiness, stage-event and task reads, at desktop and
 * phone width, and an artists-scoped member's page and API carry nothing of
 * the other artist.
 *
 * The canonical Monday morning (03 / 07 §2.1) for Nova: the EP is a draft
 * 23 days from its target with blocked gates, "Track 04" has been in
 * development for 41 days, and the owner has two overdue tasks. Noise that
 * must not be listed: a release far out, a song only 10 days into a stage, a
 * task not yet due. Test 2 then adds Kilo's own blocked release and stalled
 * song and scopes the seed BUYER (A&R) to Kilo.
 *
 * Dates are seeded relative to today, so the spec holds on any day.
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `attention-${run}`;
const NOVA = randomUUID();
const KILO = randomUUID();
const NOVA_INBOX = randomUUID();
const KILO_INBOX = randomUUID();
const TRACK_04 = randomUUID();
const FRESH = randomUUID();
const KILO_SONG = randomUUID();
const EP = randomUUID();
const FAR = randomUUID();
const KILO_EP = randomUUID();

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const dateOnly = (n: number) => daysFromNow(n).toISOString().slice(0, 10);

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

async function as(browser: Browser, baseURL: string, id: string, email: string, viewport?: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext(viewport ? { viewport } : undefined);
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const song = (id: string, title: string, stage: string, createdDaysAgo: number) => ({
  id, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title, type: 'song', song_stage: stage,
  audio_url: `/uploads/labelos-e2e-${id}.mp3`, created_at: daysFromNow(-createdDaysAgo).toISOString(),
});
const release = (id: string, project: string, contact: string, title: string, target: string) => ({
  id, org_id: ORG, project_id: project, contact_id: contact, title, type: 'ep', target_date: target, state: 'draft', created_by: PRODUCER_ID,
});
const task = (title: string, dueInDays: number) => ({
  org_id: ORG, title, due_at: daysFromNow(dueInDays).toISOString(), assignee_id: PRODUCER_ID, created_by: PRODUCER_ID,
});

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Attention Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'artists', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', [
    { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' },
    { id: KILO, org_id: ORG, user_id: null, name: `Kilo ${run}`, category: 'artist' },
  ]);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: BUYER_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA },
    { id: KILO_INBOX, org_id: ORG, user_id: null, name: `Inbox · Kilo ${run}`, inbox_for_contact_id: KILO },
  ]);
  await rest(request, 'POST', 'tracks', [song(TRACK_04, `Track 04 ${run}`, 'in_development', 41), song(FRESH, `Fresh idea ${run}`, 'in_development', 10)]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_INBOX, track_id: TRACK_04, position: 0 },
    { project_id: NOVA_INBOX, track_id: FRESH, position: 1 },
  ]);
  await rest(request, 'POST', 'releases', [
    release(EP, NOVA_INBOX, NOVA, `EP 2027 ${run}`, dateOnly(23)),
    release(FAR, NOVA_INBOX, NOVA, `Far away ${run}`, dateOnly(200)),
  ]);
  await rest(request, 'POST', 'tasks', [task('Get Producer X IPI', -5), task('Chase the artwork', -3), task('Send the EP', 7)]);
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1 · the owner sees exactly the three canonical items at ${viewport.width}px`, async ({ browser, baseURL }) => {
    const ctx = await as(browser, baseURL!, PRODUCER_ID, 'producer@local.test', viewport);
    const page = await ctx.newPage();
    await page.goto(`/o/${SLUG}`);
    const section = page.getByTestId('needs-attention');
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('needs-attention-count')).toHaveText('3');

    const ep = page.getByTestId(`attention-release:${EP}`);
    await expect(ep).toContainText(`EP 2027 ${run}`);
    await expect(page.getByTestId(`attention-detail-release:${EP}`)).toContainText('target in 23 days');
    await expect(page.getByTestId(`attention-detail-release:${EP}`)).toContainText('Blocked:');
    await expect(page.getByTestId(`attention-detail-song:${TRACK_04}`)).toHaveText('In development for 41 days');
    await expect(section.getByTestId(/^attention-tasks:/)).toContainText('2 overdue tasks');

    // Not listed: the release far out, the song 10 days in, the task not yet due.
    await expect(section).not.toContainText('Far away');
    await expect(section).not.toContainText('Fresh idea');
    await expect(section).not.toContainText('Send the EP');

    // Every row names a person and a next action (the columns are hidden below md; the mobile meta carries both).
    const rows = section.getByRole('link');
    await expect(rows).toHaveCount(3);
    if (viewport.width >= 768) {
      await expect(page.getByTestId(`attention-action-release:${EP}`)).not.toBeEmpty();
      await expect(page.getByTestId(`attention-person-release:${EP}`)).not.toBeEmpty();
    } else {
      await expect(page.getByTestId(`attention-detail-release:${EP}`).locator('..')).toContainText(' · ');
    }

    // The action opens the thing it is about.
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${SLUG}/releases/${EP}`), { timeout: 30_000 });
    await ctx.close();
  });
}

test('2 · a member scoped to Kilo sees only Kilo’s items, on the page and in the API', async ({ browser, baseURL, request }) => {
  await rest(request, 'POST', 'tracks', [song(KILO_SONG, `Kilo demo ${run}`, 'in_review', 60)]);
  await rest(request, 'POST', 'project_tracks', [{ project_id: KILO_INBOX, track_id: KILO_SONG, position: 0 }]);
  await rest(request, 'POST', 'releases', [release(KILO_EP, KILO_INBOX, KILO, `Kilo EP ${run}`, dateOnly(10))]);
  await rest(request, 'DELETE', `member_artist_scopes?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: BUYER_ID, contact_id: KILO });

  const ctx = await as(browser, baseURL!, BUYER_ID, 'buyer@local.test');
  const res = await ctx.request.get(`/api/org/${ORG}/attention`);
  expect(res.status()).toBe(200);
  const body = JSON.stringify(await res.json());
  expect(body).toContain(`Kilo EP ${run}`);
  expect(body).toContain(`Kilo demo ${run}`);
  for (const secret of ['EP 2027', 'Track 04', 'Nova', NOVA, EP, TRACK_04, 'overdue task']) expect(body).not.toContain(secret);

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}`);
  await expect(page.getByTestId('needs-attention')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('needs-attention-count')).toHaveText('2');
  await expect(page.getByTestId(`attention-release:${KILO_EP}`)).toBeVisible();
  await expect(page.getByTestId(`attention-song:${KILO_SONG}`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Track 04');
  await expect(page.locator('body')).not.toContainText('EP 2027');
  await ctx.close();
});
