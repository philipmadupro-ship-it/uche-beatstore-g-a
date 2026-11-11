/**
 * The share page's track list for a LONG share: the store's row (cover, title,
 * BPM | key, genre / mood chips, waveform, Download on the row), search,
 * filters and sort above it, and no second "Downloads" list at the bottom.
 *
 * The share API is mocked; this is about what the page does with 50 beats.
 * Playback is checked the way share-options.spec.ts checks it: through the
 * page's one real player (HTMLMediaElement.play), not through a fetch.
 */
import { expect, test, type Page } from '@playwright/test';

const TOKEN = 'e2eShareList01';
const KINDS = ['client', 'producer', 'rapper', 'friend'] as const;
type Kind = (typeof KINDS)[number];

const GENRES = ['Trap', 'Drill', 'Lo-fi', 'R&B'];
const MOODS = ['Dark', 'Chill', 'Hype'];
const KEYS: [string, string][] = [['F', 'minor'], ['C', 'major'], ['A', 'minor'], ['Bb', 'major']];

function makeTracks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    // Zero-padded index in the id and a unique word in the title, so a search
    // for one beat cannot also hit a number elsewhere.
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    title: `Beat ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'][i % 10]} ${String.fromCharCode(97 + Math.floor(i / 10))}`,
    type: i % 10 === 9 ? 'loop' : 'beat',
    audio_url: `/e2e-list-tone.wav?i=${i}`,
    peaks_url: null,
    cover_url: null,
    duration_seconds: 150,
    bpm: 80 + i * 2,
    key: KEYS[i % 4][0],
    scale: KEYS[i % 4][1],
    lyrics: null,
    description: null,
    lease_price_usd: null,
    exclusive_price_usd: null,
    created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    tags: [
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

async function stubShare(page: Page, kind: Kind, trackCount: number, o: { allowDownloads?: boolean } = {}) {
  const tracks = makeTracks(trackCount);
  const downloads: string[] = [];
  const peaksRequests: string[] = [];
  await page.addInitScript(() => {
    const w = window as unknown as { __played: string[] };
    w.__played = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      w.__played.push(this.currentSrc || this.src);
      return original.call(this).catch(() => undefined);
    };
  });
  const wav = toneWav();
  await page.route(/\/e2e-list-tone\.wav/, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }));
  await page.route(new RegExp(`/api/share/${TOKEN}/download\\?`), (route) => {
    downloads.push(new URL(route.request().url()).searchParams.get('track_id') ?? '');
    return route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'content-disposition': `attachment; filename="beat.wav"` },
      body: wav,
    });
  });
  await page.route(/\/api\/tracks\/[^/]+\/heatmap/, (route) => route.fulfill(json(200, { heatmap: [] })));
  await page.route(/peaks/, (route) => { peaksRequests.push(route.request().url()); return route.fulfill(json(404, {})); });
  await page.route(new RegExp(`/api/projects/share/${TOKEN}/comments`), (route) => route.fulfill(json(200, { comments: [] })));
  await page.route(new RegExp(`/api/projects/share/${TOKEN}(\\?.*)?$`), (route) =>
    route.fulfill(json(200, {
      share: {
        token: TOKEN, role: 'viewer', allow_downloads: o.allowDownloads ?? true, full_playback: true,
        expires_at: null, label: 'Big pack', recipient_kind: kind, sales_enabled: false,
      },
      project: { id: 'p1', name: 'Big Pack', cover_url: null, description: null, bpm_target: null, key_target: null, status: 'active' },
      tracks,
      creator: null,
      licenses: [],
      stems: [],
      artworkTheme: null,
    })),
  );
  return { tracks, downloads, peaksRequests };
}

const rows = (page: Page) => page.getByTestId('share-track-row');
const count = (page: Page) => page.getByTestId('share-list-count');

