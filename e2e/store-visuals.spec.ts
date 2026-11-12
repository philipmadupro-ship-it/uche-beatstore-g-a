/**
 * Store audio visuals: play a beat, the canvas draws, audio still plays (not
 * muted/silent), reduced motion shows a static frame. The preview stream is
 * stubbed with a real 12 s WAV on the SAME origin (/api/store/preview/<id>) —
 * the analysable path. Screenshots of every mode go to e2e-artifacts/ (not
 * committed).
 */
import { test, expect, type Page } from '@playwright/test';

function wav(seconds = 30, rate = 22050): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let seed = 1;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  let lp = 0;
  let prev1 = 0;
  let prev2 = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    let v: number;
    if (t < 2) {
      // LEGEND 1/3 — bass only: an 808 at 50 Hz, two hits
      const e = Math.exp(-(t % 1) * 3);
      v = 0.85 * Math.sin(2 * Math.PI * (50 + 6 * e) * t) * e;
    } else if (t < 4) {
      // LEGEND 2/3 — mids only: a chord stab around 600–2000 Hz, four hits
      const e = Math.exp(-(t % 0.5) * 6);
      v = 0.3 * e * (Math.sin(2 * Math.PI * 600 * t) + Math.sin(2 * Math.PI * 900 * t) + Math.sin(2 * Math.PI * 1400 * t) + Math.sin(2 * Math.PI * 2000 * t));
    } else if (t < 6) {
      // LEGEND 3/3 — hats only: noise differentiated twice (energy far above 6 kHz)
      const r = noise();
      const d = r - 2 * prev1 + prev2; prev2 = prev1; prev1 = r;
      v = 0.28 * d * Math.exp(-(t % 0.125) * 40);
    } else {
      // the full mix: kick + chord stabs + hi-hats
      const beat = t % 0.5;
      const kick = Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-beat * 18)) * t) * Math.exp(-beat * 7);
      const stab = (t + 0.25) % 0.5;
      const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t)) / 3 * Math.exp(-stab * 5);
      const hat = t % 0.25;
      const raw = noise();
      const hp = raw - lp; lp += 0.35 * (raw - lp);
      const hats = hp * Math.exp(-hat * 38) * (Math.floor(t / 0.25) % 2 ? 1 : 0.6);
      v = 0.75 * kick + 0.5 * chord + 0.35 * hats;
    }
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 0.8 * 32767), 44 + i * 2);
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
      for (const mode of ['Orbit', 'Terrain', 'Curve']) {
        await group.getByRole('radio', { name: mode }).click();
        await page.waitForTimeout(500);
        await expect(group.getByRole('radio', { name: mode })).toHaveAttribute('aria-checked', 'true');
        const dialog = page.getByRole('dialog', { name: 'Now playing' });
        await dialog.screenshot({ path: `e2e-artifacts/store-visuals/player-${mode.toLowerCase()}-${vp.name}.png` });
      }
      // Choice is remembered.
      await page.reload();
      expect(await page.evaluate(() => localStorage.getItem('antigravity-visual-mode'))).toBe('curve');
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


for (const vp of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
  test.describe(`band scrubber @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('fixed playhead, one waveform drawn, drag / tap / arrow keys seek, audio keeps playing', async ({ page }) => {
      await openAndPlay(page);
      await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
      const slider = page.locator('[role="dialog"] [data-band-scrubber]').first();
      await expect(slider).toBeVisible();
      await expect(slider).toHaveAttribute('role', 'slider');
      // Painted (non-background pixels) and moving while playing.
      const cv = slider.locator('canvas');
      const snap = () => cv.evaluate((c: HTMLCanvasElement) => c.toDataURL());
      const a = await snap();
      await page.waitForTimeout(500);
      expect(await snap()).not.toBe(a);
      // Jump to the full mix (the first 6 s are the colour legend) and let it settle.
      await page.evaluate(() => { (document.querySelector('audio') as HTMLAudioElement).currentTime = 10; });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `e2e-artifacts/store-visuals/scrubber-playing-${vp.name}.png` });

      // Arrow keys step 5 s.
      await slider.focus();
      const before = await audioTime(page);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => audioTime(page)).toBeGreaterThan(before + 3.5);
      // Drag the waveform left (later in the track).
      const box = (await slider.boundingBox())!;
      const t0 = await audioTime(page);
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => audioTime(page)).toBeGreaterThan(t0 + 1);
      // Tap right of the playhead jumps ahead; the element still advances.
      const t1 = await audioTime(page);
      await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
      await expect.poll(() => audioTime(page)).toBeGreaterThan(t1 + 1);
      const t2 = await audioTime(page);
      await page.waitForTimeout(600);
      expect(await audioTime(page)).toBeGreaterThan(t2);
      // Paused: a static frame of the same scrubber.
      await page.locator('[role="dialog"]').getByRole('button', { name: 'Pause', exact: true }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e-artifacts/store-visuals/scrubber-paused-${vp.name}.png` });
    });
  });
}

