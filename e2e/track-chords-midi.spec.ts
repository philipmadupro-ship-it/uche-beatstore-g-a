/**
 * Detect chords → MIDI in the Library's track drawer, end to end in a real
 * browser: the real Essentia worker, the real 44.1 kHz decode, the real
 * download. Only the data is stubbed — the audio is a synthesised
 * C–Am–F–G WAV served where `/api/audio` would stream the master.
 *
 * Sign-in goes through e2e/fixtures/stub-supabase.ts as in the cover specs.
 */
import { readFile } from 'node:fs/promises';
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

const TRACK_ID = 'e2e-chords-track';
const SECONDS_PER_CHORD = 4;
const PROGRESSION: Array<[string, number[]]> = [
  ['C', [261.63, 329.63, 392.0]],
  ['Am', [220.0, 261.63, 329.63]],
  ['F', [174.61, 220.0, 261.63]],
  ['G', [196.0, 246.94, 293.66]],
];

/** 16-bit mono 44.1 kHz WAV of the progression, a few harmonics per note. */
function progressionWav(): Buffer {
  const rate = 44100;
  const n = rate * SECONDS_PER_CHORD * PROGRESSION.length;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const [, freqs] = PROGRESSION[Math.floor(t / SECONDS_PER_CHORD)];
    let v = 0;
    for (const f of freqs) for (let h = 1; h <= 3; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    data.writeInt16LE(Math.round((v / 6) * 0.8 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const track = {
  id: TRACK_ID,
  user_id: 'local-user',
  title: 'CHORDS FIXTURE',
  type: 'beat',
  audio_url: 'r2://e2e-private/chords.wav',
  peaks_url: null,
  cover_url: null,
  duration_seconds: SECONDS_PER_CHORD * PROGRESSION.length,
  bpm: 120,
  key: 'C',
  scale: 'major',
  rating: null,
  stems_status: 'none',
  created_at: '2026-09-01T00:00:00.000Z',
  track_tags: [],
};

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page: Page) {
  const saved: unknown[] = [];
  const wav = progressionWav();
  // The library list, like the real one, does not select `chords`.
  await page.route(/\/api\/tracks\?/, (route) =>
    route.fulfill(json({ tracks: [track], pageInfo: { hasMore: false, nextCursor: null } })),
  );
  await page.route(new RegExp(`/api/tracks/${TRACK_ID}(\\?.*)?$`), (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ ...track, chords: null })) : route.continue(),
  );
  await page.route(new RegExp(`/api/tracks/${TRACK_ID}/analyze`), (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill(json({ track: {}, source: 'client', chords_saved: 1 }));
  });
  await page.route(/\/api\/audio\?src=/, (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav }),
  );
  return saved;
}

test('Detect chords shows the timeline, saves it and downloads a MIDI file', async ({ page }) => {
  test.setTimeout(90_000);
  const saved = await stub(page);
  await page.goto('/library');
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    '/library is auth-gated here; run against the stub Supabase URL',
  );

  await page.getByRole('button', { name: /all tracks/i }).click();
  const row = page.getByText('CHORDS FIXTURE', { exact: true }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const detect = page.getByRole('button', { name: 'Detect chords' });
  await expect(detect).toBeVisible();
  await detect.click();

  const timeline = page.getByRole('list', { name: 'Chord timeline' });
  await expect(timeline).toBeVisible({ timeout: 60_000 });
  const labels = await timeline.locator('li span:last-child').allTextContents();
  expect(labels).toEqual(['C', 'Am', 'F', 'G']);

  await expect.poll(() => saved.length).toBe(1);
  const body = saved[0] as { chords: Array<{ time: number; chord: string }> };
  expect(body.chords.filter((c) => c.chord !== 'N').map((c) => c.chord)).toEqual(['C', 'Am', 'F', 'G']);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download MIDI' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('CHORDS FIXTURE - chords.mid');
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd');
  expect(bytes.subarray(14, 18).toString('latin1')).toBe('MTrk');
  expect(bytes.readUInt32BE(18)).toBe(bytes.length - 22);
});
