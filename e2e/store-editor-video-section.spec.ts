/**
 * Store Editor → Design → a video section, on a laptop-height window.
 *
 * Reported: "can't change the size of the video and paste url". At 1366×768
 * the inspector was taller than its panel, did not scroll, and the builder
 * frame clipped it — the video link was the LAST control, so it sat below the
 * visible area with no way to reach it. The only size control was a coarse
 * Narrow / Wide / Full, plus a Columns row that did nothing for a video.
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

test('a video section can be pasted into and resized on a 768px-tall screen', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1366, height: 768 });
  const layoutSaves: unknown[] = [];
  await page.route(/\/api\/profile(\?.*)?$/, (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json({ profile: { display_name: 'E2E Producer' } }));
    const saved = route.request().postDataJSON();
    layoutSaves.push(saved);
    // Echo it as the real route does; the builder checks the row it gets back.
    return route.fulfill(json({ profile: { store_layout: saved.store_layout } }));
  });
  for (const [pattern, body] of [
    [/\/api\/playlists(\?.*)?$/, { playlists: [] }],
    [/\/api\/projects(\?.*)?$/, { projects: [] }],
    [/\/api\/promo-codes(\?.*)?$/, { codes: [] }],
    [/\/api\/licenses(\?.*)?$/, { licenses: [] }],
    [/\/api\/tracks\/store-summary/, { issues: {}, producerPicks: [] }],
    [/\/api\/tracks\?/, { tracks: [], pageInfo: { hasMore: false, nextCursor: null } }],
  ] as const) {
    await page.route(pattern, (route) => route.fulfill(json(body)));
  }

  await page.goto('/store-editor');
  await page.getByRole('button', { name: 'design', exact: true }).click();
  await page.getByRole('button', { name: /Add section/ }).click();
  await page.getByRole('button', { name: 'video', exact: true }).click();

  // The link field is on screen without scrolling anything.
  const inspector = page.locator('aside').last();
  const link = inspector.getByPlaceholder('https://youtu.be/…');
  const panel = (await inspector.boundingBox())!;
  const field = (await link.boundingBox())!;
  expect(field.y + field.height).toBeLessThanOrEqual(panel.y + panel.height);

  // A real paste lands in it.
  await page.evaluate(() => navigator.clipboard.writeText('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  await link.click();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(link).toHaveValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const video = page.frameLocator('iframe[title^="Storefront preview"]').locator('section[data-section-kind="video"] iframe');
  await expect(video).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

  // Size: a real control, and it changes what is drawn.
  await expect(inspector.getByText('Columns', { exact: true })).toHaveCount(0);
  const full = (await video.boundingBox())!.width;
  await inspector.getByRole('slider', { name: 'Video size' }).fill('50');
  await expect(inspector.getByText('50%', { exact: true })).toBeVisible();
  await expect.poll(async () => Math.round(((await video.boundingBox())!.width / full) * 100)).toBe(50);

  // The panel scrolls with the wheel rather than clipping what does not fit.
  const scroller = inspector.locator('.overflow-y-auto').first();
  const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(clientHeight).toBeLessThanOrEqual(Math.ceil(panel.height));
  if (scrollHeight > clientHeight) {
    await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  }

  // And the size is saved with the layout.
  await expect.poll(() => layoutSaves.some((body) => JSON.stringify(body).includes('"mediaSize":50'))).toBe(true);
});
