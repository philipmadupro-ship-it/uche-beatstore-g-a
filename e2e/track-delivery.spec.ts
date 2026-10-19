/**
 * The Delivery section of the Library track drawer: is the MP3 a lease on this
 * track hands over ready? Real drawer, real clicks, at 1280 and 390 px; only
 * the data is stubbed (the list, and /api/tracks/[id]/mp3 with the shapes the
 * route returns). The route itself is covered by route tests, and the
 * transcode by a real-ffmpeg test.
 *
 * Sign-in goes through e2e/fixtures/stub-supabase.ts, as in the chords spec.
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

const TRACK_ID = 'e2e-delivery-track';
const track = {
  id: TRACK_ID,
  user_id: 'local-user',
  title: 'DELIVERY FIXTURE',
  type: 'beat',
  audio_url: 'r2://e2e-private/delivery.wav',
  peaks_url: null,
  cover_url: null,
  duration_seconds: 120,
  bpm: 120,
  key: 'C',
  scale: 'major',
  rating: null,
  stems_status: 'none',
  created_at: '2026-09-01T00:00:00.000Z',
  track_tags: [],
};

const PENDING = {
  state: 'pending', label: 'MP3 not made yet', canMake: true,
  detail: 'A lease delivers an MP3 made from your master. It is made the first time a buyer downloads it — make it now so nobody waits.',
};
const READY = {
  state: 'ready', label: 'MP3 ready', canMake: false,
  detail: 'A 320 kbps MP3 has been made from your master and is what a lease delivers.',
};
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** `makeResult` is what POST answers; GET then reflects whether it succeeded. */
async function stub(page: Page, makeResult: { status: number; body: unknown }) {
  let made = false;
  await page.route(/\/api\/tracks\?/, (route) =>
    route.fulfill(json({ tracks: [track], pageInfo: { hasMore: false, nextCursor: null } })),
  );
  await page.route(new RegExp(`/api/tracks/${TRACK_ID}(\\?.*)?$`), (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ ...track, chords: null })) : route.continue(),
  );
  await page.route(new RegExp(`/api/tracks/${TRACK_ID}/mp3`), (route) => {
    if (route.request().method() === 'POST') {
      made = makeResult.status === 200;
      return route.fulfill(json(makeResult.body, makeResult.status));
    }
    return route.fulfill(json(made ? READY : PENDING));
  });
}

async function openDrawer(page: Page) {
  await page.goto('/library');
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    '/library is auth-gated here; run against the stub Supabase URL',
  );
  // Phones always show All tracks and have no toggle; larger screens open on Browse.
  const toggle = page.getByRole('button', { name: /all tracks/i });
  const row = page.getByText('DELIVERY FIXTURE', { exact: true }).first();
  await expect(toggle.or(row).first()).toBeVisible();
  if (await toggle.isVisible()) await toggle.click();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const section = page.getByTestId('track-delivery');
  await section.scrollIntoViewIfNeeded();
  return section;
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`track delivery @ ${viewport.width}px`, () => {
    test.use({ viewport });

    test('a WAV master reads "not made yet"; Make MP3 now turns it ready', async ({ page }) => {
      await stub(page, { status: 200, body: READY });
      const section = await openDrawer(page);

      await expect(section.getByTestId('mp3-state')).toHaveAttribute('data-state', 'pending');
      await expect(section.getByText('MP3 not made yet')).toBeVisible();

      await section.getByRole('button', { name: 'Make MP3 now' }).click();

      await expect(section.getByTestId('mp3-state')).toHaveAttribute('data-state', 'ready');
      await expect(section.getByText('MP3 ready')).toBeVisible();
      await expect(section.getByRole('button', { name: 'Make MP3 now' })).toHaveCount(0);
    });

    test('a failed make says why and stays "not made yet"', async ({ page }) => {
      await stub(page, { status: 503, body: { error: 'The MP3 could not be made. Check that ffmpeg is available.' } });
      const section = await openDrawer(page);

      await section.getByRole('button', { name: 'Make MP3 now' }).click();

      await expect(page.getByText('MP3 not made', { exact: true })).toBeVisible();
      await expect(page.getByText(/ffmpeg is available/)).toBeVisible();
      await expect(section.getByTestId('mp3-state')).toHaveAttribute('data-state', 'pending');
      await expect(section.getByRole('button', { name: 'Make MP3 now' })).toBeEnabled();
    });
  });
}
