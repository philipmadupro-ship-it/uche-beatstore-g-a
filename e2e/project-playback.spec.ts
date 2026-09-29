/**
 * Project playback behaves like one music player (STORE-07).
 *
 * Two defects this pins, both seen in a browser against the old code:
 *   - A bought bundle's delivery page (/store/projects/access/[token]) drives
 *     the global player — Play all, every row — but the store layout did not
 *     mount the player there. Play all flipped to "Pause" and nothing played:
 *     there was no <audio> element on the page at all.
 *   - Leaving the player's layout (bundle → Buy bundle → checkout) removes its
 *     <audio>, which stops, but the store still said "playing". Coming Back
 *     mounted a new element that started on its own from 0:00.
 *
 * Plus the invariant the task asks for: across play / pause / seek / switch /
 * navigate away and back, there is never more than one audible element.
 *
 * The local fixture store has no projects or access links, so those two API
 * responses are stubbed. The pages, layout and player are real.
 */
import { test, expect, type Page } from '@playwright/test';

const BUNDLE_ID = 'e2e-playback-bundle';
const ACCESS_TOKEN = 'e2e-playback-token';
const SECONDS = 30;

const track = (n: number) => ({
  id: `e2e-playback-${n}`,
  title: `PLAYBACK ${n}`,
  type: 'beat',
  audio_url: `/e2e-playback-${n}.wav`,
  wav_url: null,
  peaks_url: null,
  cover_url: null,
  duration_seconds: SECONDS,
  bpm: 140,
  key: 'F',
  scale: 'minor',
  lease_price_usd: 30,
  exclusive_price_usd: 300,
  free_download_enabled: false,
});

const payload = {
  project: {
    id: BUNDLE_ID,
    name: 'Playback Bundle',
    cover_url: null,
    description: 'Fixture bundle for the playback spec.',
    price_usd: 49,
    store_featured: true,
    created_at: '2026-09-01T00:00:00.000Z',
  },
  tracks: [track(1), track(2), track(3)],
  creator: { display_name: 'E2E Producer', accent_color: null },
  artworkTheme: null,
};

/** Quiet 8 kHz mono PCM, long enough to seek around in. */
function toneWav(seconds = SECONDS, rate = 8000): Buffer {
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

async function stub(page: Page) {
  const json = { status: 200, contentType: 'application/json', body: JSON.stringify(payload) };
  await page.route(`**/api/store/projects/${BUNDLE_ID}`, (route) => route.fulfill(json));
  await page.route(`**/api/store/projects/access/${ACCESS_TOKEN}`, (route) => route.fulfill(json));
  // With Range support, as the real delivery and preview routes have: Chromium
  // cannot seek a media resource served without it, and restarts at 0:00.
  const wav = toneWav();
  await page.route('**/e2e-playback-*.wav', (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
    if (!range) {
      return route.fulfill({
        status: 200, contentType: 'audio/wav', body: wav, headers: { 'accept-ranges': 'bytes' },
      });
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: 206,
      contentType: 'audio/wav',
      body: wav.subarray(start, end + 1),
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${wav.length}` },
    });
  });
}

interface AudioState { src: string; paused: boolean; time: number }

function audios(page: Page): Promise<AudioState[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('audio')).map((a) => ({
      src: a.currentSrc || a.src,
      paused: a.paused,
      time: a.currentTime,
    })),
  );
}

async function audible(page: Page): Promise<AudioState[]> {
  return (await audios(page)).filter((a) => !a.paused);
}

/** Exactly one element is playing, it is `n`, and it is past `after` seconds. */
async function expectPlaying(page: Page, n: number, after = 0.3) {
  await expect
    .poll(async () => {
      const on = await audible(page);
      return on.length === 1 && on[0].src.includes(`e2e-playback-${n}.wav`) && on[0].time > after;
    })
    .toBe(true);
}

async function expectSilent(page: Page) {
  await expect.poll(async () => (await audible(page)).length).toBe(0);
}

test.describe('project playback', () => {
  test('delivery page: play all, pause, seek and switch tracks through one player', async ({ page }) => {
    await stub(page);
    await page.goto(`/store/projects/access/${ACCESS_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'Playback Bundle' })).toBeVisible();

    await page.getByRole('button', { name: 'Play all' }).click();
    await expectPlaying(page, 1);
    // The player bar is there to control it.
    await expect(page.getByRole('button', { name: 'Next track' }).first()).toBeVisible();

    // Pause from the page's own control; the bar follows.
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    await expectSilent(page);
    await expect(page.getByRole('button', { name: 'Play all' })).toBeVisible();

    // Resume and seek forward with the player's keyboard shortcut.
    await page.getByRole('button', { name: 'Play all' }).click();
    await expectPlaying(page, 1);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const before = (await audible(page))[0].time;
    await page.keyboard.press('ArrowRight'); // +5 s
    await expect.poll(async () => (await audible(page))[0]?.time ?? 0).toBeGreaterThan(before + 4);
    expect(await audios(page)).toHaveLength(1);

    // Switch tracks from the bar: the same single element moves on.
    await page.getByRole('button', { name: 'Next track' }).first().click();
    await expectPlaying(page, 2, 0.1);
    expect(await audios(page)).toHaveLength(1);
  });

  test('bundle page: browsing away and back inside the store keeps one continuous stream', async ({ page }) => {
    await stub(page);
    await page.goto(`/store/projects/${BUNDLE_ID}`);
    await expect(page.getByRole('heading', { name: 'Playback Bundle' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();
    await expectPlaying(page, 1, 1);
    const t0 = (await audible(page))[0].time;

    await page.getByRole('link', { name: 'E2E Producer' }).first().click();
    await expect(page).toHaveURL(/\/store\/producer\//);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Playback Bundle' })).toBeVisible();

    // Same track, still moving forward — never restarted, never doubled.
    await expectPlaying(page, 1, t0);
    expect(await audios(page)).toHaveLength(1);
  });

  test('bundle page → checkout → Back: stops honestly, then resumes where it was on request', async ({ page }) => {
    await stub(page);
    await page.goto(`/store/projects/${BUNDLE_ID}`);
    await expect(page.getByRole('heading', { name: 'Playback Bundle' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview' }).click();
    await expectPlaying(page, 1, 3);
    const leftAt = (await audible(page))[0].time;

    // Checkout hides the player, so its element goes and the audio stops.
    await page.getByRole('button', { name: /Buy bundle/i }).first().click();
    await expect(page).toHaveURL(/\/store\/checkout/);
    await expectSilent(page);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Playback Bundle' })).toBeVisible();

    // Nothing starts by itself, and the controls say so.
    await page.waitForTimeout(1500);
    await expectSilent(page);
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();

    // Play resumes the same track near where the buyer left it, not at 0:00.
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await expectPlaying(page, 1, leftAt - 1);
    expect(await audios(page)).toHaveLength(1);
  });

  test('delivery page at phone width: the player fits and plays', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stub(page);
    await page.goto(`/store/projects/access/${ACCESS_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'Playback Bundle' })).toBeVisible();

    await page.getByRole('button', { name: 'Play all' }).click();
    await expectPlaying(page, 1);
    await expect(page.getByRole('button', { name: /Pause/ }).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
