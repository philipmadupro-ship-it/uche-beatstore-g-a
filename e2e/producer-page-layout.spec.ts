import { expect, test } from '@playwright/test';

/**
 * PROFILE-03: the public producer page at a phone and a desktop width.
 * /api/store/producer/:slug answers creator:null in local-store mode, so the
 * response is stubbed. Covers: no horizontal overflow, Follow is a toggle
 * (aria-pressed), and the play button is a sibling of the card's link, never
 * nested in an anchor.
 */
const track = (i: number) => ({
  id: `t${i}`, title: `Track ${i}`, type: 'beat', bpm: 120 + i, key: 'F', scale: 'minor',
  cover_url: null, preview_url: null, audio_url: null, duration_seconds: 150, store_listed: true,
});
const body = (rich: boolean) => rich
  ? {
      creator: {
        user_id: 'u1', display_name: 'E2E Producer', bio: 'Dark, melodic records.',
        credits: 'Artist A — Song A\nArtist B — Song B', instagram_handle: 'e2eproducer',
        website_url: 'https://example.com',
      },
      tracks: [0, 1, 2, 3, 4].map(track),
      playlists: [{ id: 'p1', name: 'A playlist with a rather long name indeed', cover_url: null }],
      projects: [{ id: 'pr1', name: 'Static EP', cover_url: null, price_usd: 120 }],
    }
  : { creator: { user_id: 'u1', display_name: 'E2E Producer' }, tracks: [], playlists: [], projects: [] };

for (const [label, width, height] of [['390', 390, 844], ['1440', 1440, 900]] as const) {
  for (const rich of [false, true]) {
    test(`producer page ${rich ? 'full' : 'sparse'} at ${label}: no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.route('**/api/store/producer/**', (r) => r.fulfill({ json: body(rich) }));
      await page.goto('/store/producer/e2e-producer');
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Producer' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const follow = page.getByRole('button', { name: /^follow$/i });
      await expect(follow).toHaveAttribute('aria-pressed', 'false');
      await follow.click();
      await expect(page.getByRole('button', { name: /^following$/i })).toHaveAttribute('aria-pressed', 'true');

      if (rich) {
        const play = page.getByRole('button', { name: 'Play Track 0' });
        await expect(play).toHaveCount(1);
        expect(await play.evaluate((el) => !!el.closest('a'))).toBe(false);
        await expect(page.locator('a[aria-label="Track 0"]')).toHaveAttribute('href', '/store/t0');
      } else {
        await expect(page.getByText('Nothing public yet')).toBeVisible();
      }
    });
  }
}
