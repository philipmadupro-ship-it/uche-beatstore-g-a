/**
 * Organization settings (LABEL-51, migration 172) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true from env.sh).
 *
 * Proven in a browser against RLS-backed Postgres, with no setting written by
 * the service key (the key only creates the org, its people and one release):
 *  - only the owner sees Settings in the nav and can use the page; an admin
 *    (every capability) and a member are told so, and the route answers 403;
 *  - the owner switches legal approval off through the page (after a
 *    confirmation), the stored row says so, ONE `org.settings_changed` audit
 *    event names the key, and the release page shows the skip banner;
 *  - the owner switches a department off within the licence: its route
 *    answers 404 for an admin from the next request, and back on restores it;
 *  - the producer dashboard and /store are untouched.
 *
 * Cast: PRODUCER owns the label; ARTIST_A is admin; BUYER is a member.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { ANON_KEY, ARTIST_A_ID, BUYER_ID, PRODUCER_ID, SERVICE_KEY, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const NOVA = randomUUID();
const NOVA_INBOX = randomUUID();
const SLUG = `settings-${run}`;
const PAGE = `/o/${SLUG}/settings/organization`;
const api = `/api/org/${ORG}`;
const SHOTS = 'e2e-artifacts/LABEL-51';
const ids: Record<string, string> = {};

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

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

/** Click Save and wait for the PATCH itself, not for a toast (an earlier toast may still be on screen). */
async function saveAndWait(page: Page) {
  const saved = page.waitForResponse((r) => r.url().includes('/settings') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: /save settings/i }).click();
  expect((await saved).status()).toBe(200);
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const settingsRow = async (request: APIRequestContext) =>
  ((await rest(request, 'GET', `organizations?id=eq.${ORG}&select=settings`)) as { settings: Record<string, unknown> }[])[0].settings;
const settingsEvents = async (request: APIRequestContext) =>
  (await rest(request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.org.settings_changed&select=audit,visibility,actor_id,payload&order=created_at`)) as {
    audit: boolean; visibility: string; actor_id: string; payload: { keys: string[]; changes: Record<string, { from: unknown; to: unknown }> };
  }[];

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID].join(',')})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Settings Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'admin', functions: [], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', { id: NOVA_INBOX, org_id: ORG, user_id: null, name: `Inbox · Nova ${run}`, inbox_for_contact_id: NOVA });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID].join(',')})`);
});

test('1 · only the owner: an admin and a member are told so and refused by the route', async ({ browser, baseURL, request }) => {
  for (const who of [
    { id: ARTIST_A_ID, email: 'artist-a@local.test', name: 'admin' },
    { id: BUYER_ID, email: 'buyer@local.test', name: 'member' },
  ]) {
    const ctx = await browser.newContext();
    await signedIn(ctx, baseURL!, who.id, who.email);
    const page = await ctx.newPage();
    await page.goto(PAGE);
    await expect(page.getByTestId('settings-denied'), who.name).toBeVisible();
    await expect(page.getByTestId('org-settings'), who.name).toHaveCount(0);
    expect((await ctx.request.get(`${api}/settings`)).status(), who.name).toBe(403);
    const patch = await ctx.request.patch(`${api}/settings`, { data: { legal_gate: 'off' } });
    expect(patch.status(), who.name).toBe(403);
    await ctx.close();
  }
  expect(await settingsEvents(request)).toEqual([]);
});

test('2 · the owner sees Settings in the nav and the form with the defaults', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeAttached();
  await page.goto(PAGE);
  await expect(page.getByTestId('org-settings')).toBeVisible();
  await expect(page.getByLabel('Require legal approval')).toBeChecked();
  await expect(page.getByLabel('Require marketing approval')).toBeChecked();
  await expect(page.getByLabel('Require a signed master split')).not.toBeChecked();
  await expect(page.getByRole('button', { name: /save settings/i })).toBeDisabled();
  await shot(page, 'settings-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'settings-390');
  await ctx.close();
});

test('3 · ACCEPTANCE: the owner turns legal approval off on the page; one audit event names the key; the release page says so', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const rel = await ctx.request.post(`${api}/releases`, { data: { title: `Skip Single ${run}`, contact_id: NOVA, type: 'single' } });
  expect(rel.status(), await rel.text()).toBe(201);
  ids.release = (await rel.json()).release.id;

  const before = await ctx.newPage();
  await before.goto(`/o/${SLUG}/releases/${ids.release}`);
  await expect(before.getByTestId('release-detail')).toBeVisible();
  await expect(before.getByTestId('release-gate-skipped')).toHaveCount(0);

  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.getByLabel('Require legal approval').uncheck();
  await page.getByRole('button', { name: /save settings/i }).click();
  // The pause: declining sends nothing.
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await settingsRow(request)).not.toHaveProperty('legal_gate', 'off');
  await page.getByRole('button', { name: /save settings/i }).click();
  await page.getByRole('button', { name: 'Skip legal approval' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  expect(await settingsRow(request)).toMatchObject({ legal_gate: 'off' });
  const events = await settingsEvents(request);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ audit: true, visibility: 'internal', actor_id: PRODUCER_ID });
  expect(events[0].payload.keys).toEqual(['legal_gate']);
  expect(events[0].payload.changes.legal_gate).toEqual({ from: 'on', to: 'off' });

  await page.goto(`/o/${SLUG}/releases/${ids.release}`);
  const banner = page.getByTestId('release-gate-skipped');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Legal approval is switched off');
  await expect(banner).toContainText('Credits & splits still gate');
  await shot(page, 'release-skip-banner-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'release-skip-banner-390');

  // And it survives a reload of the settings page, back to "on" through the page too.
  await page.goto(PAGE);
  await expect(page.getByLabel('Require legal approval')).not.toBeChecked();
  await page.getByLabel('Require legal approval').check();
  await saveAndWait(page);
  expect(await settingsRow(request)).toMatchObject({ legal_gate: 'on' });
  expect(await settingsEvents(request)).toHaveLength(2);
  await ctx.close();
});