test('element swap: a captured player moving to an uncapturable source keeps playing', async ({ page }) => {
  // Track 2's preview lives on an origin that sends no CORS headers: it cannot be
  // analysed, so the engine must replace the captured element, not go silent.
  await page.route(/\/api\/store(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    const list: Array<Record<string, unknown>> = json.tracks ?? json.data ?? [];
    if (list[1]) list[1].audio_url = 'https://cdn.other.test/previews/t2.wav';
    await route.fulfill({ response: res, json });
  });
  // A browser rejects a CORS-mode fetch to an origin that sends no CORS headers;
  // Playwright's route.fulfill does not enforce that, so model it directly. The
  // media element itself still loads through the route below (no CORS needed).
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return u.includes('cdn.other.test') ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init);
    };
  });
  await page.route('https://cdn.other.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' }, body: WAV }));
  await stubAudio(page);
  await page.goto('/store');
  const cards = page.locator('[id^="beat-"]');
  await cards.first().waitFor({ state: 'visible', timeout: 15_000 });

  // Track 1: same-origin, captured.
  await cards.nth(0).click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
  await expect(canvas(page)).toHaveAttribute('data-source', 'live', { timeout: 5_000 });
  await page.evaluate(() => { (window as unknown as { __first: Element | null }).__first = document.querySelector('audio'); });
  await page.keyboard.press('Escape');

  // Track 2: uncapturable source.
  await cards.nth(1).click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? ''), { timeout: 10_000 }).toContain('cdn.other.test');
  const swapped = await page.evaluate(() => (window as unknown as { __first: Element }).__first !== document.querySelector('audio'));
  expect(swapped).toBe(true); // a fresh element, since the captured one could not play this
  await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
  const t = await audioTime(page);
  await page.waitForTimeout(700);
  expect(await audioTime(page)).toBeGreaterThan(t); // audio advancing
  expect(await page.evaluate(() => { const e = document.querySelector('audio')!; return e.muted || e.paused || e.volume === 0; })).toBe(false);
  // The visual falls back to the track's peaks.
  await expect(canvas(page)).toHaveAttribute('data-source', 'peaks', { timeout: 5_000 });
});

test.describe('scrubber close-up @2x', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  test('the scrubber alone at 2x: the full mix, and the colour legend', async ({ page }) => {
    await openAndPlay(page);
    await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(1);
    const slider = page.locator('[role="dialog"] [data-band-scrubber]').first();
    await expect(slider).toHaveAttribute('data-wave-source', 'analysis', { timeout: 15_000 });
    await page.evaluate(() => { (document.querySelector('audio') as HTMLAudioElement).currentTime = 11; });
    await page.waitForTimeout(500);
    await slider.screenshot({ path: 'e2e-artifacts/store-visuals/scrubber-closeup-2x-fullmix-playing.png' });
    // Legend: pause at 4.0 s — bass (red) and mids (green) played behind the playhead, hats (blue) ahead.
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Pause', exact: true }).first().click();
    await page.evaluate(() => { (document.querySelector('audio') as HTMLAudioElement).currentTime = 4; });
    await page.waitForTimeout(600);
    await slider.screenshot({ path: 'e2e-artifacts/store-visuals/scrubber-closeup-2x-legend.png' });
    await page.evaluate(() => { (document.querySelector('audio') as HTMLAudioElement).currentTime = 2.9; });
    await page.waitForTimeout(500);
    await slider.screenshot({ path: 'e2e-artifacts/store-visuals/scrubber-closeup-2x-legend-bass-mid.png' });
  });
});

for (const vp of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
  test.describe(`now playing fold @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('where the scrubber sits when Now Playing opens, and scrolled into view', async ({ page }) => {
      await openAndPlay(page);
      await expect.poll(() => audioTime(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Open Now Playing' }).click();
      const dialog = page.getByRole('dialog', { name: 'Now playing' });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const sc = document.querySelector('[role="dialog"][aria-label="Now playing"] [data-band-scrubber]')!.getBoundingClientRect();
        const dl = document.querySelector('[role="dialog"][aria-label="Now playing"]')!.getBoundingClientRect();
        return { vh: window.innerHeight, scrubTop: Math.round(sc.top), scrubBottom: Math.round(sc.bottom), dialogTop: Math.round(dl.top), dialogBottom: Math.round(dl.bottom) };
      });
      console.log(`FOLD@${vp.name} ${JSON.stringify(m)} fullyVisibleOnOpen=${m.scrubBottom <= Math.min(m.vh, m.dialogBottom)}`);
      await page.screenshot({ path: `e2e-artifacts/store-visuals/nowplaying-open-${vp.name}.png` });
      await dialog.locator('[data-band-scrubber]').scrollIntoViewIfNeeded();
      await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e-artifacts/store-visuals/nowplaying-scrubber-visible-${vp.name}.png` });
    });
  });
}
