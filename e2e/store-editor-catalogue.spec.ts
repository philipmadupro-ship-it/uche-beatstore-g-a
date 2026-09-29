/**
 * Store Editor → Beat Listing with more than one API page of beats (STORE-02).
 *
 * The editor used to fetch the 100 newest beats and stop behind a "Load next
 * 100 beats" button, so on a bigger catalogue older listed beats were missing
 * from the list, search only saw what had loaded, and a reorder renumbered
 * only the loaded listed beats — colliding with the positions of the rest.
 *
 * 250 beats are stubbed behind `/api/tracks`'s real paging contract (offset
 * cursor, 100-row ceiling). The listed ones are the OLDEST, so every one of
 * them sits on page three. Sign-in goes through e2e/fixtures/stub-supabase.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

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

const TOTAL = 250;
const LISTED_FROM = 220; // beats 220–249 (the oldest 30) are listed
const LISTED = TOTAL - LISTED_FROM;
const pad = (n: number) => String(n).padStart(3, '0');

// Newest first, as the API orders them.
const tracks = Array.from({ length: TOTAL }, (_, i) => ({
  id: `e2e-cat-${pad(i)}`,
  title: `CATALOGUE BEAT ${pad(i)}`,
  type: 'beat',
  cover_url: null,
  peaks_url: null,
  bpm: 140,
  key: 'F',
  scale: 'minor',
  store_listed: i >= LISTED_FROM,
  store_featured: false,
  store_sort_order: i >= LISTED_FROM ? i - LISTED_FROM : null,
  scheduled_publish_at: null,
  lease_price_usd: 30,
  exclusive_price_usd: null,
  free_download_enabled: false,
  exclusive_sold: false,
  voice_tag_enabled: false,
  created_at: new Date(Date.UTC(2026, 8, 1) - i * 60_000).toISOString(),
}));

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page: Page) {
  const trackRequests: string[] = [];
  const reorderBodies: Array<{ items: Array<{ id: string; store_sort_order: number }> }> = [];

  await page.route(/\/api\/tracks\?/, (route) => {
    const url = new URL(route.request().url());
    trackRequests.push(url.search);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    const source = url.searchParams.get('store_listed') === '1' ? tracks.filter((t) => t.store_listed) : tracks;
    const page = source.slice(offset, offset + limit);
    const hasMore = offset + limit < source.length;
    return route.fulfill(json({ tracks: page, pageInfo: { hasMore, nextCursor: hasMore ? String(offset + limit) : null } }));
  });
  await page.route(/\/api\/tracks\/store-summary/, (route) =>
    route.fulfill(json({ total: TOTAL, listed: LISTED, issues: {}, producerPicks: [] })),
  );
  await page.route(/\/api\/tracks\/reorder/, (route) => {
    reorderBodies.push(route.request().postDataJSON());
    return route.fulfill(json({ updated: LISTED }));
  });
  await page.route(/\/api\/profile(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(json({ profile: { display_name: 'E2E Producer', license_lease_price_usd: 30 } }))
      : route.continue(),
  );
  await page.route(/\/api\/playlists(\?.*)?$/, (route) => route.fulfill(json({ playlists: [] })));
  await page.route(/\/api\/projects(\?.*)?$/, (route) => route.fulfill(json({ projects: [] })));
  await page.route(/\/api\/promo-codes(\?.*)?$/, (route) => route.fulfill(json({ codes: [] })));
  await page.route(/\/api\/licenses(\?.*)?$/, (route) => route.fulfill(json({ licenses: [] })));
  await page.route(/\/api\/track-licenses\?/, (route) => route.fulfill(json({ licenses: [] })));

  return { trackRequests, reorderBodies };
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`Beat Listing loads every beat past the first 100 (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { trackRequests, reorderBodies } = await stub(page);
    await page.goto('/store-editor');
    await page.getByRole('button', { name: /Beat Listing/ }).click();

    // Every listed beat is on API page three; all of them reach the list.
    const oldestListed = `CATALOGUE BEAT ${pad(TOTAL - 1)}`;
    await expect(page.getByRole('switch', { name: `Remove ${oldestListed} from store` })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('switch', { name: /^Remove CATALOGUE BEAT \d+ from store$/ })).toHaveCount(LISTED);
    await expect(page.getByText(/Load next 100 beats/i)).toHaveCount(0);

    const catalogueRequests = trackRequests.filter((q) => q.includes('lean=1') && !q.includes('store_listed='));
    // Three distinct pages (dev StrictMode runs the load effect twice; the
    // superseded walk is discarded by its request id).
    expect([...new Set(catalogueRequests)].sort()).toEqual([
      '?paged=1&lean=1&limit=100',
      '?paged=1&lean=1&limit=100&cursor=100',
      '?paged=1&lean=1&limit=100&cursor=200',
    ]);

    // Search covers the whole catalogue, not the first page — and goes nowhere.
    const before = trackRequests.length;
    const search = page.getByPlaceholder('Search beats…');
    await search.fill('CATALOGUE BEAT 150');
    await expect(page.getByRole('switch', { name: 'Add CATALOGUE BEAT 150 to store' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /^(Add|Remove) CATALOGUE BEAT \d+ (to|from) store$/ })).toHaveCount(1);
    await search.fill('');
    expect(trackRequests.length).toBe(before);

    // A reorder renumbers EVERY listed beat, not the ones on the first page.
    await search.focus();
    await page.getByRole('button', { name: `Options for CATALOGUE BEAT ${pad(LISTED_FROM)}` }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect.poll(() => reorderBodies.length).toBe(1);
    const items = reorderBodies[0].items;
    expect(items).toHaveLength(LISTED);
    expect(new Set(items.map((i) => i.store_sort_order)).size).toBe(LISTED);
    expect(items.slice(0, 2).map((i) => i.id)).toEqual([`e2e-cat-${pad(LISTED_FROM + 1)}`, `e2e-cat-${pad(LISTED_FROM)}`]);

    // No horizontal page scroll at this width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/store-editor-catalogue-${viewport.name}.png`, fullPage: false });
  });
}
