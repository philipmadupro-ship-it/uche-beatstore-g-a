/**
 * Layout assertions shared by the cover specs: a cover image fills its box
 * exactly, cropped to cover and centred; a missing cover fills it with
 * generated artwork instead.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';

/** Wait until `box` stops moving: two animation frames with the same rect. */
async function settled(box: Locator) {
  await expect.poll(() => box.evaluate((el) => new Promise<boolean>((resolve) => {
    const a = el.getBoundingClientRect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const b = el.getBoundingClientRect();
      resolve(a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
    }));
  }))).toBe(true);
}

/** The cover image fills `box` exactly, cropped to cover, centred. */
export async function expectCoverFills(box: Locator) {
  await expect(box).toBeVisible();
  const img = box.locator('img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  await settled(box);
  // Both rects from one frame: measured separately, a box that is still
  // sliding in (a drawer, a modal) moves between the two reads.
  const { b, i } = await box.evaluate((el) => {
    const r = (e: Element) => { const { x, y, width, height } = e.getBoundingClientRect(); return { x, y, width, height }; };
    return { b: r(el), i: r(el.querySelector('img')!) };
  });
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
export async function expectFallbackFills(box: Locator) {
  await expect(box).toBeVisible();
  await expect(box.locator('img[src^="/e2e-cover"], img[src^="data:"]')).toHaveCount(0);
  const fallback = box.locator('[role="presentation"]').first();
  await expect(fallback).toBeVisible();
  await settled(box);
  const b = (await box.boundingBox())!;
  const f = (await fallback.boundingBox())!;
  expect(Math.abs(f.width - b.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(f.height - b.height)).toBeLessThanOrEqual(3);
}

export async function shoot(page: Page, name: string, box: Locator) {
  const b = (await box.boundingBox())!;
  const vp = page.viewportSize()!;
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    clip: { x: 0, y: Math.max(0, b.y - 24), width: vp.width, height: Math.min(vp.height, b.height + 48) },
  });
}