test('4 · CONTRACTS: off needs legal approval off; then the department vanishes (routes AND restricted files on the member’s own JWT) and comes back', async ({ browser, baseURL, request }) => {
  // A member who holds contracts.read (the legal function) and two restricted files in a project of the org.
  await rest(request, 'PATCH', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`, { functions: ['legal'] });
  await rest(request, 'POST', 'project_assets', [
    { user_id: null, created_by: PRODUCER_ID, project_id: NOVA_INBOX, kind: 'contract', sensitivity: 'restricted', url: 'r2://private/orgs/e2e/assets/contract' },
    { user_id: null, created_by: PRODUCER_ID, project_id: NOVA_INBOX, kind: 'artwork', sensitivity: 'normal', url: 'r2://private/orgs/e2e/assets/art' },
  ]);
  // The member's own session on PostgREST: RLS decides, no service key.
  const restricted = async () => {
    const res = await request.get(`${REST}/project_assets?select=kind&project_id=eq.${NOVA_INBOX}&sensitivity=neq.normal`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { kind: string }[]).length;
  };
  const ordinary = async () => {
    const res = await request.get(`${REST}/project_assets?select=kind&project_id=eq.${NOVA_INBOX}&sensitivity=eq.normal`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
    });
    return ((await res.json()) as unknown[]).length;
  };

  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signedIn(owner, baseURL!, PRODUCER_ID, 'producer@local.test');
  const member = await browser.newContext();
  await signedIn(member, baseURL!, BUYER_ID, 'buyer@local.test');
  expect((await member.request.get(`${api}/legal/queue`)).status()).toBe(200);
  expect(await restricted()).toBe(1);

  const page = await owner.newPage();
  await page.goto(PAGE);
  // Legal approval is on: Contracts cannot go off alone. The page says why and Save stays disabled.
  await page.getByLabel('Contracts & legal').uncheck();
  await expect(page.getByTestId('contracts-legal-warning')).toContainText('legal approval');
  await expect(page.getByRole('button', { name: /save settings/i })).toBeDisabled();
  // The route refuses it too.
  const refused = await owner.request.patch(`${api}/settings`, { data: { departments_off: ['contracts'] } });
  expect(refused.status()).toBe(422);
  expect(await member.request.get(`${api}/legal/queue`).then((r) => r.status())).toBe(200);

  // Both off in one save (the legal skip asks first).
  await page.getByLabel('Require legal approval').uncheck();
  await expect(page.getByTestId('contracts-legal-warning')).toHaveCount(0);
  await page.getByRole('button', { name: /save settings/i }).click();
  await page.getByRole('button', { name: 'Skip legal approval' }).click();
  await expect(page.getByText('Settings saved').first()).toBeVisible();
  await expect.poll(async () => (await settingsRow(request)).departments_off).toEqual(['contracts']);
  expect(await settingsRow(request)).toMatchObject({ legal_gate: 'off' });
  expect((await member.request.get(`${api}/legal/queue`)).status()).toBe(404);
  expect(await restricted()).toBe(0);
  expect(await ordinary()).toBe(1);
  await shot(page, 'contracts-off-1440');

  // Legal approval cannot come back on while Contracts is off (the route says so); switch Contracts on first.
  const lockedOn = await owner.request.patch(`${api}/settings`, { data: { legal_gate: 'on' } });
  expect(lockedOn.status()).toBe(422);
  await page.getByLabel('Contracts & legal').check();
  await saveAndWait(page);
  expect((await member.request.get(`${api}/legal/queue`)).status()).toBe(200);
  expect(await restricted()).toBe(1);
  // An unknown / non-switchable department is refused.
  expect((await owner.request.patch(`${api}/settings`, { data: { departments_off: ['export'] } })).status()).toBe(400);

  // Put legal approval back on, through the page.
  await page.goto(PAGE);
  await page.getByLabel('Require legal approval').check();
  await saveAndWait(page);
  expect(await settingsRow(request)).toMatchObject({ legal_gate: 'on' });
  await owner.close();
  await member.close();
});

test('5 · the producer dashboard and /store are untouched', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  expect((await page.goto('/library'))!.status()).toBeLessThan(400);
  expect((await page.goto('/store'))!.status()).toBeLessThan(400);
  await ctx.close();
});
