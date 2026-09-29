/**
 * Store Editor → storefront typography and colour (STORE-06).
 *
 * The producer picks a font style (Sans / Serif / Mono), a text colour and an
 * accent in the Hero section. Three things were broken:
 *   1. the live preview ignored font style and text colour entirely;
 *   2. `text_color_primary` was stripped by the `/api/profile` contract, so it
 *      never reached `creator_profiles` and reset to white on reload;
 *   3. /store set the colour on its root, but every visible text node carried
 *      its own `text-white/*`, so nothing on the page actually used it.
 *
 * Nothing on the data path is stubbed: the e2e server runs on the local store
 * (ENABLE_LOCAL_STORE, `data/db.json`), so the save goes through the real
 * `/api/profile` route and contract, and /store reads the row back through the
 * real `/api/store`. The stub Supabase only signs the producer in. The fixture
 * profile is restored afterwards, since later specs share `data/db.json`.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
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
  // Supabase-only tables with no local-store branch: they 500 here, and the
  // editor loads everything in one Promise.all, so either would abort the
  // profile load. Neither is under test.
  await context.route(/\/api\/promo-codes(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ codes: [] }) }));
  await context.route(/\/api\/licenses(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ licenses: [] }) }));
});

const BIO = 'Store theme fixture bio — dark keys, slow drums.';
const TEXT_COLOR = '#6DC6A4';
const ACCENT = '#C8A47A';

async function computed(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, fontFamily: s.fontFamily };
  });
}

/**
 * Hero bio colour is the text colour at the 80% body copy uses. Compared by
 * resolving the expected value in the same browser, since Chromium serialises
 * color-mix() results in its own notation.
 */
async function expectTextColour(locator: Locator, hex: string) {
  const [got, want] = await locator.evaluate((el, h) => {
    const probe = document.createElement('span');
    probe.style.color = `color-mix(in srgb, ${h} 80%, transparent)`;
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, expected];
  }, hex);
  expect(got).toBe(want);
}

async function openHero(page: Page, reload = false) {
  // A goto to the same URL with a hash is a same-document navigation, not a
  // refresh; a real reload is what proves the values came from the server.
  if (reload) await page.reload();
  else await page.goto('/store-editor#hero');
  await expect(page.getByLabel('Storefront text colour', { exact: true })).toBeVisible({ timeout: 30_000 });
  // The form renders with defaults before the profile arrives, and the load
  // replaces the whole form when it lands. Wait for it (the fixture producer
  // has a display name), or edits and assertions race the load.
  await expect(page.getByPlaceholder('e.g. Uche Beats')).toHaveValue(/\S/, { timeout: 30_000 });
}

test('font style, text colour and accent: live preview, persistence, /store', async ({ page }) => {
  const original = (await (await page.request.get('/api/profile')).json()).profile ?? {};
  try {
    await themeRoundTrip(page);
  } finally {
    await page.request.patch('/api/profile', {
      data: {
        bio: original.bio ?? null,
        font_style: original.font_style ?? 'default',
        text_color_primary: original.text_color_primary ?? null,
        accent_color: original.accent_color ?? '#FFFFFF',
      },
    });
  }
});

async function themeRoundTrip(page: Page) {
  await openHero(page);
  const hero = page.locator('#section-hero');
  const preview = page.getByTestId('store-editor-preview');

  await hero.locator('textarea').first().fill(BIO);
  const previewBio = preview.locator('p', { hasText: BIO });
  await expect(previewBio).toBeVisible();

  // Baseline: the default face is Akira, the default text colour is white.
  expect((await computed(previewBio)).fontFamily).toContain('Akira Expanded');
  await expectTextColour(previewBio, '#FFFFFF');

  // 1. Live preview follows every font style, before any save.
  const serif = hero.getByRole('button', { name: 'Serif' });
  await serif.click();
  await expect(serif).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await computed(previewBio)).fontFamily).toContain('Synkopy');

  const mono = hero.getByRole('button', { name: 'Mono' });
  await mono.click();
  await expect(mono).toHaveAttribute('aria-pressed', 'true');
  await expect(serif).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await computed(previewBio)).fontFamily).toContain('Panchang');

  // …and the text colour.
  await page.getByLabel('Storefront text colour', { exact: true }).fill(TEXT_COLOR);
  await expect(() => expectTextColour(previewBio, TEXT_COLOR)).toPass();

  // A half-typed colour must not blank the preview's text.
  await page.getByLabel('Storefront text colour', { exact: true }).fill('#6D');
  await expect(() => expectTextColour(previewBio, '#FFFFFF')).toPass();
  await page.getByLabel('Storefront text colour', { exact: true }).fill(TEXT_COLOR);

  await page.getByLabel('Storefront accent colour', { exact: true }).fill(ACCENT);

  // 2. Save through the real route; the row keeps all three.
  const saved = page.waitForResponse((r) =>
    r.url().endsWith('/api/profile') && r.request().method() === 'PATCH' && r.request().postDataJSON()?.bio === BIO,
  );
  await page.getByRole('button', { name: /save changes/i }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  const { profile } = await res.json();
  expect(profile).toMatchObject({ font_style: 'mono', text_color_primary: TEXT_COLOR, accent_color: ACCENT });

  // 3. Refresh: the editor reads the stored values back.
  await openHero(page, true);
  await expect(page.getByLabel('Storefront text colour', { exact: true })).toHaveValue(TEXT_COLOR);
  await expect(page.getByLabel('Storefront accent colour', { exact: true })).toHaveValue(ACCENT);
  await expect(page.locator('#section-hero').getByRole('button', { name: 'Mono' })).toHaveAttribute('aria-pressed', 'true');
  const reloadedBio = page.getByTestId('store-editor-preview').locator('p', { hasText: BIO });
  expect((await computed(reloadedBio)).fontFamily).toContain('Panchang');
  await expectTextColour(reloadedBio, TEXT_COLOR);

  // 4. Public /store renders the persisted row, through the real /api/store.
  await page.goto('/store');
  const storeBio = page.locator('p', { hasText: BIO });
  await expect(storeBio).toBeVisible({ timeout: 30_000 });
  expect((await computed(storeBio)).fontFamily).toContain('Panchang');
  await expectTextColour(storeBio, TEXT_COLOR);
  const root = page.locator('.store-ui').first();
  expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--store-accent').trim())).toBe(ACCENT);
}

test('the preview follows the font style on a phone, too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHero(page);
  const hero = page.locator('#section-hero');
  await hero.locator('textarea').first().fill(BIO);
  await hero.getByRole('button', { name: 'Serif' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const previewBio = page.getByTestId('store-editor-preview').locator('p', { hasText: BIO });
  await expect(previewBio).toBeVisible();
  expect((await computed(previewBio)).fontFamily).toContain('Synkopy');
  // No sideways scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
