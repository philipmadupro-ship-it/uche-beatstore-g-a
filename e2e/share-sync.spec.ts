/**
 * (stub helpers shared with share-track-list.spec.ts)
 * A long share, end to end: the Library's rows with a waveform, Download on each
 * row, the Library toolbar and FilterBar above them (search, Genre, Tags, BPM,
 * sort), the header's one-zip "Download all", and NO second Downloads list.
 * The share API is mocked; this is what the PAGE does with 50 beats.
 */
import { expect, test, type Page } from '@playwright/test';

const TOKEN = 'e2eShareList01';
const KINDS = ['client', 'producer', 'rapper', 'friend'] as const;
type Kind = (typeof KINDS)[number];

const GENRES = ['Trap', 'Drill', 'Lo-Fi', 'R&B'];
const MOODS = ['Dark', 'Chill', 'Hype'];
const WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];

function makeTracks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    title: `Beat ${WORDS[i % 10]} ${String.fromCharCode(97 + Math.floor(i / 10))}`,
    type: i % 10 === 9 ? 'loop' : 'beat',
    audio_url: `/e2e-list-tone.wav?i=${i}`,
    peaks_url: '/e2e-list-peaks.json',
    cover_url: null,
    duration_seconds: 150,
    bpm: 80 + i * 2,
    key: ['F', 'C', 'A', 'Bb'][i % 4],
    scale: ['minor', 'major', 'minor', 'major'][i % 4],
    lyrics: null,
    description: null,
    lease_price_usd: null,
    exclusive_price_usd: null,
    created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    track_tags: [
      { tag: GENRES[i % 4], category: 'genre' },
      { tag: MOODS[i % 3], category: 'mood' },
    ],
  }));
}

function toneWav(seconds = 150, rate = 8000): Buffer {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i++) buf[44 + i] = 128 + Math.round(4 * Math.sin((2 * Math.PI * 220 * i) / rate));
  return buf;
}

const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubShare(page: Page, kind: Kind, count: number, o: { allowDownloads?: boolean } = {}) {
  const tracks = makeTracks(count);
  const downloads: string[] = [];
  const zips: string[] = [];
  const wav = toneWav();
  const peaksRequests: string[] = [];
  await page.route(/\/e2e-list-peaks\.json/, (route) => {
    peaksRequests.push(route.request().url());
    return route.fulfill(json(200, { version: 1, peaks: Array.from({ length: 300 }, (_, i) => Math.abs(Math.sin(i / 7))), duration: 150, length: 300 }));
  });
  await page.route(/\/e2e-list-tone\.wav/, (route) => {
    // Honour Range like R2 does: without it Chromium cannot seek a stubbed file.
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
    if (!m) return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' }, body: wav });
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start, end + 1) });
  });
  await page.route(new RegExp(`/api/share/${TOKEN}/download\\?`), (route) => {
    downloads.push(new URL(route.request().url()).searchParams.get('track_id') ?? '');
    return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'content-disposition': 'attachment; filename="beat.wav"' }, body: wav });
  });
  await page.route(new RegExp(`/api/share/${TOKEN}/download-all`), (route) => {
    zips.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="Big Pack.zip"' }, body: Buffer.from('PK') });
  });
  await page.route(/\/api\/tracks\/[^/]+\/heatmap/, (route) => route.fulfill(json(200, { heatmap: [] })));
  await page.route(new RegExp(`/api/projects/share/${TOKEN}/comments`), (route) => route.fulfill(json(200, { comments: [] })));
  await page.route(new RegExp(`/api/projects/share/${TOKEN}(\\?.*)?$`), (route) =>
    route.fulfill(json(200, {
      share: {
        token: TOKEN, role: 'viewer', allow_downloads: o.allowDownloads ?? true, full_playback: true,
        expires_at: null, label: 'Big pack', recipient_kind: kind, sales_enabled: false,
      },
      project: { id: 'p1', name: 'Big Pack', cover_url: null, description: 'Fifty beats.', bpm_target: null, key_target: null, status: 'active' },
      tracks, creator: { display_name: 'Producer' }, licenses: [], stems: [], artworkTheme: null,
    })),
  );
  return { tracks, downloads, zips, peaksRequests };
}


