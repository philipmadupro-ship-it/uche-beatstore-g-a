/**
 * "See all →" on a Library Browse row must open All tracks FILTERED to that row.
 *
 * It did not. Every track row's See all called `setBrowseMode('all')` and
 * nothing else, so "WIP → See all" landed on the whole vault — the row's
 * criteria (a status, a genre, "in your store", "4★ and up") were dropped at
 * the click, and the producer had to rebuild by hand the filter the row had
 * already told them about.
 *
 * Track data is stubbed so each row's membership is known. Every row gets at
 * least one decoy that the row must not include, so a See all that shows
 * everything fails, and one that shows nothing fails too.
 *
 * `/library` is auth-gated; see library-hero-cover.spec.ts for how the stub
 * Supabase signs the spec in (and skips it when it cannot).
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

type Fixture = {
  id: string;
  title: string;
  status?: string | null;
  rating?: number | null;
  store_listed?: boolean;
  genres?: string[];
};

const FIXTURES: Fixture[] = [
  { id: 'sa-maq', title: 'FX MAQ IDEA', status: 'maq' },
  { id: 'sa-wip', title: 'FX WIP BEAT', status: 'needs_work' },
  { id: 'sa-fin', title: 'FX FINISHED FIVE', status: 'finished', rating: 5 },
  { id: 'sa-drill', title: 'FX DRILL ONE', genres: ['Drill'] },
  { id: 'sa-trap-listed', title: 'FX TRAP LISTED', genres: ['Trap'], store_listed: true, rating: 4 },
  { id: 'sa-trap-plain', title: 'FX TRAP PLAIN', genres: ['Trap'] },
  { id: 'sa-rnb', title: 'FX RNB ONE', genres: ['R&B'] },
  { id: 'sa-plain', title: 'FX PLAIN DECOY' },
];

function apiTrack(f: Fixture) {
  return {
    id: f.id,
    user_id: 'local-user',
    title: f.title,
    type: 'beat',
    audio_url: null,
    peaks_url: null,
    cover_url: null,
    duration_seconds: 120,
    bpm: 140,
    key: 'F',
    scale: 'minor',
    rating: f.rating ?? null,
    status: f.status ?? null,
    store_listed: f.store_listed ?? false,
    created_at: '2026-09-01T00:00:00.000Z',
    track_tags: (f.genres ?? []).map((tag) => ({ tag, category: 'genre' })),
  };
}

async function stubLibrary(page: Page) {
  await page.route(/\/api\/tracks\?/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tracks: FIXTURES.map(apiTrack), pageInfo: { hasMore: false, nextCursor: null } }),
    }),
  );
}

async function openBrowse(page: Page) {
  await stubLibrary(page);
  await page.goto('/library');
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    '/library is auth-gated here; run against local-store dev with no Supabase env',
  );
  await expect(page.getByTestId('home-row-wip')).toBeVisible();
}

/** Titles of the fixture tracks the All tracks list is showing. */
async function shownTitles(page: Page): Promise<string[]> {
  const shown: string[] = [];
  for (const f of FIXTURES) {
    if ((await page.getByText(f.title, { exact: true }).count()) > 0) shown.push(f.title);
  }
  return shown.sort();
}

const CASES: Array<{ row: string; expected: string[]; filterCount: number }> = [
  { row: 'maq_ideas', expected: ['FX MAQ IDEA'], filterCount: 1 },
  { row: 'wip', expected: ['FX WIP BEAT'], filterCount: 1 },
  { row: 'finished_for_sale', expected: ['FX FINISHED FIVE'], filterCount: 1 },
  { row: 'genre_drill', expected: ['FX DRILL ONE'], filterCount: 1 },
  { row: 'genre_trap', expected: ['FX TRAP LISTED', 'FX TRAP PLAIN'], filterCount: 1 },
  { row: 'genre_rnb', expected: ['FX RNB ONE'], filterCount: 1 },
  { row: 'store', expected: ['FX TRAP LISTED'], filterCount: 1 },
  { row: 'top_rated', expected: ['FX FINISHED FIVE', 'FX TRAP LISTED'], filterCount: 1 },
];

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
] as const) {
  test.describe(`Library See all keeps the row's filter @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const c of CASES) {
      test(`${c.row} → All tracks shows exactly that row's tracks`, async ({ page }) => {
        await openBrowse(page);
        const row = page.getByTestId(`home-row-${c.row}`);
        // Sanity: the row itself shows its members, so the expectation below
        // is "the same tracks the row promised", not an arbitrary list.
        for (const title of c.expected) await expect(row.getByText(title, { exact: true })).toBeVisible();

        await row.getByRole('button', { name: /See all/ }).click();

        await expect(page.getByTestId(`home-row-${c.row}`)).toHaveCount(0);
        await expect.poll(() => shownTitles(page)).toEqual([...c.expected].sort());

        // The filter is visible, not implicit: the Filters button counts it.
        await expect(page.getByRole('button', { name: /^Filters/ })).toContainText(String(c.filterCount));
      });
    }

    test('keyboard: focus lands on the All tracks toggle, not on <body>', async ({ page }) => {
      await openBrowse(page);
      const seeAll = page.getByTestId('home-row-wip').getByRole('button', { name: /See all/ });
      await seeAll.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('home-row-wip')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'All tracks' })).toBeFocused();
    });

    test('a hand-picked filter the row does not define survives See all', async ({ page }) => {
      await openBrowse(page);
      // Narrow to Trap in the shared Filters menu first, then See all on the
      // Top rated row: the destination is 4★+ AND Trap, i.e. the same tracks
      // the row was showing.
      await page.getByRole('button', { name: /^Filters/ }).click();
      await page.getByRole('button', { name: /^Genre/ }).click();
      // Role-scoped: a bare "Trap" also matches the Trap row's heading.
      await page.getByRole('menuitemcheckbox', { name: 'Trap' }).click();
      await page.keyboard.press('Escape');
      const row = page.getByTestId('home-row-top_rated');
      await expect(row.getByText('FX TRAP LISTED', { exact: true })).toBeVisible();
      await expect(row.getByText('FX FINISHED FIVE', { exact: true })).toHaveCount(0);
      await row.getByRole('button', { name: /See all/ }).click();
      await expect.poll(() => shownTitles(page)).toEqual(['FX TRAP LISTED']);
      await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('2');
    });
  });
}
