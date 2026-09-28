/**
 * Three more small cover boxes that had the Library hero's bug: an
 * `overflow-hidden` wrapper with no positioning around a next/image `fill`
 * cover, so the cover escaped the box and spread over whatever positioned
 * ancestor it found.
 *
 *   - the share-link cart drawer's line item (/share/[token], client variant)
 *   - the cover in the "Share project" modal (/projects/[id] → Share)
 *   - the collapsed player pill (bottom-right, any dashboard page)
 *
 * Same cases as the other cover specs: square / portrait / landscape through
 * next/image and through the plain <img>, plus a missing cover, at desktop /
 * tablet / mobile widths. API data is stubbed; see e2e/fixtures/stub-supabase.ts
 * for how the dashboard is signed in.
 */
import { test, type Page } from '@playwright/test';
import { SHAPES, type Shape } from './fixtures/cover-png';
import { expectCoverFills, expectFallbackFills, shoot } from './fixtures/cover-assert';
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

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const CASES: { shape: Shape | null; optimized: boolean; label: string }[] = [
  ...(['square', 'portrait', 'landscape'] as Shape[]).flatMap((shape) => [
    { shape, optimized: true, label: `${shape} (next/image)` },
    { shape, optimized: false, label: `${shape} (plain img)` },
  ]),
  { shape: null, optimized: false, label: 'missing' },
];

const TOKEN = 'e2e-cover-share';
const PROJECT_ID = 'e2e-cover-project';

function coverUrlFor(shape: Shape | null, optimized: boolean): string | null {
  if (!shape) return null;
  return optimized
    ? `/e2e-cover-${shape}.png`
    : `data:image/png;base64,${SHAPES[shape].toString('base64')}`;
}

function track(cover_url: string | null) {
  return {
    id: 'e2e-cover-track',
    user_id: 'local-user',
    title: 'COVER FIXTURE',
    type: 'beat',
    audio_url: '/e2e-bundle-tone.wav',
    peaks_url: null,
    cover_url,
    duration_seconds: 120,
    bpm: 140,
    key: 'F',
    scale: 'minor',
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function serveImage(page: Page, shape: Shape | null) {
  if (!shape) return;
  const png = SHAPES[shape];
  await page.route(/\/_next\/image\?/, (route) => route.fulfill({ contentType: 'image/png', body: png }));
  await page.route(/\/e2e-cover-\w+\.png$/, (route) => route.fulfill({ contentType: 'image/png', body: png }));
}

async function seedStorage(page: Page, entries: Record<string, string>) {
  await page.addInitScript((e) => {
    try { for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v); } catch { /* private mode */ }
  }, entries);
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    'dashboard is auth-gated here; run against local-store dev with no Supabase env',
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`shared covers @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const c of CASES) {
      const tag = `${vp.name}-${c.shape ?? 'missing'}-${c.optimized ? 'optimized' : 'plain'}`;
      const t = track(coverUrlFor(c.shape, c.optimized));

      test(`share-link cart item — ${c.label}`, async ({ page }) => {
        await serveImage(page, c.shape);
        await page.route(new RegExp(`/api/share/${TOKEN}(\\?.*)?$`), (route) =>
          route.fulfill(json({
            share: { title: 'Cover share', recipient_kind: 'client', sales_enabled: true, allow_downloads: false },
            tracks: [t],
            creator: null,
          })),
        );
        await seedStorage(page, {
          'antigravity-cart': JSON.stringify({
            state: {
              items: [{
                id: `${t.id}-lease-1`,
                track: t,
                license: { id: 'lease', name: 'Lease', price_usd: 30, file_types: ['mp3'], is_exclusive: false },
              }],
            },
            version: 0,
          }),
        });

        await page.goto(`/share/${TOKEN}`);
        // Every cart button opens the same drawer. The first is in a scroll-
        // revealed sticky header that sits off-screen at the top of the page,
        // so dispatch the click rather than asking Playwright to reach it.
        await page.locator('button:has(svg.lucide-shopping-cart)').first().dispatchEvent('click');
        const box = page.getByTestId('cart-item-cover');
        if (c.shape) await expectCoverFills(box);
        else await expectFallbackFills(box);
        await shoot(page, `cart-${tag}`, box);
      });

      test(`share project modal cover — ${c.label}`, async ({ page }) => {
        await serveImage(page, c.shape);
        const project = {
          id: PROJECT_ID,
          name: 'COVER FIXTURE',
          user_id: 'local-user',
          cover_url: t.cover_url,
          description: null,
          status: 'in_progress',
          created_at: '2026-09-01T00:00:00.000Z',
        };
        await page.route(new RegExp(`/api/projects/${PROJECT_ID}(\\?.*)?$`), (route) =>
          route.request().method() === 'GET' ? route.fulfill(json({ project })) : route.continue(),
        );
        await page.route(new RegExp(`/api/projects/${PROJECT_ID}/shares(\\?.*)?$`), (route) =>
          route.request().method() === 'GET' ? route.fulfill(json({ shares: [] })) : route.continue(),
        );
        await page.route(/\/api\/tracks\?.*project_id=/, (route) => route.fulfill(json({ tracks: [t] })));

        await goto(page, `/projects/${PROJECT_ID}`);
        await page.getByRole('button', { name: 'Share', exact: true }).click();
        const box = page.getByTestId('share-content-cover');
        if (c.shape) await expectCoverFills(box);
        else await expectFallbackFills(box);
        await shoot(page, `share-modal-${tag}`, box);
      });

      test(`collapsed player pill — ${c.label}`, async ({ page }) => {
        await serveImage(page, c.shape);
        await page.route(/\/api\/projects(\?.*)?$/, (route) => route.fulfill(json({ projects: [] })));
        await page.route(/\/api\/projects\/folders(\?.*)?$/, (route) => route.fulfill(json({ folders: [] })));
        await seedStorage(page, {
          'antigravity-player': JSON.stringify({
            state: { currentTrack: t, queue: [t], volume: 0, shuffle: false, repeat: 'off' },
            version: 0,
          }),
          'antigravity-player-collapsed': '1',
        });

        await goto(page, '/projects');
        const box = page.getByRole('button', { name: /^Expand player/ });
        if (c.shape) await expectCoverFills(box);
        else await expectFallbackFills(box);
        await shoot(page, `player-pill-${tag}`, box);
      });
    }
  });
}
