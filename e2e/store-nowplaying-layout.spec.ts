/**
 * Now Playing layout: with no scrolling, the scrubber and the transport must
 * sit inside both the modal's visible area and the viewport.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

function wav(seconds = 8, rate = 22050): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 110 * t) * Math.exp(-(t % 0.5) * 7) * 0.6 * 32767), 44 + i * 2);
  }
  return buf;
}
const WAV = wav();

const TRACK = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Midnight Run', type: 'beat', bpm: 140, key: 'F', scale: 'minor',
  audio_url: '/api/store/preview/00000000-0000-4000-8000-000000000001', preview_url: null, cover_url: null,
  duration_seconds: 8, store_listed: true, lease_price_usd: 30, exclusive_price_usd: 300, tags: [],
  created_at: '2026-01-01T00:00:00Z',
};

async function openNowPlaying(page: Page) {
  await page.route('**/api/store/facets', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/store/momentum', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/store?*', (route) =>
    route.fulfill({ json: { creator: null, artworkTheme: null, tracks: [TRACK], licenses: [], featuredPlaylists: [], featuredProjects: [], pageInfo: { hasMore: false, nextCursor: null } } }));
  await page.route('**/api/store/preview/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'cache-control': 'no-store' }, body: WAV }));
  await page.goto('/store');
  const card = page.locator('[id^="beat-"]').first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForFunction(() => ((document.querySelector('audio') as HTMLAudioElement | null)?.currentTime ?? 0) > 0.3, null, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Now Playing' }).click();
  await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible();
}

for (const vp of [
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
]) {
  test.describe(`now playing layout @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('scrubber and transport are visible on open without scrolling', async ({ page }) => {
      const logs: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
      page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
      await openNowPlaying(page);
      await page.waitForTimeout(600);
      console.log(`CONSOLE@${vp.name} ${JSON.stringify(logs)}`); // let the open animation settle
      const m = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-label="Now playing"]')!;
        const r = (el: Element | null) => { const b = el!.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
        const buttons = ['Previous track', 'Next track', 'Pause', 'Play'].map((n) => dlg.querySelector(`button[aria-label="${n}"]`)).filter(Boolean) as Element[];
        return {
          vh: window.innerHeight,
          dialog: r(dlg),
          cover: r(dlg.querySelector('div.rounded-\\[12px\\]')),
          stage: r(dlg.querySelector('[data-testid="audio-visual-canvas"]')),
          scrubber: r(dlg.querySelector('[data-band-scrubber]')),
          volume: r(dlg.querySelector('input[aria-label="Volume"]')),
          overflow: dlg.scrollHeight - dlg.clientHeight,
          transportBottom: Math.max(...buttons.map((b) => r(b).bottom)),
        };
      });
      console.log(`LAYOUT@${vp.name} ${JSON.stringify(m)}`);
      const limit = Math.min(m.vh, m.dialog.bottom);
      expect(m.scrubber.bottom).toBeLessThanOrEqual(limit);
      expect(m.transportBottom).toBeLessThanOrEqual(limit);
      expect(m.volume.bottom).toBeLessThanOrEqual(limit);
      expect(m.overflow).toBe(0);
      expect(m.stage.bottom).toBeLessThan(m.scrubber.top);
      mkdirSync('screens', { recursive: true });
      await page.screenshot({ path: `screens/layout-nowplaying-${vp.name}.png` });
    });
  });
}
