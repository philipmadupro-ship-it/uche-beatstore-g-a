import { expect, test } from '@playwright/test';

/**
 * /links filtering (SHARE-03). /api/links is stubbed, so this needs neither
 * Supabase nor a seeded database: it covers the toolbar, the "N of M" count,
 * Clear all and the view-in-the-URL round trip through a real reload.
 */
const day = 86_400_000;
const link = (i: number, over: Record<string, unknown>) => ({
  id: `id${i}`, source: i % 2 ? 'project_shares' : 'share_links', token: `tok${i}abcd`,
  title: `Link ${i}`, content_title: null, kind: 'track', recipient_kind: null,
  track_ids: ['t'], tracks: [], plays: 1, expires_at: null, revoked_at: null,
  allow_downloads: true, password_protected: false,
  created_at: new Date(Date.now() - i * day).toISOString(),
  href: '/share/x', cover_url: null, artwork_kind: 'track', artwork_seed: `s${i}`, artwork_tags: [],
  ...over,
});
const LINKS = [
  link(1, { title: 'Alpha pack', kind: 'project', recipient_kind: 'rapper', plays: 9 }),
  link(2, { title: 'Bravo', kind: 'track', password_protected: true }),
  link(3, { title: 'Charlie loops', kind: 'playlist', allow_downloads: false, plays: 0 }),
  link(4, { title: 'Delta', kind: 'track', revoked_at: new Date(Date.now() - day).toISOString() }),
  link(5, { title: 'Echo', kind: 'project', plays: 0 }),
  link(6, { title: 'Foxtrot', kind: 'playlist' }),
  link(7, { title: 'Golf', kind: 'track', recipient_kind: 'client' }),
  link(8, { title: 'Hotel', kind: 'track' }),
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/links', (route) => route.fulfill({ json: { links: LINKS } }));
});

test('filters, count, Clear all and the URL round trip', async ({ page }) => {
  await page.goto('/links');
  const count = page.getByTestId('link-count');
  await expect(count).toHaveText('8 links');

  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Playlist', exact: true }).click();
  await expect(count).toHaveText('4 of 8');
  await page.getByRole('button', { name: 'Never opened' }).click();
  await expect(count).toHaveText('2 of 8');
  await expect(page).toHaveURL(/kind=project/);
  await expect(page).toHaveURL(/status=unopened/);

  // A reload keeps the view.
  await page.reload();
  await expect(page.getByTestId('link-count')).toHaveText('2 of 8');

  await page.getByRole('button', { name: /clear all/i }).click();
  await expect(page.getByTestId('link-count')).toHaveText('8 links');
  await expect(page).not.toHaveURL(/kind=|status=/);
});

test('sort and search live in the URL', async ({ page }) => {
  await page.goto('/links?sort=title&q=loops');
  await expect(page.getByLabel('Search links')).toHaveValue('loops');
  await expect(page.getByTestId('link-count')).toHaveText('1 of 8');
  await expect(page.getByLabel('Sort links')).toContainText(/Title A–Z/i);
});
