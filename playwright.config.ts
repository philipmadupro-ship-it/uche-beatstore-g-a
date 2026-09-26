import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end smoke tests.
 *
 * Strategy: tests run against an already-running dev server on
 * localhost:3457 (the port this repo uses). CI starts the server
 * via the webServer hook; local devs just run `npm run e2e` while
 * `npm run dev` is up. Real Supabase, real R2 — no mocks. This is
 * a smoke layer above the Vitest unit + route tests, not a unit
 * replacement.
 *
 * One project (chromium) for now. Adding firefox/webkit is one
 * line each if we want to catch browser-specific bugs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,                          // share one cart/player
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                                    // single-producer storefront; one tab is enough
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3457',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Lets a machine with a pre-installed Chromium of a different build run
    // the suite without `playwright install`. Unset = Playwright's own browser.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // In CI, boot dev server ourselves. Locally, assume it's running.
  webServer: process.env.CI
    ? {
        command: 'PORT=3457 npm run dev',
        url: 'http://localhost:3457',
        timeout: 120_000,
        reuseExistingServer: false,
      }
    : {
        command: 'PORT=3457 npm run dev',
        url: 'http://localhost:3457',
        timeout: 60_000,
        reuseExistingServer: true,                 // reuse the dev server you already have running
      },
});
