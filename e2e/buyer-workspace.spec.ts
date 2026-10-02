/**
 * BUYER-01: "My beats" on /store/account/me.
 *
 * The buyer APIs are stubbed (no real Supabase here) with a session cookie and
 * `/auth/v1/user`; the page, the persistent player, the filter / sort / select
 * controls and every click are real. Covers: owned + requested rows, filter,
 * sort, play (the preview stream is requested and the player bar names the
 * beat), keyboard selection, and Create project posting the selection and
 * showing the new project after the library refetch.
 */
import { test, expect, type Page } from '@playwright/test';

const NIGHT = '11111111-1111-4111-8111-111111111111';
const COLD = '22222222-2222-4222-8222-222222222222';
const ASK = '33333333-3333-4333-8333-333333333333';

const beat = (id: string, over: Record<string, unknown>) => ({
  id, title: id, cover_url: null, type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 100,
  status: 'owned', since: '2026-09-10T00:00:00Z', license: 'lease', offer: null,
  listed: true, playable: true, canAddToProject: true, openUrl: `/store/download?session_id=${id}`, available: true, ...over,
});

const BEATS = [
  beat(NIGHT, { title: 'Night Shift', bpm: 140 }),
  beat(COLD, { title: 'Cold Front', bpm: 92, key: 'C', scale: 'major', since: '2026-09-11T00:00:00Z' }),
  beat(ASK, { title: 'Asked For', status: 'requested', license: null, openUrl: null, bpm: 120, since: '2026-09-12T00:00:00Z', offer: { status: 'pending', price_usd: 300 } }),
];

/**
 * @supabase/ssr reads the session from `sb-<first label of the Supabase host>-auth-token`.
 * CI points NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321 (cookie `sb-127-…`); a
 * local run may use https://stub.supabase.co (`sb-stub-…`). A hardcoded name only
 * matched one of them, so the page bounced to /store/account and every test failed.
 */
function authCookieName(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://stub.supabase.co';
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

async function stub(page: Page, context: import('@playwright/test').BrowserContext, beats: unknown[] = BEATS) {
  const session = {
    access_token: 'a.b.c', refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer', user: { id: 'u1', email: 'rapper@example.com', aud: 'authenticated' },
  };
  await context.addCookies([{ name: authCookieName(), value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, url: 'http://localhost:3457' }]);
  await page.route('**/auth/v1/user', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(session.user) }));
  await page.route('**/api/store/account/me', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ email: 'rapper@example.com', track_licenses: [], project_bundles: [] }),
  }));
  const playlists: Array<Record<string, unknown>> = [];
  const posted: unknown[] = [];
  await page.route('**/api/store/me?**', async (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}');
      posted.push(body);
      playlists.push({ id: 'pl1', name: body.name, created_at: 'x', updated_at: '2026-10-02T00:00:00Z', track_ids: body.track_ids, tracks: [] });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ playlist: playlists[0] }) });
    }
    if (req.url().includes('view=beats')) {
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'rapper@example.com', beats }) });
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'rapper@example.com', history: [], favorites: [], playlists }) });
  });
  // A tiny silent WAV so the player's <audio> can load something.
  const wav = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64');
  const previewHits: string[] = [];
  await page.route('**/api/store/preview/**', (r) => { previewHits.push(r.request().url()); return r.fulfill({ contentType: 'audio/wav', body: wav }); });
  return { posted, previewHits };
}

/** Every /api response that failed, so a page cannot quietly call an endpoint it has no right to. */
function watchFailedApi(page: Page): string[] {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/')) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return failed;
}

