/**
 * Store Editor → Share Templates: preview a template for a listed beat in each
 * output size and download it. The PNG must be exactly the preset's size, and
 * picking a template must save `share_card_style`.
 *
 * Sign-in goes through e2e/fixtures/stub-supabase.ts.
 */
import { test, expect } from '@playwright/test';
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

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHbMjXgAAAABJRU5ErkJggg==',
  'base64',
);

function pngSize(buf: Buffer) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('preview each size, pick a template, download a PNG of the preset size', async ({ page }) => {
  const saves: Record<string, unknown>[] = [];
  await page.route(/\/api\/profile(\?.*)?$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(json({ profile: { display_name: 'E2E Producer', accent_color: '#c8a47a' } }));
    }
    saves.push(route.request().postDataJSON());
    return route.fulfill(json({ profile: {} }));
  });
  for (const [pattern, body] of [
    [/\/api\/playlists(\?.*)?$/, { playlists: [] }],
    [/\/api\/projects(\?.*)?$/, { projects: [] }],
    [/\/api\/promo-codes(\?.*)?$/, { codes: [] }],
    [/\/api\/licenses(\?.*)?$/, { licenses: [] }],
    [/\/api\/tracks\/store-summary/, { issues: {}, producerPicks: [] }],
    [/\/api\/tracks\?/, {
      tracks: [{
        id: 'a0000000-0000-4000-8000-000000000001', title: 'Night Shift', type: 'beat',
        cover_url: 'https://covers.example.test/c.png', peaks_url: null, bpm: 140, key: 'F', scale: 'minor',
        store_listed: true, store_featured: false, store_sort_order: null, lease_price_usd: 30,
        exclusive_price_usd: 300, free_download_enabled: false, exclusive_sold: false,
        voice_tag_enabled: false, scheduled_publish_at: null,
      }],
      pageInfo: { hasMore: false, nextCursor: null },
    }],
  ] as const) {
    await page.route(pattern, (route) => route.fulfill(json(body)));
  }
  await page.route('https://covers.example.test/c.png', (route) => route.fulfill({
    status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' },
  }));
  await page.route(/\/api\/store\/peaks\//, (route) => route.fulfill(json({
    version: 1, length: 64, duration: 75, peaks: Array.from({ length: 64 }, (_, i) => Math.sin(i / 5)),
  })));

  await page.goto('/store-editor');
  await page.getByRole('button', { name: /share templates/i }).first().click();
  const studio = page.getByTestId('share-template-studio');
  await expect(studio).toBeVisible();

  const preview = page.getByTestId('share-preview');
  for (const [id, w, h] of [['square', 1080, 1080], ['story', 1080, 1920], ['og', 1200, 630]] as const) {
    await page.getByTestId(`share-preset-${id}`).click();
    await expect(preview).toHaveAttribute('data-preset', id);
    await expect(preview.locator('svg')).toHaveAttribute('viewBox', `0 0 ${w} ${h}`);
    await expect(preview.locator('svg')).toContainText(/Night\s*Shift/);
  }

  await page.getByTestId('share-template-mono').click();
  await expect(preview).toHaveAttribute('data-style', 'mono');

  await page.getByTestId('share-preset-og').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('share-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('night-shift-og-1200x630.png');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const png = Buffer.concat(chunks);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(pngSize(png)).toEqual({ width: 1200, height: 630 });

  // The template choice is what Save writes.
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect.poll(() => saves.some((s) => s.share_card_style === 'mono')).toBe(true);
});
