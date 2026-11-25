import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * LICENSE-05: the contract draft under a license tier, and the generated Schedule of Terms
 * under the wording editor. /api/licenses and the draft route are stubbed (stub-Supabase
 * sign-in as in license-analysis); the route itself and its ownership rules are covered by
 * the Vitest route tests. Set SHOT_DIR to also save screenshots.
 */
const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
const TIER_ID = '11111111-1111-4111-8111-111111111111';
const TIER = {
  id: TIER_ID, name: 'Premium WAV', description: null, price_usd: 75, is_free: false, file_types: ['MP3', 'WAV'],
  stems_included: false, is_exclusive: false, streaming_limit: 100000, distribution_limit: null, commercial_rights: true,
  sync_rights: false, broadcast_rights: false, credit_required: true, sort_order: 0,
};
const BODY = Array.from({ length: 40 }, (_, i) => `- Wording line ${i + 1}`).join('\n');
const DRAFT = (conflict: boolean) => ({
  draft: {
    draft: true, sample: true, tier: { name: 'Premium WAV', source: 'licenses-row', issues: [] }, template_source: 'tier-aware',
    markdown: `# License Agreement\n\n${BODY}\n\n## Schedule of Terms\n\n### Premium WAV\n- Audio streams: 100,000 streams\n`,
    schedule: '## Schedule of Terms\n',
    verification: conflict
      ? { ok: false, missing: [], contradicted: ['states 5,000 streams: "- Up to 5,000 audio streams"'] }
      : { ok: true, missing: [], contradicted: [] },
    alerts: conflict ? ['Your template wording states 5,000 streams: "- Up to 5,000 audio streams"'] : [],
  },
});

let stubSupabase: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stubSupabase = await startStubSupabase(); });
test.afterAll(async () => { await stubSupabase?.close(); });
test.beforeEach(async ({ context, baseURL }) => {
  if (stubSupabase) await context.addCookies([signInCookie(baseURL!)]);
});
test.use({ deviceScaleFactor: 2 });

async function stub(page: Page, conflict: boolean) {
  await page.route(/\/api\/tracks\?/, (r) => r.fulfill(json({ tracks: [], pageInfo: { hasMore: false, nextCursor: null } })));
  await page.route(/\/api\/tracks\/store-summary/, (r) => r.fulfill(json({ total: 0, listed: 0, issues: {}, producerPicks: [] })));
  await page.route(/\/api\/profile(\?.*)?$/, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ profile: { display_name: 'E2E Producer', license_template_md: '' } }))
      : r.continue());
  await page.route(/\/api\/playlists(\?.*)?$/, (r) => r.fulfill(json({ playlists: [] })));
  await page.route(/\/api\/projects(\?.*)?$/, (r) => r.fulfill(json({ projects: [] })));
  await page.route(/\/api\/promo-codes(\?.*)?$/, (r) => r.fulfill(json({ codes: [] })));
  await page.route(/\/api\/licenses(\?.*)?$/, (r) => r.fulfill(json({ licenses: [TIER] })));
  await page.route(/\/api\/track-licenses\?/, (r) => r.fulfill(json({ licenses: [] })));
  await page.route(/\/api\/licenses\/[^/]+\/contract-draft/, (r) => r.fulfill(json(DRAFT(conflict))));
}

for (const viewport of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`a tier's contract draft: conflicts first, bounded text, PDF and edit links, no sideways scroll (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stub(page, true);
    await page.goto('/store-editor#licenses');
    await page.getByText('Premium WAV', { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.locator('button:has(svg.lucide-chevron-down)').last().click();

    await page.getByRole('button', { name: 'Contract draft' }).click();
    const text = page.getByTestId('license-contract-draft-text');
    await expect(text).toContainText('## Schedule of Terms');
    const status = page.getByTestId('license-contract-draft-status');
    await expect(status).toContainText('5,000 streams');
    await expect(status).not.toContainText('exactly');

    // Conflicts sit above the text; the text is bounded and scrolls on its own.
    const [s, t] = await Promise.all([status.boundingBox(), text.boundingBox()]);
    expect(s!.y + s!.height).toBeLessThanOrEqual(t!.y + 1);
    expect(t!.height).toBeLessThanOrEqual(300);
    expect(await text.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

    await expect(page.getByRole('link', { name: /Download PDF draft/ })).toHaveAttribute('href', `/api/licenses/${TIER_ID}/contract-draft?format=pdf`);
    await expect(page.getByRole('link', { name: /Edit wording/ })).toHaveAttribute('href', '/store-editor#license-template');
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/license-draft-${viewport.name}.png` });
  });
}

test('a clean tier says the contract states its terms exactly', async ({ page }) => {
  await stub(page, false);
  await page.goto('/store-editor#licenses');
  await page.getByText('Premium WAV', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.locator('button:has(svg.lucide-chevron-down)').last().click();
  await page.getByRole('button', { name: 'Contract draft' }).click();
  await expect(page.getByTestId('license-contract-draft-status')).toContainText('states this tier’s terms exactly');
});

test('wording that holds a Schedule of Terms is called out, and the generated schedule is read-only', async ({ page }) => {
  await stub(page, false);
  await page.goto('/store-editor');
  await page.getByRole('button', { name: /License Contract/ }).click();
  await page.getByRole('button', { name: 'Use tier-aware default' }).click();
  const schedule = page.getByTestId('license-template-schedule');
  await expect(schedule).toContainText('generated, cannot be edited');
  await expect(schedule.locator('textarea, input')).toHaveCount(0);
  await expect(page.getByTestId('license-template-schedule-error')).toHaveCount(0);

  const area = page.getByPlaceholder(/default template/i);
  await area.focus();
  await area.press('Control+End');
  await area.pressSequentially('\n\n## Schedule of Terms\n- Audio streams: Unlimited');
  await expect(page.getByTestId('license-template-schedule-error')).toContainText('Delete the line “## Schedule of Terms”');
});
