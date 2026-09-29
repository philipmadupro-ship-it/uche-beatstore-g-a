/**
 * "Lyrics Studio" and "Send to studio" from a track's ⋯ menu on the project
 * and playlist pages — the real pages, not a mounted component, so a page
 * that forgets to wire a handler fails here (the menu still renders; the item
 * is just missing).
 *
 * Lyrics Studio is followed through to the track page, which must land focus
 * on the lyrics section: that page fetches on the client and renders a
 * spinner first, so the `#lyrics` hash alone used to leave the producer at the
 * top of the page (see lib/library/lyrics-link.ts).
 *
 * Data is stubbed; sign-in goes through e2e/fixtures/stub-supabase.ts as in
 * the cover specs.
 */
import { test, expect, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

let stubSupabase: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => {
  if (stubSupabaseConfigured()) stubSupabase = await startStubSupabase();
});
test.afterAll(async () => {
  await stubSupabase?.close();
});
test.beforeEach(async ({ context, baseURL }) => {
  if (stubSupabase) await context.addCookies([signInCookie(baseURL!)]);
});

const ITEM_ID = 'e2e-menu-item';
const TRACK_ID = 'e2e-menu-track';

const track = {
  id: TRACK_ID,
  user_id: 'local-user',
  title: 'MENU FIXTURE',
  type: 'beat',
  audio_url: null,
  cover_url: null,
  duration_seconds: 120,
  bpm: 140,
  key: 'F',
  scale: 'minor',
  stems_status: 'none',
  created_at: '2026-09-01T00:00:00.000Z',
  track_tags: [],
};

const KINDS = [
  { kind: 'projects', single: 'project' },
  { kind: 'playlists', single: 'playlist' },
] as const;
type Kind = (typeof KINDS)[number];

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page: Page, k: Kind) {
  const item = {
    id: ITEM_ID,
    name: 'MENU FIXTURE LIST',
    user_id: 'local-user',
    cover_url: null,
    description: null,
    status: 'in_progress',
    pinned: false,
    tags: [],
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  };
  await page.route(new RegExp(`/api/${k.kind}/${ITEM_ID}(\\?.*)?$`), (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ [k.single]: item })) : route.continue(),
  );
  await page.route(new RegExp(`/api/tracks\\?.*${k.single}_id=`), (route) => route.fulfill(json({ tracks: [track] })));
  // The track page Lyrics Studio lands on.
  await page.route(new RegExp(`/api/tracks/${TRACK_ID}(\\?.*)?$`), (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(track)) : route.continue(),
  );
  await page.route(new RegExp(`/api/tracks/${TRACK_ID}/versions`), (route) => route.fulfill(json({ versions: [] })));
  await page.route(/\/api\/stems\?track_id=/, (route) => route.fulfill(json({ stem: null })));
}

async function openRowMenu(page: Page, k: Kind) {
  await page.goto(`/${k.kind}/${ITEM_ID}`);
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    'dashboard is auth-gated here; run against local-store dev with no Supabase env',
  );
  const row = page.locator('div', { hasText: 'MENU FIXTURE' }).filter({ has: page.getByRole('button', { name: 'Track actions' }) }).last();
  await row.getByRole('button', { name: 'Track actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

for (const k of KINDS) {
  test.describe(`${k.single} track menu`, () => {
    test('Lyrics Studio opens the track page focused on the lyrics section', async ({ page }) => {
      await stub(page, k);
      await openRowMenu(page, k);
      await page.getByRole('menuitem', { name: /Lyrics Studio/ }).click();

      await page.waitForURL(`**/library/${TRACK_ID}#lyrics`);
      const section = page.locator('#lyrics');
      await expect(section).toBeVisible();
      await expect(section).toBeFocused();
      await expect(section).toBeInViewport();
    });

    test('Send to studio opens the studio with the track selected', async ({ page }) => {
      await stub(page, k);
      await openRowMenu(page, k);
      await page.getByRole('menuitem', { name: /Send to studio/ }).click();

      await page.waitForURL(`**/studio?track=${TRACK_ID}`);
    });
  });
}
