import { expect, test } from '@playwright/test';

/**
 * STORE-10: a track with 60 tags must not make the detail page eleven rows
 * tall. The local-store /api/store/[id] route returns no tags (only the
 * Supabase path does), so the response is completed with a fixed tag set.
 */
const cats = ['genre', 'mood', 'instrument', 'status', 'custom'];
const tagsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ tag: `Tag number ${i + 1}`, category: cats[i % 5] }));

for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }]) {
  test.describe(`store tag overflow @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    async function open(page: import('@playwright/test').Page, n: number) {
      await page.route(/\/api\/store\/track-demo-001$/, async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        json.tags = tagsOf(n);
        await route.fulfill({ response: res, json });
      });
      await page.goto('/store/track-demo-001');
      return page.getByTestId('store-tag-list');
    }

    test('60 tags collapse to 8 plus a toggle, and expand and collapse again', async ({ page }) => {
      const list = await open(page, 60);
      await expect(list).toBeVisible();
      const toggle = list.getByRole('button', { name: '+52 more' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(list.locator('span')).toHaveCount(8);
      const collapsedHeight = (await list.boundingBox())!.height;
      expect(collapsedHeight).toBeLessThan(120);

      await toggle.click();
      const less = list.getByRole('button', { name: 'Show less' });
      await expect(less).toHaveAttribute('aria-expanded', 'true');
      await expect(list.locator('span')).toHaveCount(60);

      await less.click();
      await expect(list.locator('span')).toHaveCount(8);
    });

    test('10 tags show 8 plus a toggle, 1 tag shows no toggle', async ({ page }) => {
      let list = await open(page, 10);
      await expect(list.locator('span')).toHaveCount(8);
      await expect(list.getByRole('button', { name: '+2 more' })).toBeVisible();
      await page.unrouteAll();
      list = await open(page, 1);
      await expect(list.locator('span')).toHaveCount(1);
      await expect(list.getByRole('button')).toHaveCount(0);
    });
  });
}
