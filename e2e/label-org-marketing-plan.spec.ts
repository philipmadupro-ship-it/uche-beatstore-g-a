/**
 * Marketing plans (LABEL-65) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true).
 * Nothing the plan holds is seeded with the service key: the marketing member
 * builds it through the release page's Marketing section, as a person does.
 *
 * Cast (the service key seeds only the org, members, artist, project and songs):
 *   PRODUCER — owner of the label.
 *   BUYER    — marketing function: reads, approves marketing, business reader,
 *              NO audio.working (D4).
 *   ARTIST_A — role `artist` scoped to Nova: the account the asset ask reaches;
 *              reads the plan, never the budget.
 *   ARTIST_B — a_and_r: may write the plan (release.write), not a business reader.
 *
 * Proven on the real stack: the timeline, the platform checklist, an ask that
 * reaches exactly the artist's account, a budget in integer minor units that the
 * artist and the A&R member never receive, the marketing gate's plan requirement
 * (switched on by the owner in the UI, derived on every read), the calendar
 * feed, events with no words or amounts, and that a marketing member cannot reach
 * a working demo through the org audio route.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ARTIST_A_ID, ARTIST_B_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `mkt-${run}`;
const NOVA = randomUUID();
const INBOX = randomUUID();
const SONG = randomUUID();
const DEMO = randomUUID();

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

const shots = 'e2e-artifacts/LABEL-65';
mkdirSync(shots, { recursive: true });

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const marketing = { id: BUYER_ID, email: 'buyer@local.test' };
const artist = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const aAndR = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const api = `/api/org/${ORG}`;
const ids: Record<string, string> = {};
const marketingApi = () => `${api}/releases/${ids.release}/marketing`;

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Plan Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'artist', functions: [], scope: 'artists', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'member_artist_scopes', { org_id: ORG, user_id: ARTIST_A_ID, contact_id: NOVA });
  await rest(request, 'POST', 'projects', { id: INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
  // A song and a WORKING demo of it (D4: only audio.working may hear it).
  await rest(request, 'POST', 'tracks', [
    { id: SONG, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Night Shift', type: 'song', song_stage: 'inbox', audio_url: `/uploads/labelos-e2e-${SONG}.mp3` },
    { id: DEMO, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: 'Night Shift (demo)', type: 'song', song_stage: null, audio_url: `/uploads/labelos-e2e-${DEMO}.mp3` },
  ]);
  await rest(request, 'POST', 'project_tracks', [SONG, DEMO].map((track_id, position) => ({ project_id: INBOX, track_id, position })));
  await rest(request, 'POST', 'track_links', { from_track_id: SONG, to_track_id: DEMO, user_id: null, relation: 'demo' });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · the marketing member builds the plan on the release page: timeline, checklist, an ask, a budget', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const made = await owner.request.post(`${api}/releases`, { data: { title: `Night Shift ${run}`, contact_id: NOVA, type: 'single' } });
  expect(made.status(), await made.text()).toBe(201);
  ids.release = (await made.json()).release.id;
  await owner.close();

  const ctx = await as(browser, baseURL!, marketing.id, marketing.email);
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.release}`);
  const panel = page.getByTestId('marketing-plan');
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText('Nothing planned yet.')).toBeVisible();

  // Timeline: a teaser (the form's default phase) and the release-day item.
  const form = panel.getByTestId('marketing-milestone-form');
  await expect(form.getByRole('button', { name: 'Add' })).toBeDisabled();
  await form.getByLabel('Milestone', { exact: true }).fill(`Snippet on socials ${run}`);
  await form.getByLabel('Milestone date').fill('2026-11-20');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(panel.getByTestId('marketing-timeline').getByText(`Snippet on socials ${run}`)).toBeVisible({ timeout: 30_000 });

  await form.getByRole('button', { name: 'Phase' }).click();
  await page.getByRole('option', { name: 'Release', exact: true }).click();
  await form.getByLabel('Milestone', { exact: true }).fill(`Drop day ${run}`);
  await form.getByLabel('Milestone date').fill('2026-12-05');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(panel.getByTestId('marketing-timeline').getByText(`Drop day ${run}`)).toBeVisible({ timeout: 30_000 });

  // A milestone is renamed in place and completed with its checkbox.
  const items = (await rest(request, 'GET', `marketing_plan_items?select=id,phase,title,done_at&order=due_on`)) as { id: string; phase: string; title: string; done_at: string | null }[];
  const mine = items.filter((i) => i.title.includes(run));
  expect(mine.map((i) => i.phase)).toEqual(['teaser', 'release']);
  await panel.getByRole('checkbox', { name: new RegExp(`Complete “Snippet on socials ${run}”`) }).click();
  await expect(panel.getByTestId(`milestone-${mine[0].id}`)).toHaveAttribute('data-done', 'true', { timeout: 30_000 });

  // Platform checklist.
  await panel.getByLabel('Spotify: Editorial pitch').click();
  await expect(panel.getByLabel('Spotify: Editorial pitch')).toBeChecked({ timeout: 30_000 });
  expect(((await rest(request, 'GET', `marketing_platform_steps?select=platform,step`)) as unknown[]).length).toBe(1);

  // The ask to the artist reaches the one account that stands for Nova, and the screen says so.
  const ask = panel.getByTestId('marketing-assets');
  await ask.getByLabel('Note').fill('Two press shots, landscape');
  await ask.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(ask.getByTestId('marketing-asset-delivery')).toHaveText('The artist has been told.', { timeout: 30_000 });
  const notes = (await rest(request, 'GET', `notifications?select=user_id,kind,org_id,title,data&org_id=eq.${ORG}`)) as { user_id: string; kind: string; title: string; data: Record<string, unknown> }[];
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ user_id: ARTIST_A_ID, kind: 'asset_requested' });
  expect(notes[0].data).toEqual({ releaseId: ids.release, assetKind: 'photos' });
  expect(JSON.stringify(notes[0])).not.toMatch(/@local\.test/);

  // The budget is typed in major units and stored in integer minor units.
  const budget = panel.getByTestId('marketing-budget-form');
  await budget.getByLabel('Budget line').fill(`Playlist pitching ${run}`);
  await budget.getByLabel('Amount').fill('1,250.50');
  await budget.getByRole('button', { name: 'Add' }).click();
  await expect.poll(async () => ((await rest(request, 'GET', 'marketing_budget_lines?select=id')) as unknown[]).length, { timeout: 30_000 }).toBe(1);
  const lines = (await rest(request, 'GET', 'marketing_budget_lines?select=amount_minor,currency,status')) as { amount_minor: number | string; currency: string; status: string }[];
  expect(lines).toEqual([{ amount_minor: 125050, currency: 'USD', status: 'planned' }]);
  await expect(panel.getByTestId('marketing-budget-totals')).toContainText('1250.50 USD');
  await page.screenshot({ path: `${shots}/marketing-member-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  await page.screenshot({ path: `${shots}/marketing-member-390.png`, fullPage: true });
  await ctx.close();
});

test('2 · the artist sees the plan and the ask, never the budget; the A&R member can edit the timeline but not read a budget', async ({ browser, baseURL, request }) => {
  const a = await as(browser, baseURL!, artist.id, artist.email);
  const page = await a.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.release}`);
  const panel = page.getByTestId('marketing-plan');
  await expect(panel).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText(`Snippet on socials ${run}`)).toBeVisible();
  await expect(panel.getByTestId('marketing-assets')).toContainText('Photos');
  await expect(panel.getByTestId('marketing-budget')).toHaveCount(0);
  await expect(panel.getByTestId('marketing-milestone-form')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/artist-1440.png`, fullPage: true });
  const body = await (await a.request.get(marketingApi())).text();
  expect(Object.keys(JSON.parse(body))).not.toContain('budget');
  expect(body).not.toMatch(/amount|Playlist pitching|125050|1250/i);
  expect((await a.request.post(`${marketingApi()}/budget`, { data: { label: 'x', amount_minor: '1', currency: 'USD' } })).status()).toBe(403);
  expect((await a.request.post(`${marketingApi()}/items`, { data: { phase: 'post', title: 'x', due_on: '2026-12-20' } })).status()).toBe(403);
  // Their bell holds the ask and links to the release.
  const bell = await (await a.request.get(`${api}/notifications`)).json();
  expect(JSON.stringify(bell)).toContain('asset_requested');
  await a.close();

  const b = await as(browser, baseURL!, aAndR.id, aAndR.email);
  const view = await (await b.request.get(marketingApi())).json();
  expect(view.me).toMatchObject({ canWrite: true, canWriteBudget: false });
  expect('budget' in view).toBe(false);
  expect((await b.request.post(`${marketingApi()}/items`, { data: { phase: 'post', title: `Wrap-up ${run}`, due_on: '2026-12-20' } })).status()).toBe(201);
  expect((await b.request.post(`${marketingApi()}/budget`, { data: { label: 'x', amount_minor: '1', currency: 'USD' } })).status()).toBe(403);
  await b.close();
  expect(((await rest(request, 'GET', 'marketing_budget_lines?select=id')) as unknown[]).length).toBe(1);
});

test('3 · D4: the marketing member cannot reach the working demo, and no plan payload names a recording', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, marketing.id, marketing.email);
  for (const variant of ['preview', 'full', 'wav']) {
    const res = await ctx.request.get(`${api}/audio/${DEMO}?variant=${variant}`);
    expect([403, 404], `${variant} -> ${res.status()}`).toContain(res.status());
  }
  const plan = await (await ctx.request.get(marketingApi())).text();
  expect(plan).not.toContain(DEMO);
  expect(plan).not.toContain(SONG);
  expect(plan).not.toMatch(/audio_url|r2:\/\/|\/uploads\/|\.mp3|\.wav/);
  await ctx.close();
});

test('4 · the owner switches the plan requirement on in the UI; the marketing gate then asks for it, derived on every read', async ({ browser, baseURL, request }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const readiness = async (release: string) => (await (await ctx.request.get(`${api}/releases/${release}/readiness`)).json()).readiness.gates.marketing as { status: string; blockers: { code: string }[] };

  // A second release with no plan at all.
  const second = await ctx.request.post(`${api}/releases`, { data: { title: `Plain Single ${run}`, contact_id: NOVA, type: 'single' } });
  expect(second.status()).toBe(201);
  ids.plain = (await second.json()).release.id;

  // Off by default: neither release is asked for a plan.
  expect((await readiness(ids.plain)).blockers).toEqual([]);
  expect((await readiness(ids.release)).blockers).toEqual([]);

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/releases/${ids.plain}`);
  const toggle = page.getByTestId('marketing-plan-required');
  await expect(toggle).toBeVisible({ timeout: 90_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('marketing-plan-gate-note')).toContainText('Still needed: a teaser and a release milestone');
  await page.screenshot({ path: `${shots}/gate-required-1440.png`, fullPage: true });

  // The release with no plan is blocked; the planned one (a teaser and a release item) is not.
  expect((await readiness(ids.plain)).blockers.map((b) => b.code)).toEqual(['no_plan']);
  expect((await readiness(ids.plain)).status).toBe('blocked');
  expect((await readiness(ids.release)).blockers).toEqual([]);

  // Removing the release-day item blocks it again — no stored state to go stale.
  const items = (await rest(request, 'GET', `marketing_plan_items?select=id,phase&phase=eq.release`)) as { id: string }[];
  const del = await ctx.request.delete(`${marketingApi()}/items/${items[0].id}`);
  expect(del.status()).toBe(200);
  expect((await readiness(ids.release)).blockers.map((b) => b.code)).toEqual(['plan_missing_release']);

  // A repeat switch and a non-owner: the member cannot flip it.
  const m = await as(browser, baseURL!, marketing.id, marketing.email);
  expect((await m.request.put(`${api}/settings/marketing-plan`, { data: { required: false } })).status()).toBe(403);
  await m.close();

  // Off again: back to exactly how gates were.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
  expect((await readiness(ids.plain)).blockers).toEqual([]);
  const events = (await rest(request, 'GET', `activity_events?select=verb,audit,visibility,payload&verb=eq.marketing_plan.requirement_changed&org_id=eq.${ORG}&order=created_at`)) as { audit: boolean; visibility: string; payload: Record<string, unknown> }[];
  expect(events.map((e) => e.payload)).toEqual([{ from: false, to: true }, { from: true, to: false }]);
  expect(events.every((e) => e.audit && e.visibility === 'internal')).toBe(true);
  await ctx.close();
});

test('5 · the calendar feed carries the milestones: a summary and a day, nothing else', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, marketing.id, marketing.email);
  const issued = await ctx.request.post(`${api}/calendar/feed`);
  expect(issued.status(), await issued.text()).toBe(200);
  const { path } = await issued.json();
  const feed = await browser.newContext();
  const ics = await (await feed.request.get(`${baseURL}${path}`)).text();
  expect(ics).toContain(`SUMMARY:Teaser: Snippet on socials ${run} · Night Shift ${run}`);
  expect(ics).toContain('DTSTART;VALUE=DATE:20261120');
  expect(ics).toContain(`Post: Wrap-up ${run}`);
  expect(ics).not.toMatch(/Playlist pitching|1250|DESCRIPTION|Two press shots/);
  await feed.close();
  await ctx.close();
});

test('6 · events carry ids and field names only — no title, note or amount — and the budget ones are internal', async ({ request }) => {
  const events = (await rest(request, 'GET', `activity_events?select=verb,visibility,payload,release_id,artist_id&org_id=eq.${ORG}&verb=like.marketing_plan.*&order=created_at`)) as { verb: string; visibility: string; payload: Record<string, unknown>; release_id: string }[];
  const verbs = new Set(events.map((e) => e.verb));
  for (const v of ['marketing_plan.created', 'marketing_plan.item_changed', 'marketing_plan.platform_changed', 'marketing_plan.budget_changed', 'marketing_plan.asset_requested', 'marketing_plan.requirement_changed']) expect(verbs.has(v), v).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/Snippet|Drop day|Wrap-up|Playlist pitching|press shots|125050|1250/i);
  for (const e of events.filter((x) => x.verb === 'marketing_plan.budget_changed')) expect(e.visibility).toBe('internal');
  expect(events.filter((e) => e.verb === 'marketing_plan.created')).toHaveLength(1);
});

test('7 · another org’s owner and a signed-out caller reach nothing', async ({ browser, baseURL, request }) => {
  const anon = await browser.newContext();
  expect((await anon.request.get(`${baseURL}${marketingApi()}`)).status()).toBe(401);
  await anon.close();
  // The seed buyer in a different org has no membership here.
  const other = randomUUID();
  await rest(request, 'POST', 'organizations', { id: other, name: `Other ${run}`, slug: `other-${run}`, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: other, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null });
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const res = await owner.request.get(`/api/org/${other}/releases/${ids.release}/marketing`);
  expect(res.status()).toBe(404);
  await owner.close();
  await rest(request, 'DELETE', `organizations?id=eq.${other}`);
});
