import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * Activity (DASH-01). /api/activity is stubbed with one row of every group, so
 * this covers the panel end to end in a real browser: group chips with counts
 * (a group with no rows has no chip), filtering, day headers, and a row link
 * landing on its subject. Signs in through the stub Supabase like the other
 * dashboard specs.
 */
const min = 60_000;
// A fixed anchor, pinned in the browser too: rows 30 h old are only "Yesterday" after 06:00 local,
// and before 01:30 rows 90 min old fall into yesterday as well, so the real clock made this flaky.
const NOW = new Date();
NOW.setHours(12, 0, 0, 0);
const ago = (m: number) => new Date(NOW.getTime() - m * min).toISOString();
const row = (id: string, kind: string, group: string, title: string, at: string, href: string | null, tone = 'neutral') =>
  ({ id, kind, group, tone, at, title, href });
const FEED = [
  row('n1', 'sale', 'sales', 'New sale — Night Shift ($29.00)', ago(5), '/sales', 'positive'),
  row('a1', 'artist_reaction', 'artists', 'Nova is interested in “Night Shift”', ago(20), '/contacts', 'positive'),
  row('s1', 'send', 'sharing', 'Sent “Night Shift” +2 to Nova', ago(90), '/contacts'),
  row('u1', 'upload', 'music', 'Uploaded “Cold Front”', ago(60 * 30), '/library'),
];

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });
test.beforeEach(async ({ page, context, baseURL }) => {
  if (stub) await context.addCookies([signInCookie(baseURL!)]);
  await page.route('**/api/activity**', (r) => r.fulfill({ json: { activity: FEED } }));
  await page.route('**/api/notifications**', (r) => r.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route('**/api/events**', (r) => r.fulfill({ json: { events: [] } }));
});

async function openPanel(page: Page) {
  const side = page.getByRole('button', { name: /Open activity panel/ });
  if (await side.count()) await side.first().click();
  else {
    await page.getByRole('button', { name: /^Notifications/ }).first().click();
    await page.getByRole('button', { name: /activity log/i }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Recent activity' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('group chips, filtering, day headers', async ({ page }) => {
  // Only this test asserts day headers; pinning Date in the others stalled the /sales landing.
  await page.clock.setFixedTime(NOW);
  await page.goto('/library');
  const dialog = await openPanel(page);
  const chips = dialog.getByRole('group', { name: /filter activity/i });
  await expect(chips.getByRole('button', { name: /^All\s*4/ })).toHaveAttribute('aria-pressed', 'true');
  for (const g of ['Music', 'Sales', 'Artists', 'Sharing']) await expect(chips.getByRole('button', { name: new RegExp(`^${g}\\s*1`) })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Today' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Yesterday' })).toBeVisible();

  await chips.getByRole('button', { name: /^Sales/ }).click();
  await expect(dialog.getByText('New sale — Night Shift ($29.00)')).toBeVisible();
  await expect(dialog.getByText('Uploaded “Cold Front”')).toHaveCount(0);
});

test('a row opens its subject and closes the panel', async ({ page }) => {
  await page.goto('/library');
  const dialog = await openPanel(page);
  await dialog.getByRole('link', { name: /New sale/ }).click();
  await expect(page).toHaveURL(/\/sales/);
  await expect(page.getByRole('dialog', { name: 'Recent activity' })).toHaveCount(0);
});

for (const [name, width, height] of [['390', 390, 844], ['1440', 1440, 900]] as const) {
  test(`every chip is visible inside the panel, no sideways scroll (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/library');
    const dialog = await openPanel(page);
    const chips = dialog.getByRole('group', { name: /filter activity/i }).getByRole('button');
    await expect(chips).toHaveCount(5);
    // The panel slides in; measure once it has settled against the right edge.
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.x + (await dialog.boundingBox())!.width)).toBe(width);
    const panel = await dialog.boundingBox();
    for (let i = 0; i < 5; i++) {
      const b = (await chips.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(panel!.x);
      expect(b.x + b.width).toBeLessThanOrEqual(panel!.x + panel!.width + 0.5);
    }
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
