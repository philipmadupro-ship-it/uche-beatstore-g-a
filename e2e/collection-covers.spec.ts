/**
 * Project and playlist covers must sit INSIDE their box with a centred crop,
 * whatever the source image's shape — the same rule as the Library hero
 * (e2e/library-hero-cover.spec.ts).
 *
 * Surfaces:
 *   - the grid card on /projects and /playlists (MediaCard)
 *   - the "Recently opened" chip on the same pages — this one had the Library
 *     hero's bug: an `overflow-hidden` wrapper with no positioning, so the
 *     next/image `fill` cover escaped the 32px chip and spread over the row
 *   - the large cover on /projects/[id] and /playlists/[id] (CoverEditor)
 *
 * Each runs square / portrait / landscape covers through both CoverImage
 * branches (next/image, and the plain <img> used for data:/blob:/unlisted
 * hosts), plus a missing cover, at desktop / tablet / mobile widths.
 *
 * API data is stubbed and the image bytes are served by the test, so what is
 * under test is layout only. Sign-in goes through e2e/fixtures/stub-supabase.ts
 * exactly as in the Library spec.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
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

const KINDS = [
  { kind: 'projects', single: 'project', recentKey: 'antigravity-recent-projects' },
  { kind: 'playlists', single: 'playlist', recentKey: 'antigravity-recent-playlists' },
] as const;
type Kind = (typeof KINDS)[number];

const ITEM_ID = 'e2e-cover-item';
const ITEM_NAME = 'COVER FIXTURE';

function coverUrlFor(shape: Shape | null, optimized: boolean): string | null {
  if (!shape) return null;
  return optimized
    ? `/e2e-cover-${shape}.png`
    : `data:image/png;base64,${SHAPES[shape].toString('base64')}`;
}

async function stub(page: Page, k: Kind, shape: Shape | null, optimized: boolean) {
  const cover_url = coverUrlFor(shape, optimized);
  const item = {
    id: ITEM_ID,
    name: ITEM_NAME,
    user_id: 'local-user',
    cover_url,
    preview_covers: [],
    description: null,
    status: 'in_progress',
    pinned: false,
    track_count: 0,
    tags: [],
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  };

  const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  // List, folders, and one item. Anything else under the prefix falls through
  // to the dev server.
  await page.route(new RegExp(`/api/${k.kind}(\\?.*)?$`), (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ [k.kind]: [item] })) : route.continue(),
  );
  await page.route(new RegExp(`/api/${k.kind}/folders(\\?.*)?$`), (route) => route.fulfill(json({ folders: [] })));
  await page.route(new RegExp(`/api/${k.kind}/${ITEM_ID}(\\?.*)?$`), (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ [k.single]: item })) : route.continue(),
  );
  await page.route(new RegExp(`/api/tracks\\?.*${k.single}_id=`), (route) => route.fulfill(json({ tracks: [] })));

  if (shape) {
    const png = SHAPES[shape];
    // next/image asks the optimizer; MediaCard's raw <img> asks for the path.
    await page.route(/\/_next\/image\?/, (route) => route.fulfill({ contentType: 'image/png', body: png }));
    await page.route(/\/e2e-cover-\w+\.png$/, (route) => route.fulfill({ contentType: 'image/png', body: png }));
  }

  // Make the item "recently opened" so its chip renders.
  await page.addInitScript(([key, id]) => {
    try { localStorage.setItem(key, JSON.stringify([id])); } catch { /* private mode */ }
  }, [k.recentKey, ITEM_ID] as const);
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    'dashboard is auth-gated here; run against local-store dev with no Supabase env',
  );
}

/** The cover image fills `box` exactly, cropped to cover, centred. */
async function expectCoverFills(box: Locator) {
  await expect(box).toBeVisible();
  const img = box.locator('img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  const b = (await box.boundingBox())!;
  const i = (await img.boundingBox())!;
  // 1–2px tolerance for borders.
  expect(Math.abs(i.x - b.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(i.y - b.y)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(i.width - b.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(i.height - b.height)).toBeLessThanOrEqual(3);

  const fit = await img.evaluate((el) => {
    const s = getComputedStyle(el);
    return { objectFit: s.objectFit, objectPosition: s.objectPosition };
  });
  expect(fit.objectFit).toBe('cover');
  expect(fit.objectPosition).toBe('50% 50%');
}

/** A missing cover renders generated artwork that fills `box`, and no <img> of ours. */
async function expectFallbackFills(box: Locator) {
  await expect(box).toBeVisible();
  await expect(box.locator('img[src^="/e2e-cover"], img[src^="data:"]')).toHaveCount(0);
  const fallback = box.locator('[role="presentation"]').first();
  await expect(fallback).toBeVisible();
  const b = (await box.boundingBox())!;
  const f = (await fallback.boundingBox())!;
  expect(Math.abs(f.width - b.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(f.height - b.height)).toBeLessThanOrEqual(3);
}

async function shoot(page: Page, name: string, box: Locator) {
  const b = (await box.boundingBox())!;
  const vp = page.viewportSize()!;
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    clip: { x: 0, y: Math.max(0, b.y - 24), width: vp.width, height: Math.min(vp.height, b.height + 48) },
  });
}

const CASES: { shape: Shape | null; optimized: boolean; label: string }[] = [
  ...(['square', 'portrait', 'landscape'] as Shape[]).flatMap((shape) => [
    { shape, optimized: true, label: `${shape} (next/image)` },
    { shape, optimized: false, label: `${shape} (plain img)` },
  ]),
  { shape: null, optimized: false, label: 'missing' },
];

for (const k of KINDS) {
  for (const vp of VIEWPORTS) {
    test.describe(`${k.kind} covers @ ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const c of CASES) {
        const tag = `${k.kind}-${vp.name}-${c.shape ?? 'missing'}-${c.optimized ? 'optimized' : 'plain'}`;

        test(`list: grid card + recently-opened chip — ${c.label}`, async ({ page }) => {
          await stub(page, k, c.shape, c.optimized);
          await goto(page, `/${k.kind}`);

          const chip = page.getByTestId('recent-cover').first();
          // The grid card for the fixture item (not a folder or other tile).
          const card = page.getByTestId('media-card-cover').first();

          if (c.shape) {
            await expectCoverFills(chip);
            // MediaCard renders its own <img>, never next/image; check it too.
            await expectCoverFills(card);
            // The chip's cover must not spill onto its own label.
            const label = page.getByRole('link', { name: ITEM_NAME }).first().getByText(ITEM_NAME);
            const lb = (await label.boundingBox())!;
            const onLabel = await page.evaluate(
              ([x, y]) => document.elementFromPoint(x, y)?.tagName !== 'IMG',
              [lb.x + lb.width / 2, lb.y + lb.height / 2],
            );
            expect(onLabel).toBe(true);
          } else {
            await expectFallbackFills(chip);
            await expectFallbackFills(card);
          }
          await shoot(page, `list-${tag}`, chip);
          await shoot(page, `card-${tag}`, card);
        });

        test(`detail: hero cover — ${c.label}`, async ({ page }) => {
          await stub(page, k, c.shape, c.optimized);
          await goto(page, `/${k.kind}/${ITEM_ID}`);

          const hero = page.getByRole('button', { name: c.shape ? 'Replace cover' : 'Add a cover' });
          if (c.shape) await expectCoverFills(hero);
          else await expectFallbackFills(hero);
          // Still keyboard-reachable as the click-to-replace control.
          await hero.focus();
          await expect(hero).toBeFocused();
          await shoot(page, `detail-${tag}`, hero);
        });
      }
    });
  }
}