const rows = (page: Page) => page.getByTestId('share-track-row');
const bar = (page: Page) => page.getByTestId('share-transport-bar');
const disc = (page: Page) => page.getByTestId('share-vinyl-disc');
const rowPlay = (page: Page, title: string) =>
  rows(page).filter({ hasText: title }).first().getByRole('button', { name: /Play track|Pause track/ });
const pct = async (loc: ReturnType<Page['locator']>) => Number(await loc.first().getAttribute('aria-valuenow'));

test.describe('one engine: bar, rows and vinyl show one state', () => {
  test('play from a row: bar, row and vinyl agree; vinyl spins only while playing', async ({ page }) => {
    await stubShare(page, 'client', 12);
    await page.goto(`/projects/share/${TOKEN}`);
    await expect(rows(page)).toHaveCount(12);
    await expect(disc(page)).toHaveAttribute('data-spinning', 'false');

    await rowPlay(page, 'Beat Charlie').click();
    await expect(bar(page)).toContainText('Beat Charlie');
    await expect(bar(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(disc(page)).toHaveAttribute('data-spinning', 'true');
    await expect(rowPlay(page, 'Beat Charlie')).toHaveAccessibleName('Pause track');

    await bar(page).getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(disc(page)).toHaveAttribute('data-spinning', 'false');
    await expect(bar(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(rowPlay(page, 'Beat Charlie')).toHaveAccessibleName('Play track');
  });

  test('seeking from the bar moves the active row waveform to the same place', async ({ page }) => {
    await stubShare(page, 'client', 12);
    await page.goto(`/projects/share/${TOKEN}`);
    await rowPlay(page, 'Beat Alpha').click();
    await expect(disc(page)).toHaveAttribute('data-spinning', 'true');
    await bar(page).getByRole('button', { name: 'Pause', exact: true }).click();

    const barSlider = bar(page).getByRole('slider', { name: /^Seek/ });
    const box = await barSlider.boundingBox();
    if (!box) throw new Error('no bar slider box');
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    await expect.poll(() => pct(barSlider)).toBeGreaterThan(45);
    const rowSlider = rows(page).filter({ hasText: 'Beat Alpha' }).first().getByRole('slider');
    await expect.poll(async () => Math.abs((await pct(rowSlider)) - (await pct(barSlider)))).toBeLessThanOrEqual(3);
  });

  test('Next from the bar changes the playing row; an idle row waveform click starts that track', async ({ page }) => {
    await stubShare(page, 'client', 12);
    await page.goto(`/projects/share/${TOKEN}`);
    await rowPlay(page, 'Beat Alpha').click();
    await expect(bar(page)).toContainText('Beat Alpha');
    await bar(page).getByRole('button', { name: 'Next track' }).click();
    await expect(bar(page)).toContainText('Beat Bravo');
    await expect(rowPlay(page, 'Beat Bravo')).toHaveAccessibleName('Pause track');
    await expect(rowPlay(page, 'Beat Alpha')).toHaveAccessibleName('Play track');

    const idle = rows(page).filter({ hasText: 'Beat Echo' }).first().locator('[role="slider"], svg').first();
    await idle.scrollIntoViewIfNeeded();
    await idle.click();
    await expect(bar(page)).toContainText('Beat Echo');
    await expect(disc(page)).toHaveAttribute('data-spinning', 'true');
  });

  test('a finished track advances in share order', async ({ page }) => {
    await stubShare(page, 'client', 12);
    const short = toneWav(3);
    await page.route(/\/e2e-list-tone\.wav/, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: short }));
    await page.route(/\/e2e-list-peaks\.json/, (route) =>
      route.fulfill(json(200, { version: 1, peaks: Array.from({ length: 300 }, (_, i) => Math.abs(Math.sin(i / 7))), duration: 3, length: 300 })));
    await page.goto(`/projects/share/${TOKEN}`);
    await rowPlay(page, 'Beat Alpha').click();
    await expect(bar(page)).not.toContainText('Beat Alpha', { timeout: 15_000 });
    await expect(rowPlay(page, 'Beat Alpha')).toHaveAccessibleName('Play track');
  });

  test('reduced motion: the vinyl never spins', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubShare(page, 'client', 12);
    await page.goto(`/projects/share/${TOKEN}`);
    await rowPlay(page, 'Beat Alpha').click();
    await expect(bar(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    // data-spinning is the engine state; under reduced motion no animation is attached at all.
    await expect.poll(() => disc(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});
