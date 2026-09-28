/**
 * The Library hero's cover tile must show the cover INSIDE the tile, cropped
 * to a centred square, whatever the source image's shape.
 *
 * It did not. The tile had `overflow-hidden` but no positioning, and the cover
 * is a next/image `fill` — `position: absolute; inset: 0`. An absolute child
 * resolves against the nearest POSITIONED ancestor and is not clipped by a
 * static one's overflow, so the cover escaped the 100/132px tile and stretched
 * across the whole hero row, painted over the title and buttons. Covers that
 * skip the optimizer (a pasted URL on another host, blob:/data:) went through
 * a plain <img> with no size at all and rendered at their natural size — a
 * top-left corner of the picture instead of a centred crop.
 *
 * Track data is stubbed so the test controls the cover's shape, and the
 * optimizer is answered with the same bytes: what is under test is layout.
 *
 * `/library` is auth-gated. Where the app points at the stub Supabase URL (the
 * e2e CI job does) the spec signs in through e2e/fixtures/stub-supabase.ts;
 * with no Supabase env the proxy lets it through. Otherwise it skips, saying why.
 */
import { test, expect, type Page } from '@playwright/test';
import { SHAPES, type Shape } from './fixtures/cover-png';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

// Sign in as the fixture producer where the app points at the stub Supabase
// URL (the e2e CI job does); otherwise fall back to whatever the server allows.
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

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

function track(coverUrl: string | null) {
  return {
    id: 'e2e-hero-cover-track',
    user_id: 'local-user',
    title: 'HERO COVER FIXTURE',
    type: 'beat',
    audio_url: null,
    peaks_url: null,
    cover_url: coverUrl,
    duration_seconds: 120,
    bpm: 140,
    key: 'F',
    scale: 'minor',
    rating: null,
    created_at: '2026-09-01T00:00:00.000Z',
    track_tags: [],
  };
}

/**
 * Serve one fixture track. `optimized` covers are a same-origin path, which
 * CoverImage hands to next/image; the rest are a data: URL, which it renders
 * as a plain <img>. Those are the two branches that each broke.
 */
async function stubLibrary(page: Page, shape: Shape | null, optimized: boolean) {
  const png = shape ? SHAPES[shape] : null;
  const coverUrl = !png
    ? null
    : optimized
      ? `/e2e-hero-cover-${shape}.png`
      : `data:image/png;base64,${png.toString('base64')}`;

  await page.route(/\/api\/tracks\?/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tracks: [track(coverUrl)], pageInfo: { hasMore: false, nextCursor: null } }),
    }),
  );
  if (png) {
    await page.route(/\/_next\/image\?/, (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    );
  }
}

async function openLibrary(page: Page) {
  await page.goto('/library');
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    '/library is auth-gated here; run against local-store dev with no Supabase env',
  );
  const tile = page.getByTestId('library-hero-cover');
  await expect(tile).toBeVisible();
  return tile;
}

for (const vp of VIEWPORTS) {
  test.describe(`Library hero cover @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const optimized of [true, false]) {
      for (const shape of Object.keys(SHAPES) as Shape[]) {
        const branch = optimized ? 'next/image' : 'plain img';
        test(`${shape} cover (${branch}) fills the tile with a centred crop`, async ({ page }) => {
          await stubLibrary(page, shape, optimized);
          const tile = await openLibrary(page);

          const img = tile.locator('img').first();
          await expect(img).toBeVisible();
          await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

          const t = (await tile.boundingBox())!;
          const i = (await img.boundingBox())!;
          // The image box is exactly the tile: not the hero row, not the
          // picture's natural size. 1px tolerance for the tile's border.
          expect(Math.abs(i.x - t.x)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(i.y - t.y)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(i.width - t.width)).toBeLessThanOrEqual(3);
          expect(Math.abs(i.height - t.height)).toBeLessThanOrEqual(3);

          const fit = await img.evaluate((el) => {
            const s = getComputedStyle(el);
            return { objectFit: s.objectFit, objectPosition: s.objectPosition };
          });
          expect(fit.objectFit).toBe('cover');
          expect(fit.objectPosition).toBe('50% 50%');

          // The title must not be painted over.
          const h1 = page.getByRole('heading', { level: 1, name: 'Home' });
          const hb = (await h1.boundingBox())!;
          const topAtTitle = await page.evaluate(
            ([x, y]) => document.elementFromPoint(x, y)?.closest('h1') !== null,
            [hb.x + Math.min(hb.width / 2, 20), hb.y + hb.height / 2],
          );
          expect(topAtTitle).toBe(true);

          await page.screenshot({
            path: test.info().outputPath(`hero-${vp.name}-${shape}-${optimized ? 'optimized' : 'plain'}.png`),
            clip: { x: 0, y: Math.max(0, t.y - 40), width: vp.width, height: t.height + 80 },
          });
        });
      }
    }

    test('missing cover falls back to generated artwork that fills the tile', async ({ page }) => {
      await stubLibrary(page, null, false);
      const tile = await openLibrary(page);

      await expect(tile.locator('img[src^="/e2e-hero-cover"], img[src^="data:"]')).toHaveCount(0);
      const fallback = tile.locator('[role="presentation"]').first();
      await expect(fallback).toBeVisible();
      const t = (await tile.boundingBox())!;
      const f = (await fallback.boundingBox())!;
      expect(Math.abs(f.width - t.width)).toBeLessThanOrEqual(3);
      expect(Math.abs(f.height - t.height)).toBeLessThanOrEqual(3);
      const painted = await fallback.evaluate((el) => {
        const s = getComputedStyle(el);
        return s.backgroundImage !== 'none' || el.querySelector('img') !== null;
      });
      expect(painted).toBe(true);

      await page.screenshot({
        path: test.info().outputPath(`hero-${vp.name}-missing.png`),
        clip: { x: 0, y: Math.max(0, t.y - 40), width: vp.width, height: t.height + 80 },
      });
    });
  });
}
