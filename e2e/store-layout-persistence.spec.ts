/**
 * Store Editor → Design → the live /store, with nothing on the data path stubbed.
 *
 * `/api/profile` validated `store_layout` and then left it out of the row it
 * wrote, answering 200 all the same. Every Design autosave "succeeded", the
 * builder said saved, and /store kept rendering the default layout — so a
 * video added in Design never appeared for buyers. The other Design specs stub
 * `/api/profile`, which is exactly why none of them noticed.
 *
 * Here the save goes through the real route into the local store
 * (ENABLE_LOCAL_STORE, `data/db.json`), a reload proves the editor reads it
 * back, and /store renders it through the real `/api/store`. The stub Supabase
 * only signs the producer in. The layout is cleared afterwards, since later
 * specs share `data/db.json`.
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
  test.skip(!stubSupabase, 'needs the stub Supabase (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321)');
  await context.addCookies([signInCookie(baseURL!)]);
  // Supabase-only tables with no local-store branch; not under test.
  await context.route(/\/api\/promo-codes(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ codes: [] }) }));
  await context.route(/\/api\/licenses(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ licenses: [] }) }));
});

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

function layoutSaved(page: Page, predicate: (layout: string) => boolean) {
  return page.waitForResponse((r) => {
    if (!r.url().endsWith('/api/profile') || r.request().method() !== 'PATCH') return false;
    const body = r.request().postDataJSON() as { store_layout?: unknown } | null;
    return !!body?.store_layout && predicate(JSON.stringify(body.store_layout));
  }, { timeout: 30_000 });
}

test('a video added in Design is saved and shows on the live /store', async ({ page }) => {
  const original = (await (await page.request.get('/api/profile')).json()).profile ?? {};
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/store-editor');
    await page.getByRole('button', { name: 'design', exact: true }).click({ timeout: 30_000 });
    await page.getByRole('button', { name: /Add section/ }).click();
    await page.getByRole('button', { name: 'video', exact: true }).click();

    const inspector = page.locator('aside').last();
    const saved = layoutSaved(page, (l) => l.includes(VIDEO_URL) && l.includes('"mediaSize":60'));
    await inspector.getByPlaceholder('https://youtu.be/…').fill(VIDEO_URL);
    await inspector.getByRole('slider', { name: 'Video size' }).fill('60');

    // The real route stores it and hands back the stored row.
    const res = await saved;
    expect(res.status()).toBe(200);
    const { profile } = await res.json();
    expect(JSON.stringify(profile.store_layout)).toContain(VIDEO_URL);

    // The row holds it, read fresh from the server.
    const stored = (await (await page.request.get('/api/profile')).json()).profile;
    const video = stored.store_layout.sections.find((s: { kind: string }) => s.kind === 'video');
    expect(video.content).toMatchObject({ videoUrl: VIDEO_URL, mediaSize: 60 });

    // The builder reopens on the saved layout.
    await page.reload();
    await page.getByRole('button', { name: 'design', exact: true }).click({ timeout: 30_000 });
    const canvasVideo = page.frameLocator('iframe[title^="Storefront preview"]')
      .locator('section[data-section-kind="video"] iframe');
    await expect(canvasVideo).toHaveAttribute('src', EMBED, { timeout: 30_000 });

    // And buyers get it.
    await page.goto('/store');
    const live = page.locator('section[data-section-kind="video"] iframe');
    await expect(live).toHaveAttribute('src', EMBED, { timeout: 30_000 });
    await expect(live).toBeVisible();
    await live.scrollIntoViewIfNeeded();
    const box = (await live.boundingBox())!;
    const frame = (await page.locator('section[data-section-kind="video"]').boundingBox())!;
    expect(box.width).toBeLessThan(frame.width * 0.7);
    await page.screenshot({ path: test.info().outputPath('store-with-video.png') });
  } finally {
    await page.request.patch('/api/profile', { data: { store_layout: original.store_layout ?? null } });
  }
});
