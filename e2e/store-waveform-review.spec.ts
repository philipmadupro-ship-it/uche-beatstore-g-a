/**
 * Review screenshots of the 3-band waveform on REAL audio (a public store
 * preview), in both palettes. The audio is a local fixture (gitignored,
 * e2e-artifacts/fixtures/real-preview.bin or E2E_REAL_AUDIO); without it the
 * spec falls back to a synthetic signal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const REAL = process.env.E2E_REAL_AUDIO ?? path.join(__dirname, '..', 'e2e-artifacts', 'fixtures', 'real-preview.bin');
const HAVE_REAL = fs.existsSync(REAL);

function synthetic(seconds = 30, rate = 22050): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let seed = 7;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / rate; const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * (52 + 90 * Math.exp(-beat * 18)) * t) * Math.exp(-beat * 6);
    const chord = (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554 * t) + Math.sin(2 * Math.PI * 659 * t)) / 3 * Math.exp(-((t + 0.25) % 0.5) * 4) * (0.5 + 0.5 * Math.sin(t * 0.7));
    const hp = noise() - lp; lp += 0.35 * (noise() - lp);
    const hats = hp * Math.exp(-(t % 0.25) * 36) * 0.4;
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.8 * kick + 0.5 * chord + hats)) * 0.8 * 32767), 44 + i * 2);
  }
  return buf;
}
const AUDIO = HAVE_REAL ? fs.readFileSync(REAL) : synthetic();

const audioTime = (page: Page) => page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement | null)?.currentTime ?? -1);

async function openAndPlay(page: Page, palette: 'rekordbox3band' | 'rgb') {
  await page.addInitScript((p) => { try { localStorage.setItem('antigravity-wave-palette', p); } catch { /* ignore */ } }, palette);
  await page.route('**/api/store/preview/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'cache-control': 'no-store' }, body: AUDIO }));
  await page.goto('/store');
  const card = page.locator('[id^="beat-"]').first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => audioTime(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
  const slider = page.locator('[role="dialog"] [data-band-scrubber]').first();
  await expect(slider).toHaveAttribute('data-wave-source', 'analysis', { timeout: 30_000 });
  return slider;
}

const seek = (page: Page, s: number) => page.evaluate((t) => { (document.querySelector('audio') as HTMLAudioElement).currentTime = t; }, s);

for (const palette of ['rekordbox3band', 'rgb'] as const) {
  const tag = palette === 'rgb' ? 'rgb' : 'rekordbox';
  for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
    test(`${tag} scrubber playing @${vp.n} (drawer, mid-track)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const slider = await openAndPlay(page, palette);
      await seek(page, 34);
      await page.waitForTimeout(900);
      await expect(slider).toBeVisible();
      await page.screenshot({ path: `e2e-artifacts/store-visuals/${tag}-scrubber-playing-${vp.n}.png` });
    });
  }

  test(`${tag} close-up @2x`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const slider = await openAndPlay(page, palette);
    await seek(page, 34);
    await page.waitForTimeout(900);
    await slider.screenshot({ path: `e2e-artifacts/store-visuals/${tag}-closeup-2x.png` });
    await ctx.close();
  });
}

test('rekordbox now playing @390 (scrubber visible)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAndPlay(page, 'rekordbox3band');
  await seek(page, 34);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Now Playing' }).click();
  await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'e2e-artifacts/store-visuals/rekordbox-nowplaying-390.png' });
});

// Final review frames: the pulse near the playhead on a kick and in a quiet moment.
test('final: close-up, reactive kick/quiet, now playing @390', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const slider = await openAndPlay(page, 'rekordbox3band');
  await seek(page, 34);
  await page.waitForTimeout(900);
  await slider.screenshot({ path: 'e2e-artifacts/store-visuals/final-closeup-2x.png' });
  const canvas = slider.locator('canvas').first();
  const live = () => canvas.evaluate((c) => Number((c as HTMLCanvasElement).dataset.live ?? -1));
  // Reacts: over a few seconds the live energy swings, not a constant.
  const seen: number[] = [];
  for (let i = 0; i < 80; i += 1) { seen.push(await live()); await page.waitForTimeout(50); }
  const hi = Math.max(...seen); const lo = Math.min(...seen);
  console.log(`live energy range ${lo}..${hi}`);
  // Reactivity is asserted on the real fixture only; CI has no fixture and no audio device.
  if (HAVE_REAL) expect(hi - lo).toBeGreaterThan(0.3);
  else { await ctx.close(); return; }
  const grab = async (name: string, ok: (v: number) => boolean) => {
    for (let i = 0; i < 1500; i += 1) {
      if (ok(await live())) { await slider.screenshot({ path: `e2e-artifacts/store-visuals/${name}.png` }); return; }
      await page.waitForTimeout(10);
    }
  };
  await grab('final-reactive-kick', (v) => v >= lo + (hi - lo) * 0.7);
  await grab('final-reactive-quiet', (v) => v <= lo + (hi - lo) * 0.15);
  await ctx.close();
});

test('final: now playing @390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAndPlay(page, 'rekordbox3band');
  await seek(page, 34);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Now Playing' }).click();
  await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'e2e-artifacts/store-visuals/final-nowplaying-390.png' });
});
