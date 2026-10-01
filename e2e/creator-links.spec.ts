/**
 * PROFILE-02: the producer's links on /store/producer/[slug] go where they say.
 *
 * The profile stores free text. The page used to interpolate it into `href`, so
 * a pasted profile URL became a doubled path, a bare domain became a relative
 * link into our own site, and `javascript:` was emitted verbatim. The producer
 * API is stubbed with exactly those shapes; the page, its rendering and every
 * click are real. External destinations are answered locally so the check does
 * not depend on the network.
 */
import { test, expect, type Page } from '@playwright/test';

const creator = (over: Record<string, unknown>) => ({
  user_id: 'e2e-producer',
  display_name: 'E2E Producer',
  bio: 'Fixture producer.',
  accent_color: null,
  store_layout: null,
  ...over,
});

async function stubProducer(page: Page, c: Record<string, unknown>) {
  await page.route('**/api/store/producer/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ creator: c, artworkTheme: null, tracks: [], playlists: [], projects: [] }),
  }));
  // External destinations resolve locally, whatever the sandbox's network does.
  await page.context().route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({ contentType: 'text/html', body: '<title>external</title>' }));
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`creator links @ ${viewport.width}px`, () => {
    test.use({ viewport });

    test('messy values become working destinations; unusable ones render nothing', async ({ page }) => {
      await stubProducer(page, creator({
        instagram_handle: 'https://www.instagram.com/uche/',
        twitter_handle: '@uche_x',
        spotify_url: 'open.spotify.com/artist/abc',
        soundcloud_url: 'javascript:window.__pwned=1',
        website_url: 'https://uche.example',
        contact_email: 'hi@uche.example',
      }));
      await page.goto('/store/producer/e2e-producer');

      await expect(page.getByText('Links', { exact: true })).toBeVisible();
      const expected: Record<string, string> = {
        '@uche': 'https://instagram.com/uche',
        '@uche_x': 'https://x.com/uche_x',
        Spotify: 'https://open.spotify.com/artist/abc',
        Website: 'https://uche.example',
        'hi@uche.example': 'mailto:hi@uche.example',
      };
      await expect(page.getByRole('link', { name: 'SoundCloud' })).toHaveCount(0);
      for (const [text, href] of Object.entries(expected)) {
        const link = page.getByRole('link', { name: text, exact: true });
        await expect(link, text).toHaveAttribute('href', href);
        await link.scrollIntoViewIfNeeded();
        if (href.startsWith('mailto:')) continue; // no mail client in CI; the href is the contract
        const popup = page.waitForEvent('popup');
        await link.click();
        const opened = await popup;
        await opened.waitForLoadState('domcontentloaded');
        expect(opened.url().replace(/\/$/, ''), text).toBe(href);
        await opened.close();
      }
      // Nothing on the page carries a scripting scheme, and nothing ran.
      expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    });

    test('with only unusable values there is no Links panel', async ({ page }) => {
      await stubProducer(page, creator({
        instagram_handle: 'two words', spotify_url: 'data:text/html,x', website_url: '//evil.example', contact_email: 'a@b.co?cc=c@d.co',
      }));
      await page.goto('/store/producer/e2e-producer');
      await expect(page.getByRole('heading', { name: 'E2E Producer' })).toBeVisible();
      await expect(page.getByText('Links', { exact: true })).toHaveCount(0);
    });
  });
}
