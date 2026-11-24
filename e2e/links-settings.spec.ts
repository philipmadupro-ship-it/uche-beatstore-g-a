import { expect, test } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * /links Settings form (SHARE-05). /api/links is stubbed, so the page, the form
 * and every click are real: the Recipient dropdown must show the kind the API
 * reported, and a non-client link offers no selling switch.
 */
const link = (over: Record<string, unknown>) => ({
  id: 'id1', source: 'share_links', token: 'tok1abcd', title: 'For Nova', content_title: null,
  kind: 'project', recipient_kind: 'client', sales_enabled: true,
  track_ids: ['t1'], tracks: [{ id: 't1', title: 'Night Shift', type: 'beat', cover_url: null }],
  plays: 1, expires_at: null, revoked_at: null, allow_downloads: true, password_protected: false,
  created_at: new Date().toISOString(), href: '/share/x', cover_url: null,
  artwork_kind: 'track', artwork_seed: 's1', artwork_tags: [],
  ...over,
});

let stubSupabase: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => {
  if (stubSupabaseConfigured()) stubSupabase = await startStubSupabase();
});
test.afterAll(async () => {
  await stubSupabase?.close();
});

test.beforeEach(async ({ context, baseURL }) => {
  if (stubSupabase) await context.addCookies([signInCookie(baseURL!)]);
});

async function openSettings(page: import('@playwright/test').Page, over: Record<string, unknown>) {
  await page.route('**/api/links', (route) => route.fulfill({ json: { links: [link(over)] } }));
  await page.goto('/links');
  // The row's meta line sits over the stretched activator (titles are rename fields).
  await page.getByText(/\d tracks? ·/i).filter({ visible: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Settings' }).click();
}

test('the Recipient dropdown shows the kind the API reported; a rapper link cannot sell', async ({ page }) => {
  await openSettings(page, { recipient_kind: 'rapper', sales_enabled: false });
  const form = page.getByTestId('link-settings-form');
  await expect(form.getByRole('button', { name: /Recipient kind/ })).toContainText('Rapper');
  await expect(form.getByRole('switch')).toBeDisabled();
  await expect(form.getByText('Selling is for client links only')).toBeVisible();
});

test('a client link shows its selling switch on', async ({ page }) => {
  await openSettings(page, { recipient_kind: 'client', sales_enabled: true });
  const form = page.getByTestId('link-settings-form');
  await expect(form.getByRole('button', { name: /Recipient kind/ })).toContainText('Client');
  await expect(form.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
