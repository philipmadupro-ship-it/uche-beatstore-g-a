/**
 * The Label OS shell and members page (LABEL-09) end to end against a REAL
 * database (scripts/local-db, LABEL_OS_ENABLED=true from env.sh), at 1440
 * and 390 wide.
 *
 * The producer owns a producer org (their studio) and a label org; the seed
 * BUYER is a member of the label. On the label's members page the producer
 * renames the org in place, changes the buyer's functions, role and single
 * abilities, invites and revokes, cannot remove or demote the last owner,
 * then removes the buyer. The buyer, a member who is not the producer, gets
 * the shell without producer chrome, reads the list without emails and
 * cannot change anything. With two orgs the producer sees the switcher on
 * the dashboard; with one the buyer does not.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const STUDIO = randomUUID();
const STUDIO_NAME = `Uche Studio ${run}`;

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

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

async function confirm(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
}

test.beforeAll(async ({ request }) => {
  // The buyer starts in no org, so "one org → no switcher" is what is tested
  // (an aborted earlier run may have left a membership behind).
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: STUDIO, name: STUDIO_NAME, slug: `uche-studio-${run}`, kind: 'producer', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: STUDIO, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'DELETE', `user_profiles?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'user_profiles', { user_id: BUYER_ID, display_name: 'Dana Buyer' });
});

for (const width of [1440, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width > 500 ? 900 : 844 } });

    const ORG = randomUUID();
    const NAME = `Night Shift ${run} ${width}`;
    const SLUG = `night-shift-${run}-${width}`;
    const MEMBERS = `/o/${SLUG}/settings/members`;

    test.beforeAll(async ({ request }) => {
      await rest(request, 'POST', 'organizations', { id: ORG, name: NAME, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
      await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
      await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['a_and_r'], scope: 'org', invited_by: PRODUCER_ID });
    });

    test('the producer: switcher on the dashboard, members page, rename, functions, role, abilities', async ({ browser, baseURL }) => {
      const ctx = await browser.newContext();
      await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
      const page = await ctx.newPage();

      // Two orgs: the switcher shows on the dashboard, naming the studio
      // (its home is the dashboard) and linking to the label's shell.
      await page.goto('/library');
      // (Earlier runs against the same database leave other studios behind;
      // a real producer owns exactly one, migration 137.)
      const switcher = page.getByRole('button', { name: /Organization: Uche Studio/ });
      await expect(switcher).toBeVisible({ timeout: 30_000 });
      if (width < 500) {
        // The switcher must not push the menu button off a phone's screen.
        const menu = await page.getByRole('button', { name: 'Open navigation menu' }).boundingBox();
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
      await switcher.click();
      const orgs = page.getByRole('navigation', { name: 'Organizations' });
      await expect(orgs.getByRole('link', { name: new RegExp(NAME) })).toHaveAttribute('href', `/o/${SLUG}`);
      await orgs.getByRole('link', { name: new RegExp(NAME) }).click();

      // /o/<slug> is the Overview (LABEL-18); the members page is one step on.
      await expect(page).toHaveURL(new RegExp(`/o/${SLUG}$`), { timeout: 30_000 }); // first compile in dev
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(`Organization: ${NAME}`) })).toBeVisible();
      await page.goto(MEMBERS);
      await expect(page.getByRole('heading', { name: '2 members' })).toBeVisible();
      const me = page.getByTestId(`member-${PRODUCER_ID}`);
      const dana = page.getByTestId(`member-${BUYER_ID}`);
      await expect(me).toContainText('You');
      await expect(dana).toContainText('Dana Buyer');
      await expect(dana).toContainText('A&R');

      // Rename in place.
      await page.getByRole('button', { name: /Organization name/ }).click();
      const field = page.getByRole('textbox', { name: 'Organization name' });
      await field.fill(`${NAME} Records`);
      await field.press('Enter');
      await expect(page.getByRole('button', { name: new RegExp(`Organization: ${NAME} Records`) })).toBeVisible();
      await page.reload();
      await expect(page.getByText(`${NAME} Records`).first()).toBeVisible();
      const [org] = await rest(page.request, 'GET', `organizations?id=eq.${ORG}&select=name,slug`);
      expect(org).toEqual({ name: `${NAME} Records`, slug: SLUG });

      // Functions, from the row's ⋯ menu.
      await dana.getByRole('button', { name: 'Actions for Dana Buyer' }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Marketing' }).click();
      await expect(dana).toContainText('Marketing');
      await page.keyboard.press('Escape');
      let [row] = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}&select=role,functions,cap_revokes`);
      expect(row).toEqual({ role: 'member', functions: ['a_and_r', 'marketing'], cap_revokes: [] });

      // One ability off, from the abilities popover.
      await dana.getByRole('button', { name: 'Abilities' }).click();
      await page.getByRole('switch', { name: /Rate and review/ }).click();
      await expect(page.getByRole('switch', { name: /Rate and review/ })).toHaveAttribute('aria-checked', 'false');
      await page.keyboard.press('Escape');
      await expect(dana.getByRole('button', { name: 'Abilities · 1 changed' })).toBeVisible();
      [row] = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}&select=cap_revokes`);
      expect(row.cap_revokes).toEqual(['review.write']);

      // Role, from the dropdown: admin and back.
      await dana.getByRole('button', { name: 'Role of Dana Buyer' }).click();
      await page.getByRole('option', { name: 'Admin' }).click();
      await expect(dana.getByRole('button', { name: 'Role of Dana Buyer' })).toContainText('Admin');
      [row] = await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}&select=role,functions,cap_revokes`);
      expect(row).toEqual({ role: 'admin', functions: [], cap_revokes: [] });
      await dana.getByRole('button', { name: 'Role of Dana Buyer' }).click();
      await page.getByRole('option', { name: 'Member' }).click();
      await expect(dana.getByRole('button', { name: 'Role of Dana Buyer' })).toContainText('Member');

      const events = await rest(page.request, 'GET', `activity_events?org_id=eq.${ORG}&select=verb,audit&order=created_at`);
      // One audit event per change.
      expect(events).toEqual([
        { verb: 'org.settings_changed', audit: true },
        { verb: 'member.capabilities_changed', audit: true },
        { verb: 'member.capabilities_changed', audit: true },
        { verb: 'member.role_changed', audit: true },
        { verb: 'member.role_changed', audit: true },
      ]);

      // The last owner: nothing offered, and the routes answer 409.
      await expect(me.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
      await expect(me.getByRole('button', { name: /Role of/ })).toHaveCount(0);
      const demote = await page.request.patch(`/api/org/${ORG}/members`, { data: { user_id: PRODUCER_ID, role: 'admin' } });
      expect(demote.status()).toBe(409);
      expect((await page.request.delete(`/api/org/${ORG}/members?user_id=${PRODUCER_ID}`)).status()).toBe(409);
      await ctx.close();
    });

    test('the buyer, a member who is not the producer: the shell without producer chrome, read-only', async ({ browser, baseURL }) => {
      const ctx = await browser.newContext();
      await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
      const page = await ctx.newPage();
      const producerCalls: string[] = [];
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (/^\/api\/(notifications|tracks|profile|tags|search)/.test(u.pathname)) producerCalls.push(u.pathname);
      });

      await page.goto(MEMBERS);
      await expect(page.getByTestId(`member-${BUYER_ID}`)).toContainText('You');
      // One org, nothing shared: no switcher. Not the producer: no bell, no
      // storefront, settings or profile links, no producer hubs.
      await expect(page.getByRole('button', { name: /Organization:/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Search/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Open settings' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Invite' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
      expect(producerCalls).toEqual([]);

      const list = await (await page.request.get(`/api/org/${ORG}/members`)).json();
      expect(list.members.every((m: { email: unknown }) => m.email === null)).toBe(true);
      expect((await page.request.patch(`/api/org/${ORG}/members`, { data: { user_id: BUYER_ID, role: 'admin' } })).status()).toBe(403);
      expect((await page.request.patch(`/api/org/${ORG}`, { data: { name: 'Mine now' } })).status()).toBe(403);
      // Still not a producer anywhere else.
      expect((await page.request.get('/api/tracks')).status()).toBe(403);
      await ctx.close();
    });

    test('the producer invites and revokes, then removes the buyer', async ({ browser, baseURL }) => {
      const ctx = await browser.newContext();
      await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
      const page = await ctx.newPage();
      await page.goto(MEMBERS);

      const email = `engineer-${run}-${width}@local.test`;
      await page.getByRole('button', { name: 'Invite' }).click();
      const dialog = page.getByRole('dialog', { name: 'Invite to organization' });
      await dialog.getByLabel('Email address').fill(email);
      await dialog.getByRole('button', { name: 'Engineer' }).click();
      await dialog.getByRole('button', { name: 'Send invitation' }).click();
      await expect(dialog.getByRole('status')).toContainText(`Invitation created for ${email}`);
      await dialog.getByRole('button', { name: 'Done' }).click();

      const pending = page.getByRole('region', { name: 'Pending invitations' }).or(page.locator('section[aria-labelledby="invitations-heading"]'));
      await expect(pending).toContainText(email);
      await expect(pending).toContainText('Member · Engineer');
      await page.getByRole('button', { name: `Invitation to ${email}` }).click();
      await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
      await confirm(page, 'Revoke');
      await expect(page.getByText(email)).toHaveCount(0);
      const [inv] = await rest(page.request, 'GET', `org_invitations?org_id=eq.${ORG}&email=eq.${email}&select=revoked_at`);
      expect(inv.revoked_at).not.toBeNull();

      const dana = page.getByTestId(`member-${BUYER_ID}`);
      await dana.getByRole('button', { name: 'Actions for Dana Buyer' }).click();
      await page.getByRole('menuitem', { name: 'Remove from organization' }).click();
      await confirm(page, 'Remove');
      await expect(dana).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '1 member' })).toBeVisible();
      expect(await rest(page.request, 'GET', `org_members?org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`)).toEqual([]);
      const events = await rest(page.request, 'GET', `activity_events?org_id=eq.${ORG}&verb=eq.member.removed&select=verb,audit,subject_id`);
      expect(events).toEqual([{ verb: 'member.removed', audit: true, subject_id: BUYER_ID }]);

      // Removed, the buyer is out of the org on the next request.
      const buyer = await browser.newContext();
      await signedIn(buyer, baseURL!, BUYER_ID, 'buyer@local.test');
      const bp = await buyer.newPage();
      const res = await bp.goto(MEMBERS);
      expect(res?.url()).not.toContain('/o/');
      await buyer.close();
      await ctx.close();
    });
  });
}
