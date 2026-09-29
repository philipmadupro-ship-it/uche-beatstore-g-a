/**
 * Producer-authored Design sections (text / image / video / links / canvas)
 * render on the live /store.
 *
 * They used to reach only the builder: `/store`'s section switch knew the
 * built-in kinds and returned null for these. The layout is served through a
 * stubbed `/api/store` on top of the real response, so the rest of the page is
 * the fixture storefront.
 */
import { test, expect, type Page } from '@playwright/test';
import { defaultStoreLayout, type StoreSection } from '../src/lib/store-editor/layout';

function authored(id: string, kind: StoreSection['kind'], content: StoreSection['content'], overrides: StoreSection['overrides'] = {}): StoreSection {
  return {
    id,
    kind,
    name: id,
    locked: false,
    base: { visible: true, variant: 'default', columns: 4, spacing: 2, width: 'wide', align: 'left' },
    overrides,
    content,
  };
}

function layoutWithAuthoredSections() {
  const layout = defaultStoreLayout();
  const [hero, ...rest] = layout.sections;
  layout.sections = [
    hero,
    authored('e2e-text', 'text', {
      heading: 'E2E AUTHORED HEADING',
      body: 'Mixes delivered in 48 hours.',
      ctaLabel: 'Book a session',
      ctaHref: '/store/producer/e2e',
    }),
    authored('e2e-empty-text', 'text', {}),
    authored('e2e-links', 'links', {}),
    authored('e2e-video', 'video', { heading: 'E2E video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }),
    authored('e2e-bad-video', 'video', { videoUrl: 'https://example.com/clip.mp4' }),
    authored('e2e-bad-cta', 'text', { heading: 'E2E SCRIPT CTA', ctaLabel: 'Click', ctaHref: 'javascript:alert(1)' }),
    authored('e2e-canvas', 'canvas', {
      blocks: [{ id: 'blk', kind: 'text', x: 10, y: 10, width: 60, height: 30, text: 'E2E CANVAS BLOCK' }],
    }),
    authored('e2e-desktop-only', 'text', { heading: 'E2E DESKTOP ONLY' }, { mobile: { visible: false } }),
    ...rest,
  ];
  return layout;
}

async function stubLayout(page: Page) {
  await page.route(/\/api\/store(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        creator: {
          ...(body.creator ?? {}),
          instagram_handle: 'e2e.producer',
          website_url: 'https://e2e.example',
          store_layout: layoutWithAuthoredSections(),
        },
      },
    });
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`authored Design sections render on /store (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await stubLayout(page);
    await page.goto('/store');

    await expect(page.getByRole('heading', { name: 'E2E AUTHORED HEADING' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Mixes delivered in 48 hours.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book a session' })).toHaveAttribute('href', '/store/producer/e2e');

    // Links section: real anchors built from the profile.
    await expect(page.getByRole('link', { name: 'Instagram' }).first()).toHaveAttribute('href', 'https://instagram.com/e2e.producer');

    // Only the embeddable video, rewritten to the no-cookie player.
    const frames = page.locator('section[data-section-kind="video"] iframe');
    await expect(frames).toHaveCount(1);
    await expect(frames.first()).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

    // A javascript: CTA is dropped: neither a link nor a dead button.
    await expect(page.getByRole('heading', { name: 'E2E SCRIPT CTA' })).toBeVisible();
    await expect(page.getByText('Click', { exact: true })).toHaveCount(0);

    await expect(page.getByText('E2E CANVAS BLOCK')).toBeVisible();

    // Builder hints never reach a buyer.
    for (const hint of [/in the inspector/i, /won.t play on your store/i, /won.t show on your store/i, /No social links/i]) {
      await expect(page.getByText(hint)).toHaveCount(0);
    }

    // Per-device visibility is CSS on the cached page.
    const desktopOnly = page.getByRole('heading', { name: 'E2E DESKTOP ONLY' });
    if (viewport.name === 'mobile') await expect(desktopOnly).toBeHidden();
    else await expect(desktopOnly).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/store-authored-sections-${viewport.name}.png`, fullPage: false });
  });
}
