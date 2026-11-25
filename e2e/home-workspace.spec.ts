import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * Home (DASH-02): "Needs you" is visible and honest (skeleton → rows / all clear /
 * could-not-load, never a false all-clear), the pick-up strip shows what was last
 * touched, and a brand-new workspace gets a first step. All /api data is stubbed;
 * signing in goes through the stub Supabase where CI configures it.
 */
const day = 86_400_000;
const iso = (d: number) => new Date(Date.now() - d * day).toISOString();
const track = (i: number) => ({
  id: `h${i}`, user_id: 'local-user', title: `HOME FX ${i}`, type: 'beat', audio_url: null, peaks_url: null, cover_url: null,
  duration_seconds: 120, bpm: 140, key: 'F', scale: 'minor', rating: null, status: 'finished', created_at: iso(i), track_tags: [],
});

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });
test.beforeEach(async ({ context, baseURL }) => { if (stub) await context.addCookies([signInCookie(baseURL!)]); });

async function stub_(page: Page, o: { tracks?: number; sales?: unknown; leads?: unknown[]; salesStatus?: number } = {}) {
  const n = o.tracks ?? 3;
  await page.route(/\/api\/tracks\?/, (r) => r.fulfill({ json: { tracks: Array.from({ length: n }, (_, i) => track(i + 1)), pageInfo: { hasMore: false, nextCursor: null } } }));
  await page.route(/\/api\/sales(\?|$)/, (r) => r.fulfill({ status: o.salesStatus ?? 200, json: { sales: o.sales ?? [] } }));
  await page.route(/\/api\/store\/offer(\?|$)/, (r) => r.fulfill({ json: { offers: [] } }));
  await page.route(/\/api\/contacts\?/, (r) => r.fulfill({ json: o.leads ?? [] }));
  await page.route(/\/api\/analytics/, (r) => r.fulfill({ json: { totals: { plays: 1, sales_count: 0, gross_usd: 0 }, by_track: [] } }));
  await page.route(/\/api\/playlists(\?|$)/, (r) => r.fulfill({ json: { playlists: n ? [{ id: 'pl1', name: 'HOME FX PLAYLIST', created_at: iso(3), track_count: 2 }] : [] } }));
  await page.route(/\/api\/projects(\?|$)/, (r) => r.fulfill({ json: { projects: n ? [{ id: 'pr1', name: 'HOME FX PROJECT', created_at: iso(9), updated_at: iso(1), track_count: 4 }] : [] } }));
  await page.route(/\/api\/profile/, (r) => r.fulfill({ json: { profile: { license_lease_price_usd: 30 } } }));
}
async function open(page: Page) {
  await page.goto('/library');
  test.skip(new URL(page.url()).pathname.startsWith('/login'), '/library is auth-gated here');
}

for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }] as const) {
  test.describe(`Home @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('needs-you rows are links, visible without expanding', async ({ page }) => {
      await stub_(page, { sales: [{ id: 's1', item_label: 'HOME FX 1', needs_stems_upload: true, created_at: iso(1) }], leads: [{ id: 'c1', name: 'HOME LEAD', email: null, created_at: iso(2) }] });
      await open(page);
      const block = page.getByTestId('needs-you');
      await expect(block).toHaveAttribute('data-status', 'items');
      await expect(block.getByRole('link', { name: /Awaiting stems/i })).toHaveAttribute('href', /\/sales/);
      await expect(block.getByRole('link', { name: /New lead/i })).toHaveAttribute('href', '/contacts/c1');
    });

    test('says all clear only when every source loaded', async ({ page }) => {
      await stub_(page);
      await open(page);
      await expect(page.getByTestId('needs-you')).toHaveAttribute('data-status', 'clear');
      await expect(page.getByText(/nothing waiting/i)).toBeVisible();
    });

    test('a failed source is never reported as all clear', async ({ page }) => {
      await stub_(page, { salesStatus: 500 });
      await open(page);
      await expect(page.getByTestId('needs-you')).toHaveAttribute('data-status', 'error');
      await expect(page.getByText(/nothing waiting/i)).toHaveCount(0);
      await expect(page.getByText(/couldn’t load sales/i)).toBeVisible();
    });

    test('pick-up strip links to the project and playlist', async ({ page }) => {
      await stub_(page);
      await open(page);
      const strip = page.getByTestId('pick-up-strip');
      await expect(strip.getByRole('link', { name: /HOME FX PROJECT/ })).toHaveAttribute('href', '/projects/pr1');
      await expect(strip.getByRole('link', { name: /HOME FX PLAYLIST/ })).toHaveAttribute('href', '/playlists/pl1');
    });

    test('a new workspace gets a first step, not a blank page', async ({ page }) => {
      await stub_(page, { tracks: 0 });
      await open(page);
      await expect(page.getByTestId('empty-home')).toBeVisible();
      await expect(page.getByTestId('needs-you')).toHaveCount(0);
    });
  });
}