for (const kind of KINDS) {
  test.describe(`50-track share · ${kind}`, () => {
    test('one list: rows with waveform + chips, controls above, no Downloads list at the bottom', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);
      await expect(count(page)).toHaveText('50 tracks');
      await expect(page.getByRole('searchbox', { name: 'Search tracks' })).toBeVisible();

      const first = rows(page).first();
      await expect(first.getByTestId('share-track-tags')).toContainText('Trap');
      await expect(first.getByTestId('share-row-waveform-slot')).toBeVisible();
      await expect(first.getByRole('button', { name: /^Download Beat/ })).toBeVisible();

      // 50 Download buttons, all on rows, none in the share options block.
      await expect(page.getByRole('button', { name: /^Download Beat/ })).toHaveCount(50);
      const actions = page.getByTestId('share-actions');
      await actions.scrollIntoViewIfNeeded();
      await expect(actions.getByRole('button', { name: /^Download / })).toHaveCount(0);
      await expect(actions.getByText('Downloads', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('share-playback-mode')).toHaveText(/Full track/);
    });

    test('search, genre, BPM range and sort narrow and reorder the list', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);

      // Search: every word, across title and tags.
      const search = page.getByRole('searchbox', { name: 'Search tracks' });
      await search.fill('hotel');
      await expect(rows(page)).toHaveCount(5);
      await expect(count(page)).toHaveText('5 of 50');
      await search.press('Escape');
      await expect(rows(page)).toHaveCount(50);

      // Genre dropdown, by keyboard: Trap is every 4th beat (13 of 50).
      await page.getByRole('button', { name: 'Filter by genre' }).click();
      await page.getByRole('option', { name: /^Trap/ }).click();
      await expect(rows(page)).toHaveCount(13);
      await expect(count(page)).toHaveText('13 of 50');

      // BPM range on top of it: Trap beats are i = 0,4,8…; bpm = 80 + 2i.
      await page.getByLabel('Minimum BPM').fill('100');
      await page.getByLabel('Maximum BPM').fill('140');
      // i in {10..30} ∩ {0,4,…,48} = 12,16,20,24,28 -> 5.
      await expect(rows(page)).toHaveCount(5);

      await page.getByRole('button', { name: /Clear filters/ }).click();
      await expect(rows(page)).toHaveCount(50);

      // Sort: BPM high to low puts the 178 BPM beat first; Title A-Z starts with Alpha.
      await page.getByRole('button', { name: 'Sort tracks' }).click();
      await page.getByRole('option', { name: 'BPM high to low' }).click();
      await expect(rows(page).first()).toContainText('178 BPM');
      await page.getByRole('button', { name: 'Sort tracks' }).click();
      await page.getByRole('option', { name: 'Title A to Z' }).click();
      await expect(rows(page).first()).toContainText('Beat Alpha a');
      await page.getByRole('button', { name: 'Sort tracks' }).click();
      await page.getByRole('option', { name: 'Share order' }).click();
      await expect(rows(page).first()).toContainText('80 BPM');
    });

    test('an empty result says so and offers to clear', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await page.getByRole('searchbox', { name: 'Search tracks' }).fill('zzzzzz');
      await expect(page.getByTestId('share-list-empty')).toBeVisible();
      await expect(count(page)).toHaveText('0 of 50');
      await page.getByTestId('share-list-empty').getByRole('button', { name: 'Clear filters' }).click();
      await expect(rows(page)).toHaveCount(50);
    });

    test('play from a filtered row plays THAT track; only the playing row has a live seek slider', async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await page.getByRole('searchbox', { name: 'Search tracks' }).fill('golf');
      await expect(rows(page)).toHaveCount(5);
      // The second match, not the first: a click that fell back to the
      // unfiltered index would play the wrong beat.
      const row = rows(page).nth(1);
      await expect(row).toContainText('Beat Golf b');
      await page.evaluate(() => { (window as unknown as { __played: string[] }).__played = []; });
      await row.getByTestId('share-track-play').click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played.length), { timeout: 15_000 })
        .toBeGreaterThan(0);
      await expect(row.getByTestId('share-track-play')).toHaveAttribute('aria-pressed', 'true');
      await expect(row.getByRole('slider', { name: /^Seek / })).toBeVisible();
      await page.getByRole('button', { name: 'Clear filters' }).first().click();
      await expect(rows(page)).toHaveCount(50);
      // The playing row keeps the one live slider (its bars are only mounted
      // while it is near the viewport, so bring it back into view first).
      await rows(page).filter({ hasText: 'Beat Golf b' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('slider', { name: /^Seek / })).toHaveCount(1);
    });

    test('Download on a row asks for that track', async ({ page }) => {
      const { tracks, downloads } = await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      const row = rows(page).filter({ hasText: 'Beat Juliet' }).first();
      await row.scrollIntoViewIfNeeded();
      const title = (await row.locator('span.truncate').first().textContent())?.trim() ?? '';
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.getByRole('button', { name: `Download ${title}` }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('beat.wav');
      expect(downloads).toHaveLength(1);
      expect(tracks.map((t) => t.id)).toContain(downloads[0]);
    });

    test('downloads off: no Download on any row, notice in the options block', async ({ page }) => {
      await stubShare(page, kind, 50, { allowDownloads: false });
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);
      await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(0);
      await expect(page.getByTestId('share-actions').getByText('Downloads are off for this link.')).toBeVisible();
    });

    test('a long share does not mount a waveform per row', async ({ page }) => {
      await stubShare(page, kind, 200);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(200);
      // In some layouts the list starts below the fold; bring it into view.
      await rows(page).first().scrollIntoViewIfNeeded();
      // Bars exist only near the viewport: far fewer than 200 waveform SVGs.
      await expect
        .poll(() => page.locator('[data-testid="share-row-waveform"] svg').count(), { timeout: 15_000 })
        .toBeGreaterThan(0);
      expect(await page.locator('[data-testid="share-row-waveform"] svg').count()).toBeLessThan(60);
    });
  });
}

test.describe('short share', () => {
  test('three tracks: rows with waveform and download, but no search / filter / sort', async ({ page }) => {
    await stubShare(page, 'client', 3);
    await page.goto(`/projects/share/${TOKEN}`);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByTestId('share-list-controls')).toHaveCount(0);
    await expect(rows(page).first().getByTestId('share-row-waveform-slot')).toBeVisible();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const kind of KINDS) {
    test(`${kind}: no horizontal scroll; controls and rows fit`, async ({ page }) => {
      await stubShare(page, kind, 50);
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(rows(page)).toHaveCount(50);
      await expect(page.getByRole('searchbox', { name: 'Search tracks' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
