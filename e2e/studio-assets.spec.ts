import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * AUDIO-03: stored assets open in the Studio. /api is stubbed (the owner gates
 * live in the routes' own tests); this asserts what the producer sees: the
 * Files menu action, the Studio loading the file through the owner-gated
 * download route, no track-only panels, an offline-saved file opening with the
 * API unreachable, a bad link saying so, and no stored reference in the DOM.
 * Signs in through the stub Supabase like links-filtering.spec.ts.
 */
const P = '40000000-0000-4000-8000-0000000000a1';
const F = '60000000-0000-4000-8000-000000000001';
const DOC = '60000000-0000-4000-8000-000000000002';
const T = '70000000-0000-4000-8000-000000000001';
const FILE_ID = `project:${P}:file:${F}`;
const DOWNLOAD = `/api/projects/${P}/assets/${F}/download`;

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => {
  if (stubSupabaseConfigured()) stub = await startStubSupabase();
});
test.afterAll(async () => {
  await stub?.close();
});

/** A real (0.1 s, silent, 8 kHz 8-bit mono) WAV. */
function wavBytes(): number[] {
  const n = 800;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return [...b];
}

const view = (id: string, label: string, over: Record<string, unknown> = {}) => ({
  id, project_id: P, kind: 'audio', label, file_name: `${label}.wav`, mime: 'audio/wav', size_bytes: 5_242_880, position: 0,
  in_portal: false, portal_at: null, created_at: new Date().toISOString(), downloadUrl: `/api/projects/${P}/assets/${id}/download`, ...over,
});

test.beforeEach(async ({ page, context, baseURL }) => {
  if (stub) await context.addCookies([signInCookie(baseURL!)]);
  const track = { id: T, title: 'Night Shift', type: 'beat', audio_url: 'r2://priv/t.wav', bpm: 140, key: 'F', scale: 'minor', stems_status: 'none', duration_seconds: 120, created_at: new Date().toISOString() };
  await page.route('**/api/tracks?*', (r) => r.fulfill({ json: [track] }));
  await page.route('**/api/tracks', (r) => r.fulfill({ json: [track] }));
  await page.route(`**/api/projects/${P}`, (r) => r.fulfill({ json: { project: { id: P, name: 'Night Drive EP', status: 'active', tags: [], price_usd: null, created_at: new Date().toISOString() } } }));
  await page.route(`**/api/projects/${P}/assets`, (r) =>
    r.fulfill({ json: { schemaReady: true, sharedWithArtists: false, assets: [view(F, 'Vocal reference'), view(DOC, 'Split sheet', { kind: 'document', file_name: 'split.pdf', mime: 'application/pdf' })] } }),
  );
  await page.route(`**/api/projects/${P}/assets/*/download*`, (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from(wavBytes()) }));
});

async function seedSavedCopy(page: Page) {
  await page.goto('/offline');
  await page.evaluate(async ({ id, bytes }) => {
    await new Promise<void>((res, rej) => {
      const open = indexedDB.open('antigravity-offline', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('blobs');
        open.result.createObjectStore('meta', { keyPath: 'id' });
      };
      open.onerror = () => rej(open.error);
      open.onsuccess = () => {
        const t = open.result.transaction(['blobs', 'meta'], 'readwrite');
        t.objectStore('blobs').put(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), id);
        t.objectStore('meta').put({ id, url: 'x', title: 'Vocal reference', size: bytes.length, cached_at: Date.now() });
        t.oncomplete = () => res();
      };
    });
  }, { id: FILE_ID, bytes: wavBytes() });
}

