import { expect, test } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * AUDIO-01: one asset model across /offline, a project's Files and the Studio.
 * Every /api route is stubbed; the saved copies are real IndexedDB rows seeded
 * in the page. Signs in through the stub Supabase like links-filtering.spec.ts.
 */
let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => {
  if (stubSupabaseConfigured()) stub = await startStubSupabase();
});
test.afterAll(async () => {
  await stub?.close();
});

const track = {
  id: 't0', title: 'Night Shift', type: 'beat', audio_url: 'r2://priv/t0.wav', wav_url: null, bpm: 140, key: 'F', scale: 'minor',
  stems_status: 'none', duration_seconds: 120, created_at: new Date().toISOString(), state: 'WIP',
};
const file = (id: string, label: string, over: Record<string, unknown> = {}) => ({
  id, project_id: 'p1', kind: 'audio', label, file_name: `${id}.wav`, mime: 'audio/wav', size_bytes: 1048576, position: 0,
  in_portal: false, portal_at: null, created_at: new Date().toISOString(), downloadUrl: `/api/projects/p1/assets/${id}/download`, ...over,
});

test.beforeEach(async ({ page, context, baseURL }) => {
  if (stub) await context.addCookies([signInCookie(baseURL!)]);
  await page.route('**/api/tracks?*', (r) => r.fulfill({ json: [track] }));
  await page.route('**/api/tracks', (r) => r.fulfill({ json: [track] }));
  await page.route('**/api/projects/p1', (r) => r.fulfill({ json: { project: { id: 'p1', name: 'Night Drive EP', status: 'active', tags: [], price_usd: null, created_at: new Date().toISOString() } } }));
  await page.route('**/api/projects/p1/assets', (r) =>
    r.fulfill({ json: { schemaReady: true, sharedWithArtists: false, assets: [file('a1', 'Hook sketch'), file('a2', 'Vocal reference'), file('a3', 'Split sheet', { kind: 'document', mime: 'application/pdf' })] } }),
  );
  await page.route('**/api/audio?*', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.alloc(64) }));
  await page.goto('/offline');
  await page.evaluate(async () => {
    await new Promise<void>((res, rej) => {
      const open = indexedDB.open('antigravity-offline', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('blobs');
        open.result.createObjectStore('meta', { keyPath: 'id' });
      };
      open.onerror = () => rej(open.error);
      open.onsuccess = () => {
        const t = open.result.transaction(['blobs', 'meta'], 'readwrite');
        // A real (0.1 s, silent, 8 kHz 8-bit mono) WAV: a blob the element cannot decode would — correctly — fall back online.
        const n = 800;
        const wav = new Uint8Array(44 + n);
        const dv = new DataView(wav.buffer);
        const str = (o: number, v: string) => [...v].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
        str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
        dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
        str(36, 'data'); dv.setUint32(40, n, true); wav.fill(128, 44);
        const good = () => new Blob([wav], { type: 'audio/wav' });
        // a track saved before fingerprints existed (reads as current) and a project file saved from an OLDER file (stale)
        t.objectStore('blobs').put(good(), 't0');
        t.objectStore('meta').put({ id: 't0', url: 'x', title: 'Night Shift', size: 32, cached_at: Date.now() });
        t.objectStore('blobs').put(good(), 'project:p1:file:a2');
        t.objectStore('meta').put({ id: 'project:p1:file:a2', url: 'x', title: 'Vocal reference', size: 32, cached_at: Date.now(), contentKey: '000000000000' });
        t.oncomplete = () => res();
      };
    });
  });
});

test('/offline says what each saved item is', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByText('Night Shift')).toBeVisible();
  await expect(page.getByText('Project file', { exact: true })).toBeVisible();
  await expect(page.getByText('Track', { exact: true })).toBeVisible();
});

test('project Files: online-only, out-of-date, and no control for a document', async ({ page }) => {
  await page.goto('/projects/p1');
  await expect(page.getByTestId('project-file-offline-a1')).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('project-file-offline-a2')).toHaveAttribute('data-state', 'stale');
  await expect(page.getByTestId('project-file-offline-a3')).toHaveCount(0);
});

test('Studio plays the saved copy of a cached track', async ({ page }) => {
  await page.goto('/studio?track=t0');
  const audio = page.locator('audio[data-offline="true"]');
  await expect(audio).toHaveCount(1);
  await expect(audio).toHaveAttribute('src', /^blob:/);
});
