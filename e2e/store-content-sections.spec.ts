/**
 * Producer-authored storefront sections reach /store (STORE-07).
 *
 * `text`, `image`, `video`, `links` and `canvas` sections can be added in
 * /store-editor → Design, and the builder draws them through
 * `SectionRenderer`. /store's own section switch only knew the built-in kinds
 * and returned null for these, so a producer could compose a section, watch it
 * in the preview, save it, and buyers never saw it.
 *
 * /api/store is stubbed only to inject a layout — the real response is fetched
 * and passed through, so the catalogue and creator are whatever the e2e
 * server serves. Asserted at desktop and at 390px, plus one section hidden on
 * desktop only: the viewer's breakpoint reads desktop until hydration, and a
 * section that the renderer dropped for that breakpoint would be missing from
 * the HTML a phone receives.
 */
import { test, expect, type Page } from '@playwright/test';
import { defaultStoreLayout, type StoreLayout, type StoreSection } from '../src/lib/store-editor/layout';

const HEADING = 'Studio notes from the e2e fixture';
const BODY = 'Every beat here was made on the same two synths.';
const CANVAS_TEXT = 'Free-form block on the live page';
const PHONE_ONLY = 'Only phones see this line';

function section(id: string, kind: StoreSection['kind'], content: StoreSection['content'], extra: Partial<StoreSection> = {}): StoreSection {
  return {
    id,
    kind,
    name: id,
    locked: false,
    base: { visible: true, spacing: 4, width: 'wide', align: 'left', columns: 3, variant: 'default' },
    overrides: {},
    content,
    ...extra,
  };
}

function layoutWithContent(): StoreLayout {
  const layout = defaultStoreLayout();
  const text = section('sec-text-e2e', 'text', { heading: HEADING, body: BODY, ctaLabel: 'Get in touch', ctaHref: '/store/orders' });
  const canvas = section('sec-canvas-e2e', 'canvas', {
    blocks: [
      { id: 'blk-text', kind: 'text', x: 5, y: 10, width: 60, height: 30, text: CANVAS_TEXT },
      { id: 'blk-shape', kind: 'shape', x: 70, y: 10, width: 20, height: 60, color: '#6DC6A4' },
    ],
  });
  const phoneOnly = section('sec-text-phone', 'text', { body: PHONE_ONLY }, {
    base: { visible: false, spacing: 4, width: 'wide', align: 'left', columns: 3, variant: 'default' },
    overrides: { mobile: { visible: true } },
  });
  // After the hero, ahead of the pinned catalogue — where "Add section" puts them.
  const [hero, ...rest] = layout.sections;
  return { ...layout, sections: [hero, text, canvas, phoneOnly, ...rest] };
}

async function stubLayout(page: Page) {
  const layout = layoutWithContent();
  await page.route(/\/api\/store(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    body.creator = { ...(body.creator ?? { display_name: 'E2E Producer' }), store_layout: layout };
    await route.fulfill({ response, json: body });
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`text and canvas sections render on /store at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubLayout(page);
    await page.goto('/store');

    const text = page.locator('section[data-section-kind="text"]').filter({ hasText: HEADING });
    await expect(text).toBeVisible({ timeout: 30_000 });
    await expect(text.getByRole('heading', { name: HEADING })).toBeVisible();
    await expect(text.getByText(BODY)).toBeVisible();
    // Live, the CTA is a real link — in the builder it is a label.
    await expect(text.getByRole('link', { name: 'Get in touch' })).toHaveAttribute('href', '/store/orders');
    // The builder's placeholder copy never reaches a buyer.
    await expect(page.getByText('Add your text in the inspector.')).toHaveCount(0);

    const canvas = page.locator('section[data-section-kind="canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas.getByText(CANVAS_TEXT)).toBeVisible();
    // The frame has real size, and the block is positioned inside it by
    // percentage — i.e. it did not collapse or hang off a phone.
    const frame = await canvas.locator('div.relative').first().boundingBox();
    const block = await canvas.getByText(CANVAS_TEXT).boundingBox();
    expect(frame && frame.height).toBeGreaterThan(40);
    expect(block!.x).toBeGreaterThanOrEqual(frame!.x);
    expect(block!.x + block!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);

    // Visibility is CSS: the phone-only section is in the DOM on both, shown
    // only below md.
    const phoneOnly = page.getByText(PHONE_ONLY);
    await expect(phoneOnly).toHaveCount(1);
    if (viewport.name === 'mobile') await expect(phoneOnly).toBeVisible();
    else await expect(phoneOnly).toBeHidden();
  });
}
