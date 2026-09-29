/**
 * Store Editor first load when some of its six requests fail.
 *
 * The page used to parse all six bodies in one `Promise.all`. A body that was
 * not JSON — `/api/promo-codes` and `/api/licenses` did this in the e2e
 * environment — rejected the lot, the saved profile never reached the form,
 * and the next "Save changes" PATCHed the form's empty defaults over it.
 *
 * Sign-in goes through e2e/fixtures/stub-supabase.ts.
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

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
const htmlError = { status: 500, contentType: 'text/html', body: '<!doctype html><h1>Internal Server Error</h1>' };

const savedProfile = {
  display_name: 'E2E Producer',
  bio: 'Saved bio that must survive a save',
  instagram_handle: 'e2e.producer',
  license_lease_price_usd: 30,
};

async function stub(page: Page, { profileFails }: { profileFails: boolean }) {
  const profilePatches: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/profile(\?.*)?$/, (route) => {
    const method = route.request().method();
    if (method === 'GET') return profileFails ? route.fulfill(htmlError) : route.fulfill(json({ profile: savedProfile }));
    if (method === 'PATCH') {
      profilePatches.push(route.request().postDataJSON());
      return route.fulfill(json({ profile: savedProfile }));
    }
    return route.continue();
  });
  // The two that broke the old load.
  await page.route(/\/api\/promo-codes(\?.*)?$/, (route) => route.fulfill(htmlError));
  await page.route(/\/api\/licenses(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  await page.route(/\/api\/playlists(\?.*)?$/, (route) => route.fulfill(json({ playlists: [] })));
  await page.route(/\/api\/projects(\?.*)?$/, (route) => route.fulfill(json({ projects: [] })));
  await page.route(/\/api\/tracks\/store-summary/, (route) =>
    route.fulfill(json({ total: 0, listed: 0, issues: {}, producerPicks: [] })),
  );
  await page.route(/\/api\/tracks\?/, (route) =>
    route.fulfill(json({ tracks: [], pageInfo: { hasMore: false, nextCursor: null } })),
  );
  return { profilePatches };
}

test('a failing promo-code and license load does not cost the producer their profile', async ({ page }) => {
  const { profilePatches } = await stub(page, { profileFails: false });
  await page.goto('/store-editor');

  await page.getByRole('button', { name: /Hero Section/ }).click();
  await expect(page.getByPlaceholder('e.g. Uche Beats')).toHaveValue(savedProfile.display_name, { timeout: 20_000 });
  await expect(page.getByText(/Could not load promo codes, license tiers/)).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await expect.poll(() => profilePatches.length).toBe(1);
  expect(profilePatches[0]).toMatchObject({
    display_name: savedProfile.display_name,
    bio: savedProfile.bio,
    instagram_handle: savedProfile.instagram_handle,
    license_lease_price_usd: savedProfile.license_lease_price_usd,
  });
});

test('Save is off when the profile itself did not load', async ({ page }) => {
  const { profilePatches } = await stub(page, { profileFails: true });
  await page.goto('/store-editor');

  await expect(page.getByText('Could not load your store profile')).toBeVisible({ timeout: 20_000 });
  const save = page.getByRole('button', { name: 'Save changes' }).first();
  await expect(save).toBeDisabled();
  expect(profilePatches).toHaveLength(0);
});
