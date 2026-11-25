import { expect, test } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * AUDIO-02: a DAW project file in a producer project's Files. /api is stubbed
 * (the route rules — signature check, octet-stream, off-the-portal default,
 * metadata shape, deletion of a refused presigned object — are covered by
 * src/app/api/projects/[id]/assets/daw.test.ts), so this asserts what the
 * producer sees: the right kind and metadata after "reopening" the page, the
 * portal switch off, and a download that goes through the owner-gated route.
 * Signs in through the stub Supabase like links-filtering.spec.ts.
 */
let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => {
  if (stubSupabaseConfigured()) stub = await startStubSupabase();
});
test.afterAll(async () => {
  await stub?.close();
});

const flp = {
  id: 'f1', project_id: 'p1', kind: 'other', label: 'Night Shift', file_name: 'Night Shift.flp', mime: 'application/octet-stream',
  size_bytes: 2_621_440, position: 0, in_portal: false, portal_at: null, created_at: new Date().toISOString(),
  downloadUrl: '/api/projects/p1/assets/f1/download',
};
const wav = { ...flp, id: 'f2', kind: 'audio', label: 'Hook sketch', file_name: 'hook.wav', mime: 'audio/wav', size_bytes: 1_048_576, downloadUrl: '/api/projects/p1/assets/f2/download' };

const bundle = { ...flp, id: 'z1', label: 'Glass Rain bundle', file_name: 'Glass Rain.zip', mime: 'application/zip', size_bytes: 52_428_800, position: 2, downloadUrl: '/api/projects/p1/assets/z1/download' };

test.beforeEach(async ({ page, context, baseURL }) => {
  if (stub) await context.addCookies([signInCookie(baseURL!)]);
  await page.route('**/api/tracks?*', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/tracks', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/projects/p1', (r) => r.fulfill({ json: { project: { id: 'p1', name: 'Night Drive EP', status: 'active', tags: [], price_usd: null, created_at: new Date().toISOString() } } }));
});

test('an uploaded FLP reopens as an FL Studio project with its metadata, off the portal, downloaded through the owner route', async ({ page }) => {
  let uploaded = false;
  const metaCalls: string[] = [];
  await page.route('**/api/projects/p1/assets', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postData() ?? '').toContain('Night Shift.flp');
      uploaded = true;
      return route.fulfill({ status: 201, json: { asset: flp } });
    }
    return route.fulfill({ json: { schemaReady: true, sharedWithArtists: true, assets: uploaded ? [wav, flp, bundle] : [wav, bundle] } });
  });
  await page.route('**/api/projects/p1/assets/f1/meta', (route) => {
    metaCalls.push(route.request().url());
    return route.fulfill({ json: { app: 'FL Studio', appVersion: '21.2.3.3586', bpm: 140 }, headers: { 'cache-control': 'private, no-store' } });
  });

  await page.route('**/api/projects/p1/assets/z1/meta', (route) => route.fulfill({ json: { app: 'FL Studio', appVersion: null, bpm: null } }));
  await page.goto('/projects/p1');
  const input = page.locator('input[type=file][aria-label="Add files to this project"]');
  await input.setInputFiles({ name: 'Night Shift.flp', mimeType: 'application/octet-stream', buffer: Buffer.from('FLhd\0\0\0\0') });

  const row = page.getByTestId('project-file-f1');
  await expect(row).toBeVisible();
  await expect(row).toContainText('FL Studio project');
  await expect(row).toContainText('2.5 MB');
  await expect(row).toContainText('Night Shift.flp');
  await expect(page.getByTestId('project-file-daw-f1')).toContainText('v21.2.3.3586 · 140 BPM');
  // (dev StrictMode rehearses effects, so the count is not asserted; the target is.)
  expect(metaCalls.length).toBeGreaterThan(0);
  expect(metaCalls.every((u) => u.endsWith('/api/projects/p1/assets/f1/meta'))).toBe(true);

  // A zipped session reads as one: its own kind label (not "Other") and no paperclip.
  const zipRow = page.getByTestId('project-file-z1');
  await expect(zipRow).toContainText('Bundled FL Studio project');
  await expect(zipRow).not.toContainText('Other');

  // Off the portal, and never offered for offline (it is not audio).
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('project-file-offline-f1')).toHaveCount(0);

  // Reopen: a reload shows the same.
  await page.reload();
  await expect(page.getByTestId('project-file-f1')).toContainText('FL Studio project');
  await expect(page.getByTestId('project-file-daw-f1')).toContainText('140 BPM');

  // Download goes through the owner-gated route on this origin, never a storage URL.
  const href = await page.getByTestId('project-file-f1').getByRole('link', { name: /Download/ }).getAttribute('href');
  expect(href).toBe('/api/projects/p1/assets/f1/download');
});

test('a refused upload says why and adds nothing', async ({ page }) => {
  await page.route('**/api/projects/p1/assets', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 415, json: { error: 'That file does not look like FL Studio project. Check it is the original .flp file.' } })
      : route.fulfill({ json: { schemaReady: true, sharedWithArtists: false, assets: [wav] } }),
  );
  await page.goto('/projects/p1');
  await page.locator('input[type=file][aria-label="Add files to this project"]').setInputFiles({ name: 'fake.flp', mimeType: 'application/octet-stream', buffer: Buffer.from('<html>') });
  await expect(page.getByText(/does not look like FL Studio/i)).toBeVisible();
  await expect(page.getByTestId('project-file-f1')).toHaveCount(0);
});
