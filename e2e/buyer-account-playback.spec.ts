/**
 * BUYER-04: a signed-in buyer plays beats from /store/account/me.
 *
 * Before: every beat on the account page was a link to its store page and
 * nothing reached the global player, so an owned or favourited beat could not
 * be heard from the account. The page, the global PlayerBar and the <audio>
 * element are real; the account's data endpoints and the audio bytes are
 * stubbed (the route's access rules are covered by its own unit tests).
 *
 * The audio request itself is asserted: it must go to the identity-gated
 * /api/store/me/preview/<id>?session=1 — never the public store route (which
 * 404s a delisted beat the buyer paid for) and never a private master.
 */
import { test, expect, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

const FAV = '11111111-1111-4111-8111-111111111111';
const FAV2 = '22222222-2222-4222-8222-222222222222';
const OWNED = '33333333-3333-4333-8333-333333333333';

const sum = (id: string, title: string) => ({
  id, title, cover_url: null, type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 120,
});

const purchases = {
  email: 'producer@e2e.test',
  project_bundles: [],
  track_licenses: [{
    id: 'lp1', kind: 'track', amount_usd: 300, created_at: '2026-09-01T00:00:00Z', status: 'paid',
    stripe_session_id: 'cs_1', download_url: '/store/download?session_id=cs_1', access_revoked: false,
    items: [{ track_id: OWNED, license_id: 'excl', license_type: 'exclusive', title: 'OWNED EXCLUSIVE', duration_seconds: 120, bpm: 90 }],
  }],
};

const library = {
  email: 'producer@e2e.test',
  history: [],
  favorites: [
    { track_id: FAV, created_at: '2026-09-02T00:00:00Z', track: sum(FAV, 'FAVOURITE ONE') },
    { track_id: FAV2, created_at: '2026-09-02T00:00:00Z', track: sum(FAV2, 'FAVOURITE TWO') },
  ],
  playlists: [],
};

/** Quiet 8 kHz mono PCM. */
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

async function stub(page: Page, audioRequests: string[]) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/store/account/me', (route) => route.fulfill(json(purchases)));
  await page.route('**/api/store/me?session=1', (route) => route.fulfill(json(library)));
  const wav = toneWav();
  await page.route('**/api/store/me/preview/**', (route) => {
    audioRequests.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search);
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
    if (!range) {
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav, headers: { 'accept-ranges': 'bytes' } });
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: 206, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${wav.length}` },
    });
  });
}

const audioState = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('audio')).map((a) => ({
    src: a.currentSrc || a.src, paused: a.paused, time: a.currentTime,
  })));

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`account playback @ ${viewport.width}px`, () => {
    test.use({ viewport });

    let stubSupabase: Awaited<ReturnType<typeof startStubSupabase>> = null;
    test.beforeAll(async () => {
      if (stubSupabaseConfigured()) stubSupabase = await startStubSupabase();
    });
    test.afterAll(async () => { await stubSupabase?.close(); });

    test('an owned and a favourite beat play from the account through the global player', async ({ page, context, baseURL }) => {
      test.skip(!stubSupabase, 'needs the stub Supabase (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321)');
      await context.addCookies([signInCookie(baseURL!)]);
      const audioRequests: string[] = [];
      await stub(page, audioRequests);

      await page.goto('/store/account/me');

      // The beat the buyer paid for (an exclusive delists, so the public route would 404 it).
      await page.getByLabel('Play OWNED EXCLUSIVE').click();
      await expect.poll(async () => (await audioState(page)).some((a) => !a.paused && a.time > 0.2)).toBe(true);
      expect(audioRequests.some((r) => r.startsWith(`/api/store/me/preview/${OWNED}?session=1`))).toBe(true);
      // One audible element, and it is the global player's.
      expect((await audioState(page)).filter((a) => !a.paused)).toHaveLength(1);
      await expect(page.getByLabel('Pause OWNED EXCLUSIVE')).toBeVisible();

      // Switching to a favourite replaces it: still exactly one audible element.
      await page.getByLabel('Play FAVOURITE ONE').click();
      await expect.poll(async () => (await audioState(page)).some((a) => !a.paused && a.src.includes(FAV))).toBe(true);
      expect((await audioState(page)).filter((a) => !a.paused)).toHaveLength(1);
      expect(audioRequests.some((r) => r.startsWith(`/api/store/me/preview/${FAV}?session=1`))).toBe(true);

      // Pausing from the account row pauses the player.
      await page.getByLabel('Pause FAVOURITE ONE').click();
      await expect.poll(async () => (await audioState(page)).every((a) => a.paused)).toBe(true);
      await expect(page.getByLabel('Play FAVOURITE ONE')).toBeVisible();

      // The title is still a link to the beat's store page.
      await expect(page.getByLabel('Open FAVOURITE ONE')).toHaveAttribute('href', `/store/${FAV}`);

      // Nothing was ever requested from the public route or as a master.
      expect(audioRequests.every((r) => r.startsWith('/api/store/me/preview/'))).toBe(true);
    });

    test('the legacy token page plays a purchased and a favourite beat as the token', async ({ page }) => {
      test.skip(!stubSupabase, 'needs the stub Supabase (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321)');
      // Real tokens are base64url.exp.base64url, so they need no escaping.
      const token = 'bGVnYWN5QGJ1eWVy.1790000000.c2ln_-x';
      const enc = encodeURIComponent(token);
      const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      const audioRequests: string[] = [];
      const plays: string[] = [];
      await page.route(`**/api/store/account/${enc}`, (route) => route.fulfill(json(purchases)));
      await page.route(`**/api/store/me?token=${enc}`, (route) => {
        const req = route.request();
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as { action: string; track_id: string };
          if (body.action === 'log_play') plays.push(body.track_id);
          return route.fulfill(json({ ok: true }));
        }
        return route.fulfill(json(library));
      });
      const wav = toneWav();
      await page.route('**/api/store/me/preview/**', (route) => {
        const u = new URL(route.request().url());
        audioRequests.push(u.pathname + u.search);
        const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
        if (!range) return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav, headers: { 'accept-ranges': 'bytes' } });
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
        return route.fulfill({
          status: 206, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
          headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${wav.length}` },
        });
      });

      await page.goto(`/store/account/${enc}`);
      await page.getByLabel('Play OWNED EXCLUSIVE').click();
      await expect.poll(async () => (await audioState(page)).some((a) => !a.paused && a.time > 0.2)).toBe(true);
      expect(audioRequests.some((r) => r.startsWith(`/api/store/me/preview/${OWNED}?token=${enc}`))).toBe(true);

      await page.getByLabel('Play FAVOURITE ONE').click();
      await expect.poll(async () => (await audioState(page)).some((a) => !a.paused && a.src.includes(FAV))).toBe(true);
      expect((await audioState(page)).filter((a) => !a.paused)).toHaveLength(1);

      await page.getByLabel('Pause FAVOURITE ONE').click();
      await expect.poll(async () => (await audioState(page)).every((a) => a.paused)).toBe(true);
      // Two beats started, one pause: two plays logged, none for the pause.
      expect(plays).toEqual([OWNED, FAV]);
      expect(audioRequests.every((r) => r.includes(`token=${enc}`))).toBe(true);
    });

    test('keyboard: the play button is reachable and Enter starts the beat', async ({ page, context, baseURL }) => {
      test.skip(!stubSupabase, 'needs the stub Supabase (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321)');
      await context.addCookies([signInCookie(baseURL!)]);
      await stub(page, []);
      await page.goto('/store/account/me');
      const play = page.getByLabel('Play FAVOURITE TWO');
      await play.focus();
      await expect(play).toBeFocused();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await audioState(page)).some((a) => !a.paused)).toBe(true);
      await page.screenshot({ path: `test-results/buyer-account-playback-${viewport.width}.png` });
    });
  });
}
