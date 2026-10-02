/**
 * PROFILE-02 follow-up: saving a profile whose links the storefront will not
 * show says so, at save time. The save itself still goes through (values are
 * stored as typed), so a half-filled form never loses the rest of its fields.
 *
 * /api/profile is stubbed; the page, its form and its toasts are real.
 * Sign-in goes through e2e/fixtures/stub-supabase.ts like the other dashboard specs.
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
test.skip(!stubSupabaseConfigured(), 'needs the stub Supabase URL (see e2e/fixtures/stub-supabase.ts)');

async function openProfile(page: Page) {
  const saved: Array<Record<string, unknown>> = [];
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() === 'POST') {
      saved.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profile: {} }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profile: { display_name: 'E2E Producer' } }) });
  });
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
  return saved;
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`profile link warning @ ${viewport.width}px`, () => {
    test.use({ viewport });

    test('unusable links are named at save, and the save still goes through', async ({ page }) => {
      const saved = await openProfile(page);
      await page.getByPlaceholder('username or instagram.com/username').fill('two words');
      await page.getByPlaceholder('https://yourname.com').fill('javascript:alert(1)');
      await page.getByRole('button', { name: 'Save profile' }).click();

      await expect(page.getByText('Profile saved')).toBeVisible();
      await expect(page.getByText("2 links won't show")).toBeVisible();
      await expect(page.getByText(/Instagram, Website aren't a valid link or handle/)).toBeVisible();
      expect(saved).toHaveLength(1);
      expect(saved[0].instagram_handle).toBe('two words');
    });

    test('a pasted profile link and a bare handle both save without a warning', async ({ page }) => {
      await openProfile(page);
      await page.getByPlaceholder('username or instagram.com/username').fill('https://www.instagram.com/uche/');
      await page.getByPlaceholder('username or x.com/username').fill('@uche_x');
      await page.getByPlaceholder('https://yourname.com').fill('uche.example');
      await page.getByRole('button', { name: 'Save profile' }).click();

      await expect(page.getByText('Profile saved')).toBeVisible();
      await expect(page.getByText(/link won't show|links won't show/)).toHaveCount(0);
    });
  });
}
