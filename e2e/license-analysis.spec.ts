import { expect, test } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * LICENSE-03: the automatic check under a license tier. /api/licenses is
 * stubbed, so no database is needed (stub-Supabase sign-in as in links-filtering).
 */
const tier = (i: number, o: Record<string, unknown>) => ({
  id: `t${i}`, description: null, price_usd: 30, is_free: false, file_types: ['MP3'], stems_included: false,
  is_exclusive: false, streaming_limit: 100000, distribution_limit: null, commercial_rights: true,
  sync_rights: false, broadcast_rights: false, credit_required: true, sort_order: i, ...o,
});
const TIERS = [
  tier(1, { name: 'MP3 Lease' }),
  tier(2, { name: 'Exclusive', price_usd: 400, is_exclusive: true, sync_rights: true, credit_required: false }),
];

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });

test('check opens with findings, updates on an edit, and says it is not legal advice', async ({ page, context, baseURL }) => {
  if (stub) await context.addCookies([signInCookie(baseURL!)]);
  await page.route('**/api/licenses', (r) => r.fulfill({ json: { licenses: TIERS } }));
  await page.goto('/store-editor#licenses');
  await page.getByText('Exclusive', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.locator('button:has(svg.lucide-chevron-down)').last().click();

  const panel = page.getByTestId('license-analysis');
  await expect(panel).toContainText('2 to look at');
  await panel.getByRole('button', { name: 'Check this tier' }).click();
  await expect(panel).toContainText('Automatic check — not legal advice.');
  await expect(panel.locator('[data-code="EXCLUSIVE_NO_WAV"]')).toBeVisible();

  // The check reads the unsaved draft: adding WAV clears the risk.
  await page.getByRole('button', { name: /^WAV$/ }).last().click();
  await expect(panel.locator('[data-code="EXCLUSIVE_NO_WAV"]')).toHaveCount(0);
});
