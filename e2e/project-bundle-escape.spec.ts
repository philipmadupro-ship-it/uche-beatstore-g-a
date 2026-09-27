/**
 * Getting OUT of a project bundle and its Now Playing waveform.
 *
 * Three ways out had to work and none did reliably:
 *   - the bundle page had no explicit back control at all;
 *   - browser Back changed the route but left the Now Playing overlay (it lives
 *     in the store layout) covering the page underneath;
 *   - inside the overlay, every playback tick re-ran the dialog effect and
 *     snapped focus back to Close, so a keyboard user could not reach the
 *     waveform scrubber.
 *
 * The local fixture store has no projects, so the bundle's API response is
 * stubbed. Everything else — the page, the player, the overlay — is real.
 */
import { test, expect, type Page } from '@playwright/test';

const BUNDLE_ID = 'e2e-bundle-escape';

const bundle = {
  project: {
    id: BUNDLE_ID,
    name: 'Escape Hatch',
    cover_url: null,
    description: 'Fixture bundle for the escape-behaviour spec.',
    price_usd: 49,
    store_featured: true,
    created_at: '2026-09-01T00:00:00.000Z',
  },
  tracks: [
    {
      id: 'e2e-bundle-track-1',
      title: 'EXIT WOUND',
      type: 'beat',
      audio_url: '/e2e-bundle-tone.wav',
      peaks_url: null,
      cover_url: null,
      duration_seconds: 150,
      bpm: 140,
      key: 'F',
      scale: 'minor',
      lease_price_usd: 30,
      exclusive_price_usd: 300,
      free_download_enabled: false,
    },
  ],
  creator: { display_name: 'E2E Producer', accent_color: null },
  artworkTheme: null,
};

/**
 * 30s of quiet 8kHz mono PCM. Real audio matters: the focus snap-back only
 * happened while playback ticks were re-rendering the player.
 */
function toneWav(seconds = 30, rate = 8000): Buffer {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i++) buf[44 + i] = 128 + Math.round(4 * Math.sin((2 * Math.PI * 220 * i) / rate));
  return buf;
}

async function stubBundle(page: Page) {
  await page.route(`**/api/store/projects/${BUNDLE_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) }),
  );
  const wav = toneWav();
  await page.route('**/e2e-bundle-tone.wav', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );
}

/** Store → bundle, as a buyer would arrive, so Back has somewhere to go. */
async function openBundleFromStore(page: Page) {
  await stubBundle(page);
  await page.goto('/store');
  await page.goto(`/store/projects/${BUNDLE_ID}`);
  await expect(page.getByRole('heading', { name: 'Escape Hatch' })).toBeVisible();
}

async function openNowPlaying(page: Page) {
  await page.getByRole('button', { name: 'Preview' }).click();
  const opener = page.getByRole('button', { name: 'Open Now Playing' });
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Now playing' });
  await expect(dialog).toBeVisible();
  return { opener, dialog };
}

test.describe('project bundle escape behaviour', () => {
  test('explicit Back to store link leaves the bundle', async ({ page }) => {
    await openBundleFromStore(page);
    const back = page.getByRole('link', { name: 'Back to store' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/store\/?$/);
  });

  test('Escape closes Now Playing and returns focus to its opener', async ({ page }) => {
    await openBundleFromStore(page);
    const { opener, dialog } = await openNowPlaying(page);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/store/projects/${BUNDLE_ID}$`));
  });

  test('explicit Close button closes Now Playing', async ({ page }) => {
    await openBundleFromStore(page);
    const { opener, dialog } = await openNowPlaying(page);

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('one tap on Preview plays, with no "Tap play" prompt', async ({ page }) => {
    // The engine read every rejected play() as a blocked autoplay. A play()
    // interrupted by its own reload (AbortError) put "Tap play to start this
    // preview." on a preview the buyer had just tapped, and left it paused.
    await openBundleFromStore(page);
    await page.getByRole('button', { name: 'Preview' }).click();

    await expect
      .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('audio')).some((a) => !a.paused && a.currentTime > 0.5)))
      .toBe(true);
    await expect(page.getByText('Ready to resume')).toHaveCount(0);
    await expect(page.getByText('Tap play', { exact: true })).toHaveCount(0);
  });

  test('keyboard focus is not snapped back to Close inside Now Playing', async ({ page }) => {
    await openBundleFromStore(page);
    const { dialog } = await openNowPlaying(page);

    // Playback must actually be ticking — that is what re-rendered the player.
    await expect
      .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('audio')).some((a) => a.currentTime > 0)))
      .toBe(true);

    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    const queue = dialog.getByRole('button', { name: 'Queue' });
    await expect(queue).toBeFocused();

    // Several playback ticks later, focus must still be where the user put it.
    await page.waitForTimeout(1500);
    await expect(queue).toBeFocused();
  });

  test('browser Back with Now Playing open closes it on the page Back lands on', async ({ page }) => {
    // Client-side navigation only: page.goto() is a full document load, which
    // remounts the layout and would hide the bug. A buyer moves between store
    // pages with links, so Back is a same-document popstate and the layout's
    // player — and its overlay — survive it.
    await stubBundle(page);
    await page.goto(`/store/projects/${BUNDLE_ID}`);
    await expect(page.getByRole('heading', { name: 'Escape Hatch' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();

    await page.getByRole('link', { name: 'E2E Producer' }).first().click();
    await expect(page).toHaveURL(/\/store\/producer\//);

    await page.getByRole('button', { name: 'Open Now Playing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    await expect(dialog).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/store/projects/${BUNDLE_ID}$`));
    await expect(page.getByRole('heading', { name: 'Escape Hatch' })).toBeVisible();
    await expect(dialog).toBeHidden();

    // Forward again: the overlay must not come back on its own.
    await page.goForward();
    await expect(page).toHaveURL(/\/store\/producer\//);
    await expect(dialog).toBeHidden();
  });
});
