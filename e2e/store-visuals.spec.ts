/**
 * Store audio visuals: play a beat, the canvas draws, audio still plays (not
 * muted/silent), reduced motion shows a static frame. The preview stream is
 * stubbed with a real 12 s WAV on the SAME origin (/api/store/preview/<id>) —
 * the analysable path. Screenshots of every mode go to e2e-artifacts/ (not
 * committed).
 */
import { test, expect, type Page } from '@playwright/test';

function wav(seconds = 12, rate = 22050): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const kick = Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-(t % 0.5) * 18)) * t) * Math.exp(-(t % 0.5) * 7);
    const lead = 0.35 * Math.sin(2 * Math.PI * (440 + 220 * Math.sin(t * 2)) * t);
    buf.writeInt16LE(Math.round((0.6 * kick + lead) * 0.6 * 32767), 44 + i * 2);
  }
  return buf;
}
const WAV = wav();

async function stubAudio(page: Page) {
  await page.route('**/api/store/preview/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'cache-control': 'no-store' }, body: WAV }));
}

const canvas = (page: Page) => page.locator('[data-testid="audio-visual-canvas"]:visible').first();
const frame = (page: Page) => canvas(page).evaluate((c: HTMLCanvasElement) => c.toDataURL());
const audioTime = (page: Page) => page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement | null)?.currentTime ?? -1);

async function openAndPlay(page: Page) {
  await stubAudio(page);
  await page.goto('/store');
  const card = page.locator('[id^="beat-"]').first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Play', exact: true }).first().click();
}

for (const vp of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
  test.describe(`store visuals @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('plays, canvas animates from live analysis, audio advances, all modes drawn', async ({ page }) => {
      await openAndPlay(page);
      await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
      const t1 = await audioTime(page);
      await expect(canvas(page)).toBeVisible();
      const a = await frame(page);
      await page.waitForTimeout(700);
      const b = await frame(page);
      expect(b).not.toBe(a); // pixels change while playing
      expect(await audioTime(page)).toBeGreaterThan(t1); // not silent/stalled
      const muted = await page.evaluate(() => { const e = document.querySelector('audio')!; return e.muted || e.volume === 0 || e.paused; });
      expect(muted).toBe(false);
      // same-origin source: the shared analyser must be live.
      await expect(canvas(page)).toHaveAttribute('data-source', 'live', { timeout: 5_000 });
      await page.screenshot({ path: `e2e-artifacts/store-visuals/drawer-terrain-${vp.name}.png` });

      // Expanded player: every mode.
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Open Now Playing' }).click();
      const group = page.getByRole('radiogroup', { name: 'Visual style' });
      await expect(group).toBeVisible();
      for (const mode of ['Terrain', 'Curve', 'Orbit', 'Meters']) {
        await group.getByRole('radio', { name: mode }).click();
        await page.waitForTimeout(500);
        await expect(group.getByRole('radio', { name: mode })).toHaveAttribute('aria-checked', 'true');
        const dialog = page.getByRole('dialog', { name: 'Now playing' });
        await dialog.screenshot({ path: `e2e-artifacts/store-visuals/player-${mode.toLowerCase()}-${vp.name}.png` });
      }
      // Choice is remembered.
      await page.reload();
      expect(await page.evaluate(() => localStorage.getItem('antigravity-visual-mode'))).toBe('meters');
    });

    test('reduced motion draws a static frame and playback still works', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openAndPlay(page);
      await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
      await expect(canvas(page)).toBeVisible();
      await expect(canvas(page)).toHaveAttribute('data-source', 'peaks');
      // Not blank: some non-background pixel exists.
      const painted = await canvas(page).evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 60) return true;
        return false;
      });
      expect(painted).toBe(true);
      await page.screenshot({ path: `e2e-artifacts/store-visuals/reduced-motion-${vp.name}.png` });
    });
  });
}
