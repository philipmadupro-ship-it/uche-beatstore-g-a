import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The specs that drive a REAL database stack (scripts/local-db): every spec file that names E2E_REAL_DB.
 * Found by that marker rather than listed by hand, so a new real-database spec runs under `npm run e2e:real-db`
 * the day it is written (the list in package.json was 55 file names that had to be kept by hand) and can never
 * leak into the default run, where it would only add skips to a count CI checks.
 */
const realDbSpecs = fs
  .readdirSync(path.join(__dirname, 'e2e'))
  .filter((f) => f.endsWith('.spec.ts') && fs.readFileSync(path.join(__dirname, 'e2e', f), 'utf8').includes('E2E_REAL_DB'))
  .map((f) => `**/e2e/${f}`);
const realDb = process.env.E2E_REAL_DB === '1';

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
  // `npm run e2e:real-db` runs exactly the real-database specs; the default run (and CI) runs everything else.
  ...(realDb ? { testMatch: realDbSpecs } : { testIgnore: realDbSpecs }),
  fullyParallel: false,                          // share one cart/player
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                                    // single-producer storefront; one tab is enough
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  // The real-database flows hit PostgREST + RLS + a cold Next dev compile on
  // every first visit to a route; the 5 s default expect timeout made
  // assertions race the compile. 25 s is the budget the flows are written for.
  // The default (local-store) suite keeps Playwright's 5 s.
  expect: { timeout: process.env.E2E_REAL_DB === '1' ? 25_000 : 5_000 },

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
