import { test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';
const OUT = process.env.UI02_OUT!;
const json = (b: unknown) => ({ contentType: 'application/json', body: JSON.stringify(b) });
const tr = (i: number, type = 'beat') => ({ id: `t${i}`, user_id: 'local-user', title: `Fixture Track ${i}`, type, audio_url: null, peaks_url: null, cover_url: null,
  duration_seconds: 120 + i, bpm: 120 + i * 4, key: 'F', scale: 'minor', rating: i % 5, store_listed: i % 2 === 0, created_at: '2026-09-01T00:00:00.000Z', track_tags: [{ tag: 'dark', category: 'mood' }] });
const tracks = [1, 2, 3, 4, 5, 6].map((i) => tr(i, i === 3 ? 'loop' : 'beat'));
const project = { id: 'p1', user_id: 'local-user', name: 'Fixture Project', description: 'Icon audit fixture', status: 'active', tags: [], price_usd: 40, store_featured: false, created_at: '2026-09-01T00:00:00.000Z' };
let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });
async function stubs(page: Page) {
  await page.route(/\/api\/tracks\?/, (r) => r.fulfill(json({ tracks, pageInfo: { hasMore: false, nextCursor: null } })));
  await page.route(/\/api\/projects\/p1(\?.*)?$/, (r) => r.fulfill(json({ project })));
  await page.route(/\/api\/projects(\?.*)?$/, (r) => r.fulfill(json({ projects: [project] })));
  await page.route(/\/api\/playlists(\?.*)?$/, (r) => r.fulfill(json({ playlists: [] })));
  await page.route(/\/api\/profile(\?.*)?$/, (r) => r.fulfill(json({ profile: { display_name: 'Fixture Producer', slug: 'fixture' } })));
  await page.route(/\/api\/tracks\/store-summary/, (r) => r.fulfill(json({ total: 6, listed: 3, issues: {}, producerPicks: [] })));
}
for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
  test.describe(`@${vp.n}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
    test.beforeEach(async ({ context, baseURL, page }) => { if (stub) await context.addCookies([signInCookie(baseURL!)]); await stubs(page); });
    const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/${name}-${vp.n}.png`, fullPage: full }); };
    test('library + top bar', async ({ page }) => { await page.goto('/library'); await shot(page, 'library'); });
    test('nav menus', async ({ page }) => {
      await page.goto('/library'); await page.waitForTimeout(1500);
      for (const label of ['Store', 'CRM', 'Catalog']) {
        const b = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
        if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await shot(page, `nav-${label.toLowerCase()}`); await page.keyboard.press('Escape'); }
      }
      const menu = page.getByRole('button', { name: /menu|navigation/i }).first();
      if (await menu.isVisible().catch(() => false)) { await menu.click().catch(() => {}); await shot(page, 'nav-menu'); }
    });
    test('project', async ({ page }) => { await page.goto('/projects/p1'); await shot(page, 'project'); });
    test('store editor', async ({ page }) => { await page.goto('/store-editor'); await shot(page, 'store-editor'); });
    test('design system', async ({ page }) => { await page.goto('/dev/design-system'); await shot(page, 'design-system', true); });
  });
}
