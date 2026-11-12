/**
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

function toneWav(seconds = 3, rate = 8000): Buffer {
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
  await page.route(/\/e2e-list-tone\.wav/, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }));
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
const count = (page: Page) => page.getByTestId('share-list-count');
const rowPlay = (page: Page, title: string) =>
  rows(page).filter({ hasText: title }).first().getByRole('button', { name: /Play track|Pause track/ });

for (const kind of KINDS) {
  test.describe(`50-track share · ${kind}`, () => {
    test('the header, the Library toolbar and rows; no Downloads list at the bottom', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(page.getByTestId('share-header')).toContainText('Big Pack');
      await expect(page.getByTestId('share-header')).toContainText('50 tracks');
      await expect(rows(page)).toHaveCount(50);
      await expect(count(page)).toHaveText('50 tracks');
      await expect(page.getByRole('searchbox', { name: 'Search tracks' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Filters/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Download Beat/ })).toHaveCount(50);

      // The share options are in the header strip, and it holds no per-track list.
      const actions = page.getByTestId('share-actions');
      await expect(actions.getByRole('button', { name: /^Download (?!all$)/ })).toHaveCount(0);
      await expect(page.getByText('Downloads', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('share-playback-mode')).toHaveText(/Full track/);
    });

    test('search, the Library FilterBar (Genre, BPM) and sort narrow and reorder the list', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);

      const search = page.getByRole('searchbox', { name: 'Search tracks' });
      await search.fill('hotel');
      await expect(rows(page)).toHaveCount(5);
      await expect(count(page)).toHaveText('5 of 50');
      await search.fill('');
      await expect(rows(page)).toHaveCount(50);

      await page.getByRole('button', { name: /Filters/ }).click();
      // Owner-only facets are not offered to a recipient.
      await expect(page.getByRole('button', { name: /^State/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Stage/ })).toHaveCount(0);
      await page.getByRole('button', { name: /^Genre/ }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Trap' }).click();
      await page.keyboard.press('Escape');
      // Trap is every 4th beat: 13 of 50. The filter is in the URL (the Library's tag/genre codec).
      await expect(rows(page)).toHaveCount(13);
      await expect(page).toHaveURL(/genre=Trap/);

      await page.reload();
      await expect(rows(page)).toHaveCount(13);

      // Sort: BPM descending puts the 178 BPM beat first; Title A→Z starts with Alpha.
      await page.getByRole('button', { name: 'Sort tracks' }).click();
      await page.getByRole('option', { name: 'BPM ↓' }).click();
      await expect(rows(page).first()).toContainText('176 BPM');
    });

    test('an empty result says so and offers to clear', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await page.getByRole('searchbox', { name: 'Search tracks' }).fill('zzzzzz');
      await expect(page.getByTestId('share-list-empty')).toBeVisible();
      await page.getByTestId('share-list-empty').getByRole('button', { name: 'Clear filters' }).click();
      await expect(rows(page)).toHaveCount(50);
    });

    test('Download on a row asks for that track; Download all asks for the zip', async ({ page }) => {
      const { tracks, downloads, zips } = await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      const row = rows(page).filter({ hasText: 'Beat Juliet' }).first();
      await row.scrollIntoViewIfNeeded();
      const title = (await row.locator('h4').first().textContent())?.trim() ?? '';
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.getByRole('button', { name: new RegExp(`^Download ${title}$`, 'i') }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('beat.wav');
      expect(tracks.map((t) => t.id)).toContain(downloads[0]);

      await page.getByTestId('share-actions').scrollIntoViewIfNeeded();
      // A plain navigation (no password), so the browser streams the archive to
      // disk. The browser hands it to the download manager, so what is asserted
      // is the download's URL; the route's gate is covered by its unit tests.
      const [zip] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('share-actions').getByRole('button', { name: 'Download all' }).click(),
      ]);
      expect(new URL(zip.url()).pathname).toBe(`/api/share/${TOKEN}/download-all`);
      expect(zips.length).toBeLessThanOrEqual(1);
    });

    test('downloads off: no Download on any row, no Download all, notice in the header', async ({ page }) => {
      await stubShare(page, kind, 50, { allowDownloads: false });
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);
      await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(0);
      await expect(page.getByTestId('share-actions').getByText('Downloads are off for this link.')).toBeVisible();
    });

    test('a long share does not mount a waveform per row', async ({ page }) => {
      const { peaksRequests } = await stubShare(page, kind, 200);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(200);
      await rows(page).first().scrollIntoViewIfNeeded();
      await expect.poll(() => page.locator('[data-testid="share-track-row"] [role="slider"] path').count(), { timeout: 15_000 }).toBeGreaterThan(0);
      // 200 rows are in the DOM, but peaks are fetched and drawn only for the rows near the viewport.
      expect(await page.locator('[data-testid="share-track-row"] [role="slider"] path').count()).toBeLessThan(60);
      expect(peaksRequests.length).toBeLessThan(60);
    });
  });
}

test.describe('short share', () => {
  test('three tracks: Library rows, no toolbar', async ({ page }) => {
    await stubShare(page, 'client', 3);
    await page.goto(`/projects/share/${TOKEN}`);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole('searchbox', { name: 'Search tracks' })).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const kind of KINDS) {
    test(`${kind}: no horizontal scroll, and Filters opens the Library's bottom drawer`, async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: /Filters/ }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText('50 tracks shown');
      await drawer.getByRole('button', { name: /^Genre/ }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Drill', exact: true }).click();
      await expect(drawer).toContainText(/\d+ tracks? shown/);
      await page.keyboard.press('Escape');
    });
  }
});

test.describe('play from a filtered row', () => {
  test('plays THAT track through the page engine', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __played: string[] };
      w.__played = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
        w.__played.push(this.currentSrc || this.src);
        return original.call(this).catch(() => undefined);
      };
    });
    await stubShare(page, 'client', 50);
    await page.goto(`/projects/share/${TOKEN}`);
    await page.getByRole('searchbox', { name: 'Search tracks' }).fill('golf');
    await expect(rows(page)).toHaveCount(5);
    const second = rows(page).nth(1);
    await expect(second).toContainText('Beat Golf b');
    await second.getByRole('button', { name: 'Play track' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played.length), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(rowPlay(page, 'Beat Golf b')).toHaveAttribute('aria-label', 'Pause track');
    await expect(page.getByTestId('share-transport-bar')).toContainText('Beat Golf b');
  });
});
