/**
 * Store Editor → License Contract: tier terms and clause blocks (LICENSE-02).
 *
 * Insert a tier term, wrap a line in an optional clause, then Preview as a sample
 * lease and as one of the producer's own tiers. Sign-in goes through the stub
 * Supabase fixture; the /api data is stubbed. Set SHOT_DIR to also save screenshots.
 */
import { test, expect, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

let stubSupabase: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stubSupabase = await startStubSupabase(); });
test.afterAll(async () => { await stubSupabase?.close(); });
test.beforeEach(async ({ context, baseURL }) => {
  if (stubSupabase) await context.addCookies([signInCookie(baseURL!)]);
});

test.use({ deviceScaleFactor: 2 });

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
const GOLD = {
  id: 'lic-gold', name: 'Gold', description: null, price_usd: 60, is_free: false, is_exclusive: false, sort_order: 0,
  file_types: ['MP3', 'WAV'], stems_included: false, streaming_limit: 250000, distribution_limit: null,
  commercial_rights: true, sync_rights: false, broadcast_rights: false, credit_required: false,
};

async function stub(page: Page) {
  await page.route(/\/api\/tracks\?/, (r) => r.fulfill(json({ tracks: [], pageInfo: { hasMore: false, nextCursor: null } })));
  await page.route(/\/api\/tracks\/store-summary/, (r) => r.fulfill(json({ total: 0, listed: 0, issues: {}, producerPicks: [] })));
  await page.route(/\/api\/profile(\?.*)?$/, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ profile: { display_name: 'E2E Producer', license_template_md: '' } }))
      : r.continue());
  await page.route(/\/api\/playlists(\?.*)?$/, (r) => r.fulfill(json({ playlists: [] })));
  await page.route(/\/api\/projects(\?.*)?$/, (r) => r.fulfill(json({ projects: [] })));
  await page.route(/\/api\/promo-codes(\?.*)?$/, (r) => r.fulfill(json({ codes: [] })));
  await page.route(/\/api\/licenses(\?.*)?$/, (r) => r.fulfill(json({ licenses: [GOLD] })));
  await page.route(/\/api\/track-licenses\?/, (r) => r.fulfill(json({ licenses: [] })));
}

for (const viewport of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`tier terms and clauses are insertable and preview fills them (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stub(page);
    await page.goto('/store-editor');
    await page.getByRole('button', { name: /License Contract/ }).click();
    await page.getByRole('button', { name: 'Use tier-aware default' }).click();

    const area = page.getByPlaceholder(/default template/i);
    await expect(area).toHaveValue(/\{\{streaming_limit\}\}/);
    await area.focus();
    await page.getByRole('button', { name: '+Streaming limit' }).click();
    await expect(area).toHaveValue(/\{\{streaming_limit\}\}/);
    await page.getByRole('button', { name: 'If Sync / film' }).click();
    await expect(area).toHaveValue(/\{\{#if sync_rights\}\}/);
    await expect(page.getByTestId('license-template-problems')).toHaveCount(0);

    const shots = process.env.SHOT_DIR;
    const scroll = () => page.getByText('Purchase details', { exact: true }).scrollIntoViewIfNeeded();
    if (shots) { await scroll(); await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/license-editor-${viewport.name}.png` }); }

    await page.getByRole('button', { name: 'Preview', exact: true }).last().click();
    const preview = page.getByTestId('license-template-preview');
    await expect(preview).toContainText('Audio streams: 5,000 streams');
    await expect(preview).toContainText('prod. Uche2crazyyyy');
    await expect(preview).not.toContainText('Synchronisation in film');
    if (shots) { await page.getByRole('radiogroup', { name: 'Preview as' }).scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await page.screenshot({ path: `${shots}/license-preview-lease-${viewport.name}.png` }); }

    await page.getByRole('radio', { name: 'Gold' }).click();
    await expect(preview).toContainText('Audio streams: 250,000 streams');
    await expect(preview).toContainText('Files delivered: MP3, WAV');
    await expect(preview).not.toContainText('prod. Uche2crazyyyy');
    if (shots) { await page.screenshot({ path: `${shots}/license-preview-tier-${viewport.name}.png` }); }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}