const rowTitles = (page: Page) => page.locator('#my-beats-heading ~ ul > li').locator('p.truncate.font-medium, a.truncate.font-medium').allTextContents();

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`my beats @ ${viewport.width}px`, () => {
    test.use({ viewport });

    test('owned and requested rows; filter, sort, play, select and create a project', async ({ page, context }) => {
      const { posted, previewHits } = await stub(page, context);
      const failedApi = watchFailedApi(page);
      await page.goto('/store/account/me');

      await expect(page.getByRole('heading', { name: /My beats \(3\)/ })).toBeVisible();
      // buyer playlists are called Projects here
      await expect(page.getByText(/^Projects \(0\)/)).toBeVisible();
      await expect(page.getByText('My playlists')).toHaveCount(0);
      expect(await rowTitles(page)).toEqual(['Asked For', 'Cold Front', 'Night Shift']);
      await expect(page.getByText('Offer $300 · pending')).toBeVisible();
      await expect(page.getByText('Your sound ·')).toBeVisible();
      // no horizontal page scroll at either width
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // filter + search
      await page.getByRole('button', { name: 'Filter beats' }).click();
      await page.getByRole('option', { name: 'Requested' }).click();
      expect(await rowTitles(page)).toEqual(['Asked For']);
      await page.getByRole('button', { name: 'Filter beats' }).click();
      await page.getByRole('option', { name: 'All beats' }).click();
      await page.getByRole('searchbox').fill('92');
      expect(await rowTitles(page)).toEqual(['Cold Front']);
      await page.getByRole('searchbox').fill('');

      // sort
      await page.getByRole('button', { name: 'Sort beats' }).click();
      await page.getByRole('option', { name: 'BPM' }).click();
      expect(await rowTitles(page)).toEqual(['Cold Front', 'Asked For', 'Night Shift']);

      // play: the preview stream is requested and the player names the beat
      await page.getByRole('button', { name: 'Play Night Shift' }).click();
      await expect.poll(() => previewHits.some((u) => u.includes(NIGHT))).toBe(true);
      await expect(page.getByRole('button', { name: 'Pause Night Shift' })).toBeVisible();

      // keyboard selection, then create
      const box = page.getByRole('checkbox', { name: 'Select Night Shift' });
      await box.focus();
      await page.keyboard.press('Space');
      await expect(box).toBeChecked();
      await page.getByRole('checkbox', { name: 'Select Asked For' }).check({ force: true });
      const form = page.getByRole('form', { name: /Create a project/ });
      await expect(form.getByText('2 selected')).toBeVisible();
      await form.getByLabel('Project name').fill('Mixtape');
      await form.getByRole('button', { name: /Create project/ }).click();

      await expect.poll(() => posted.length).toBe(1);
      expect(posted[0]).toEqual({ action: 'create_playlist', name: 'Mixtape', track_ids: [ASK, NIGHT] });
      await expect(form).toBeHidden();
      // the new project shows up under Projects after the refetch
      await expect(page.getByText('Mixtape', { exact: true })).toBeVisible();
      await expect(page.getByText(/^Projects \(1\)/)).toBeVisible();

      // the buyer's page asked for nothing it may not have (it used to call the
      // producer-only /api/profile and /api/tags/colors: two 401s per load)
      expect(failedApi).toEqual([]);
    });

    test('a beat the store delisted (an exclusive) still plays for its owner', async ({ page, context }) => {
      const EXCL = '44444444-4444-4444-8444-444444444444';
      const { previewHits } = await stub(page, context, [
        beat(EXCL, { title: 'Exclusive One', license: 'exclusive', listed: false, playable: true }),
      ]);
      await page.goto('/store/account/me');
      const row = page.locator('#my-beats-heading ~ ul > li').first();
      await expect(row.getByText('Exclusive One')).toBeVisible();
      // /store/[id] 404s for a delisted beat, so the title must not link there
      await expect(row.getByRole('link', { name: 'Exclusive One' })).toHaveCount(0);
      await expect(row.getByRole('link', { name: /Open/ })).toBeVisible();
      await page.getByRole('button', { name: 'Play Exclusive One' }).click();
      await expect.poll(() => previewHits.some((u) => u.includes(EXCL))).toBe(true);
      await expect(page.getByRole('button', { name: 'Pause Exclusive One' })).toBeVisible();
    });

    test('a buyer with nothing sees the empty state', async ({ page, context }) => {
      await stub(page, context);
      await page.route('**/api/store/me?**view=beats**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'rapper@example.com', beats: [] }) }));
      await page.goto('/store/account/me');
      await expect(page.getByText('No beats yet')).toBeVisible();
    });

    test('a failed load says so and retry recovers', async ({ page, context }) => {
      await stub(page, context);
      let failing = true;
      await page.route('**/api/store/me?**view=beats**', (r) => (failing
        ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Something went wrong' }) })
        : r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'rapper@example.com', beats: BEATS }) })));
      await page.goto('/store/account/me');
      await expect(page.getByRole('alert').filter({ hasText: "Couldn't load your beats" })).toBeVisible();
      failing = false;
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByText('Night Shift')).toBeVisible();
    });
  });
}
