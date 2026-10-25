/**
 * The "Team and roster" window (LABEL-50) end to end against a REAL database
 * (scripts/local-db, LABEL_OS_ENABLED=true from env.sh). Only the orgs, their
 * owners and one project are seeded; everything under test is done through
 * the window: add an artist (with a login invitation), a team login limited
 * to that artist, an invitation, a collaborator invited to a project; then
 * edit and remove each of them. A member limited to one artist signs in and
 * sees only that artist; the independent face says "Your collaborators" and
 * has no roster to add to.
 *
 * Screenshots: e2e-artifacts/LABEL-50/ (not committed).
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, ARTIST_A_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const AUTH = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
const run = randomUUID().slice(0, 6);
const LABEL = randomUUID();
const SOLO = randomUUID();
const PROJECT = randomUUID();
const SLUG = `roster-win-${run}`;
const SOLO_SLUG = `solo-win-${run}`;
const PROJECT_NAME = `Night Shift ${run}`;
const NOVA = `Nova ${run}`;
const KAI = `Kai ${run}`;
const REX = `Rex ${run}`;
const SCOPED_EMAIL = `ar-${run}@label.test`;
const SCOPED_NAME = `Ari ${run}`;
const OWN_PASSWORD = `my-own-secret-${run}`;
const SHOTS = 'e2e-artifacts/LABEL-50';

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let issued = '';
let scopedId = '';

async function rest(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${path}`, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function signedIn(browser: import('@playwright/test').Browser, baseURL: string, id: string, email: string, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } });
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'organizations', [
    { id: LABEL, name: `Roster Window ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID },
    { id: SOLO, name: `Solo Window ${run}`, slug: SOLO_SLUG, kind: 'artist', created_by: ARTIST_A_ID },
  ]);
  await rest(request, 'POST', 'org_members', [
    { org_id: LABEL, user_id: PRODUCER_ID, role: 'owner', scope: 'org' },
    { org_id: SOLO, user_id: ARTIST_A_ID, role: 'owner', scope: 'org' },
  ]);
  await rest(request, 'POST', 'projects', { id: PROJECT, org_id: LABEL, user_id: null, name: PROJECT_NAME });
});

test.afterAll(async ({ request }) => {
  await request.fetch(`${REST}/organizations?id=in.(${LABEL},${SOLO})`, { method: 'DELETE', headers: AUTH });
  if (scopedId) await request.fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${scopedId}`, { method: 'DELETE', headers: AUTH });
});

test('1 · the owner adds an artist, a limited login, an invitation and a collaborator in one window', async ({ browser, baseURL, request }) => {
  const ctx = await signedIn(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);
  await expect(page.getByText(/Team and roster$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add artist' })).toBeVisible();

  // An artist, with a login invitation (needs an address).
  await page.getByRole('button', { name: 'Add artist' }).click();
  await page.getByLabel('Artist name').fill(NOVA);
  await expect(page.getByRole('checkbox', { name: 'Invite artist 1 to sign in' })).toBeDisabled();
  await page.getByLabel('Email (optional)').fill(`nova-${run}@artists.test`);
  await page.getByRole('checkbox', { name: 'Invite artist 1 to sign in' }).check();
  await page.getByRole('button', { name: 'Add artist' }).click();
  await page.getByLabel('Artist name').nth(1).fill(KAI);

  // A team login limited to Nova (a limited member must name an artist).
  await page.getByRole('button', { name: 'Add a person' }).click();
  const person1 = page.getByTestId('team-row').nth(0);
  await person1.getByLabel('Email address').fill(SCOPED_EMAIL);
  await person1.getByRole('button', { name: 'Function of person 1' }).click();
  await page.getByRole('option', { name: 'A&R' }).click();
  await person1.getByRole('radio', { name: 'Selected artists' }).click();
  await expect(page.getByRole('button', { name: 'Add to the organization' })).toBeVisible();
  await expect(page.getByTestId('team-add-problems')).toContainText('choose at least one artist');
  await expect(page.getByRole('button', { name: 'Add to the organization' })).toBeDisabled();
  await person1.getByRole('switch', { name: NOVA }).click();
  await person1.getByRole('radio', { name: 'Create their login' }).click();
  await person1.getByLabel('Their name').fill(SCOPED_NAME);

  // A plain invitation for the whole organization.
  await page.getByRole('button', { name: 'Add a person' }).click();
  const person2 = page.getByTestId('team-row').nth(1);
  await person2.getByLabel('Email address').fill(`eng-${run}@label.test`);
  await person2.getByRole('button', { name: 'Function of person 2' }).click();
  await page.getByRole('option', { name: 'Engineer' }).click();

  // A collaborator invited to one project.
  await page.getByRole('button', { name: 'Add collaborator' }).click();
  await page.getByRole('radio', { name: 'Rapper' }).click();
  await page.getByLabel('Collaborator name').fill(REX);
  await page.getByLabel('Collaborator email (optional)').fill(`rex-${run}@guest.test`);
  await page.getByRole('button', { name: 'Project for collaborator 1' }).click();
  await page.getByRole('option', { name: PROJECT_NAME }).click();
  await page.getByRole('button', { name: 'Project role of collaborator 1' }).click();
  await page.getByRole('option', { name: 'Contributor' }).click();

  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/1440-add.png`, fullPage: true });
  await page.getByRole('button', { name: 'Add to the organization' }).click();

  await expect(page.getByTestId('team-add-results')).toBeVisible();
  await expect(page.getByTestId('result-ok')).toHaveCount(7);
  await expect(page.getByTestId('result-failed')).toHaveCount(0);
  issued = (await page.getByTestId('wizard-login-password').textContent())?.trim() ?? '';
  expect(issued).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
  await page.screenshot({ path: `${SHOTS}/1440-added.png`, fullPage: true });

  // The directory: Nova and Kai on the roster; Rex a collaborator, NOT on the roster.
  const roster = (await (await page.request.get(`/api/org/${LABEL}/contacts?view=roster`)).json()).contacts as { name: string }[];
  expect(roster.map((c) => c.name).sort()).toEqual([KAI, NOVA]);
  const contacts = (await rest(request, 'GET', `contacts?org_id=eq.${LABEL}&select=id,name,category,role&order=name`)) as { id: string; name: string; category: string; role: string | null }[];
  expect(contacts.find((c) => c.name === REX)).toMatchObject({ category: 'other', role: 'Rapper' });
  const nova = contacts.find((c) => c.name === NOVA)!;

  // The artist login invitation is role artist, limited to Nova; the project invitation is Rex's, on that project.
  const invitations = (await rest(request, 'GET', `org_invitations?org_id=eq.${LABEL}&select=email,role,functions,artist_ids,project_id,project_role`)) as {
    email: string; role: string; functions: string[]; artist_ids: string[]; project_id: string | null; project_role: string | null;
  }[];
  expect(invitations.find((i) => i.email === `nova-${run}@artists.test`)).toMatchObject({ role: 'artist', artist_ids: [nova.id], project_id: null });
  expect(invitations.find((i) => i.email === `eng-${run}@label.test`)).toMatchObject({ role: 'member', functions: ['engineer'], artist_ids: [] });
  expect(invitations.find((i) => i.email === `rex-${run}@guest.test`)).toMatchObject({ project_id: PROJECT, project_role: 'contributor' });

  // The login is a member limited to Nova, and the org made the account.
  const members = (await rest(request, 'GET', `org_members?org_id=eq.${LABEL}&role=eq.member&select=user_id,functions,scope`)) as { user_id: string; functions: string[]; scope: string }[];
  expect(members).toHaveLength(1);
  expect(members[0]).toMatchObject({ functions: ['a_and_r'], scope: 'artists' });
  scopedId = members[0].user_id;
  const scope = (await rest(request, 'GET', `member_artist_scopes?org_id=eq.${LABEL}&user_id=eq.${scopedId}&select=contact_id`)) as { contact_id: string }[];
  expect(scope).toEqual([{ contact_id: nova.id }]);
  const events = (await rest(request, 'GET', `activity_events?org_id=eq.${LABEL}&verb=eq.member.account_created&select=payload`)) as unknown[];
  expect(JSON.stringify(events)).not.toContain(issued);

  // The same window at a phone width: the lists are there and nothing overflows.
  await page.reload();
  await expect(page.getByTestId('roster-heading')).toContainText(NOVA);
  await expect(page.getByTestId('roster-heading')).toContainText(KAI);
  await expect(page.getByTestId('collaborators-heading')).toContainText(REX);
  await expect(page.getByTestId('collaborators-heading')).not.toContainText(NOVA);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/390-owner.png`, fullPage: true });
  await ctx.close();
});

test('2 · the member limited to one artist signs in and sees only that artist', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email Address').fill(SCOPED_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(issued);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('New password').fill(OWN_PASSWORD);
  await expect(page.getByLabel('New password')).toHaveValue(OWN_PASSWORD);
  await page.getByLabel('Type it again').fill(OWN_PASSWORD);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}`));

  await page.goto(`/o/${SLUG}/artists`);
  await expect(page.getByText(NOVA).first()).toBeVisible();
  await expect(page.getByText(KAI)).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/390-scoped-artists.png`, fullPage: true });

  // The window for a member who cannot manage people and sees only some artists: nothing to add, nobody else in the directory.
  await page.goto(`/o/${SLUG}/settings/members`);
  await expect(page.getByRole('heading', { name: /member/ }).first()).toBeVisible();
  await expect(page.getByTestId('team-add')).toHaveCount(0);
  await expect(page.getByText(KAI)).toHaveCount(0);
  await expect(page.getByTestId('collaborators-heading')).not.toContainText(REX);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SHOTS}/1440-scoped-members.png`, fullPage: true });
  await ctx.close();
});

test('3 · the owner renames and removes each kind of person; the last owner cannot go', async ({ browser, baseURL, request }) => {
  const ctx = await signedIn(browser, baseURL!, PRODUCER_ID, 'producer@local.test');
  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/settings/members`);

  // Rename Kai in place (the roster's direct edit).
  await page.getByRole('button', { name: `Name of ${KAI}` }).click();
  const input = page.getByRole('textbox', { name: `Name of ${KAI}` });
  await input.fill(`${KAI} Jr`);
  await input.press('Enter');
  await expect(page.getByTestId('roster-heading')).toContainText(`${KAI} Jr`);
  expect(((await rest(request, 'GET', `contacts?org_id=eq.${LABEL}&name=eq.${encodeURIComponent(`${KAI} Jr`)}&select=id`)) as unknown[]).length).toBe(1);

  const confirm = (label: string) => page.getByRole('button', { name: label, exact: true }).click();

  // Remove a collaborator.
  await page.getByRole('button', { name: `Actions for ${REX}` }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await confirm('Remove');
  await expect(page.getByTestId('collaborators-heading')).not.toContainText(REX);
  expect(await rest(request, 'GET', `contacts?org_id=eq.${LABEL}&name=eq.${encodeURIComponent(REX)}&select=id`)).toEqual([]);

  // Remove a roster artist.
  await page.getByRole('button', { name: `Actions for ${KAI} Jr` }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await confirm('Remove');
  await expect(page.getByTestId('roster-heading')).not.toContainText(KAI);

  // Revoke the engineer's invitation.
  await page.getByRole('button', { name: `Invitation to eng-${run}@label.test` }).click();
  await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
  await confirm('Revoke');
  await expect(page.getByText(`eng-${run}@label.test`)).toHaveCount(0);

  // Remove the limited member (planMemberRemoval; the list updates).
  const row = page.getByTestId(`member-${scopedId}`);
  await row.getByRole('button', { name: `Actions for ${SCOPED_NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Remove from organization' }).click();
  await confirm('Remove');
  await expect(row).toHaveCount(0);
  expect(await rest(request, 'GET', `org_members?org_id=eq.${LABEL}&user_id=eq.${scopedId}`)).toEqual([]);

  // The last owner is 409 from the route, and the page offers no way to try.
  const own = await page.request.delete(`/api/org/${LABEL}/members?user_id=${PRODUCER_ID}`);
  expect(own.status()).toBe(409);
  await page.getByTestId(`member-${PRODUCER_ID}`).getByRole('button', { name: /^Actions for/ }).count();
  await expect(page.getByRole('menuitem', { name: /Leave organization|Remove from organization/ })).toHaveCount(0);
  await ctx.close();
});

test('4 · the independent face: "Your collaborators", no roster to add to', async ({ browser, baseURL, request }) => {
  const ctx = await signedIn(browser, baseURL!, ARTIST_A_ID, 'artist-a@local.test', 390);
  const page = await ctx.newPage();
  await page.goto(`/o/${SOLO_SLUG}/settings/members`);

  await expect(page.getByRole('heading', { name: 'Your collaborators' })).toBeVisible();
  await expect(page.getByTestId('roster-solo-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add artist' })).toHaveCount(0);
  await expect(page.getByText(/roster/i)).toHaveCount(0);
  await expect(page.getByText('Team and collaborators').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add collaborator' }).click();
  await page.getByRole('radio', { name: 'Beatmaker' }).click();
  await page.getByLabel('Collaborator name').fill(`Beat ${run}`);
  await page.getByRole('button', { name: 'Add to the organization' }).click();
  await expect(page.getByTestId('result-ok')).toContainText('Added as a collaborator');
  await expect(page.getByTestId('collaborators-heading')).toContainText(`Beat ${run}`);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/390-independent.png`, fullPage: true });

  // An artist org keeps exactly one artist (D1): the route refuses a second whatever the page offers.
  const second = await page.request.post(`/api/org/${SOLO}/contacts`, { data: { name: 'Second artist', category: 'artist' } });
  expect([409, 403]).toContain(second.status());
  const beat = (await rest(request, 'GET', `contacts?org_id=eq.${SOLO}&name=eq.${encodeURIComponent(`Beat ${run}`)}&select=category,role`)) as unknown[];
  expect(beat).toEqual([{ category: 'producer', role: 'Beatmaker' }]);

  // The roster page says the same in its own words.
  await page.goto(`/o/${SOLO_SLUG}/artists`);
  await expect(page.getByRole('link', { name: 'your collaborators' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/o/${SOLO_SLUG}/settings/members`);
  await page.screenshot({ path: `${SHOTS}/1440-independent.png`, fullPage: true });
  await ctx.close();
});