test('a project audio file opens in the Studio from its Files menu; a document has no such action', async ({ page }) => {
  await page.goto(`/projects/${P}`);
  await page.getByTestId(`project-file-${F}`).scrollIntoViewIfNeeded();

  await page.getByRole('button', { name: 'Split sheet options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open in Studio' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Vocal reference options' }).click();
  const downloaded = page.waitForRequest((r) => r.url().includes(DOWNLOAD));
  await page.getByRole('menuitem', { name: 'Open in Studio' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio\\?asset=${encodeURIComponent(FILE_ID).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  await expect(page.getByRole('heading', { name: 'Vocal reference' })).toBeVisible();
  await expect(page.getByText(/Project file · Night Drive EP/)).toBeVisible();
  // the audio plays through the owner-gated download route
  await downloaded;
  await expect(page.locator('audio').first()).toHaveAttribute('src', DOWNLOAD);
  // track-only panels are not there
  await expect(page.getByText('Auto-saves as you type')).toHaveCount(0);
  // the DOM never carries a stored reference
  const html = await page.content();
  expect(html).not.toMatch(/r2:\/\/|local:\/\//);
});

test('an offline-saved project file opens with the API unreachable, from the saved copy', async ({ page }) => {
  await seedSavedCopy(page);
  await page.route(`**/api/projects/${P}/assets`, (r) => r.abort());
  await page.route(`**/api/projects/${P}`, (r) => r.abort());
  await page.goto(`/studio?asset=${encodeURIComponent(FILE_ID)}`);
  await expect(page.getByRole('heading', { name: 'Vocal reference' })).toBeVisible();
  await expect(page.getByText(/Offline copy/)).toBeVisible();
  await expect(page.locator('audio[data-offline="true"]')).toHaveCount(1);
  await expect(page.locator('audio[data-offline="true"]')).toHaveAttribute('src', /^blob:/);
});

test('/offline links a saved file and a saved track to the Studio', async ({ page }) => {
  await seedSavedCopy(page);
  await page.evaluate(async (t) => {
    await new Promise<void>((res) => {
      const open = indexedDB.open('antigravity-offline', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction(['blobs', 'meta'], 'readwrite');
        tx.objectStore('blobs').put(new Blob([new Uint8Array(8)]), t);
        tx.objectStore('meta').put({ id: t, url: 'x', title: 'Night Shift', size: 8, cached_at: Date.now() });
        tx.oncomplete = () => res();
      };
    });
  }, T);
  await page.goto('/offline');
  await expect(page.getByTestId(`offline-studio-${FILE_ID}`)).toHaveAttribute('href', `/studio?asset=${encodeURIComponent(FILE_ID)}`);
  await expect(page.getByTestId(`offline-studio-${T}`)).toHaveAttribute('href', `/studio?track=${T}`);
});

test('a bad or foreign link says so and the Studio still works', async ({ page }) => {
  await page.goto('/studio?asset=nope');
  await expect(page.getByTestId('studio-asset-error')).toContainText(/does not point at a file/i);
  await expect(page.getByText('Pick a track to start')).toBeVisible();

  await page.route(`**/api/projects/${P}/assets`, (r) => r.fulfill({ status: 404, json: { error: 'Not found' } }));
  await page.goto(`/studio?asset=${encodeURIComponent(FILE_ID)}`);
  await expect(page.getByTestId('studio-asset-error')).toContainText(/not in your library/i);
});

test('picking a track in the rail replaces the opened file', async ({ page }) => {
  await page.goto(`/studio?asset=${encodeURIComponent(FILE_ID)}`);
  await expect(page.getByRole('heading', { name: 'Vocal reference' })).toBeVisible();
  await page.getByPlaceholder('Search tracks').fill('Night');
  await page.getByRole('button', { name: /Night Shift/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Night Shift' })).toBeVisible();
  await expect(page.getByText('Auto-saves as you type')).toBeVisible();
});

test('a file over 64 MB plays but skips the whole-file waveform decode', async ({ page }) => {
  await page.route(`**/api/projects/${P}/assets`, (r) =>
    r.fulfill({ json: { schemaReady: true, sharedWithArtists: false, assets: [view(F, 'Big bounce', { size_bytes: 100 * 1024 * 1024 })] } }),
  );
  await page.goto(`/studio?asset=${encodeURIComponent(FILE_ID)}`);
  await expect(page.getByRole('heading', { name: 'Big bounce' })).toBeVisible();
  await expect(page.getByTestId('studio-waveform-skipped')).toContainText(/over 64 MB/i);
  await expect(page.locator('audio').first()).toHaveAttribute('src', DOWNLOAD);
});
