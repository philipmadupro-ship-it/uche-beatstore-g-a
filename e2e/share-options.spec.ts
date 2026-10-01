/**
 * SHARE-01: every option a producer sets on a share is honoured on the page
 * the recipient actually sees.
 *
 * Production failure this pins: a project shared with "Allow downloads" on
 * showed no download button, and every beat stopped at 1:15.
 *
 *   - Every share renders a recipient VARIANT (recipient_kind is NOT NULL
 *     DEFAULT 'client'), and no variant had a download control. The one that
 *     worked lived in a default layout no share ever reaches.
 *   - In the producer / rapper / friend variants of the project page, the
 *     player was never attached (no container element), so nothing played.
 *   - Playback length is the per-share `full_playback` option; the page must
 *     say which one the recipient is hearing.
 *
 * The share APIs are mocked: this is about what the PAGE does with the share
 * options. The server side is covered by route and lib/share tests.
 */
import { expect, test, type Page, type Request } from '@playwright/test';

const TOKEN = 'e2eShareOpts01';
const KINDS = ['client', 'producer', 'rapper', 'friend'] as const;
type Kind = (typeof KINDS)[number];

const tracks = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Track One', audio_url: '/e2e-share-tone-1.wav' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Track Two', audio_url: '/e2e-share-tone-2.wav' },
].map((t, i) => ({
  ...t,
  type: 'beat',
  peaks_url: null,
  cover_url: null,
  duration_seconds: 150,
  bpm: 140 + i,
  key: 'F',
  scale: 'minor',
  lyrics: null,
  description: null,
  lease_price_usd: null,
  exclusive_price_usd: null,
}));

/** A short quiet 8 kHz WAV: real audio, so WaveSurfer actually decodes it. */
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

interface Opts {
  kind: Kind;
  allowDownloads: boolean;
  fullPlayback: boolean;
  role?: 'viewer' | 'commenter' | 'editor';
  password?: string;
}

interface Harness {
  downloads: Request[];
  audio: string[];
}

async function stubCommon(page: Page): Promise<Harness> {
  const h: Harness = { downloads: [], audio: [] };
  // Record every play() the page's player makes. A background prefetch also
  // FETCHES the audio file, so "the file was requested" proves nothing about
  // playback; only the attached player ever calls play().
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
  await page.route(/\/e2e-share-tone-\d\.wav/, (route) => {
    h.audio.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
  });
  await page.route(new RegExp(`/api/share/${TOKEN}/download\\?`), (route) => {
    h.downloads.push(route.request());
    return route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'content-disposition': `attachment; filename="Track One.wav"; filename*=UTF-8''Track%20One.wav` },
      body: wav,
    });
  });
  await page.route(/\/api\/tracks\/[^/]+\/heatmap/, (route) => route.fulfill(json(200, { heatmap: [] })));
  return h;
}

/** Project share (/projects/share/[token]). */
async function stubProjectShare(page: Page, o: Opts): Promise<Harness> {
  const h = await stubCommon(page);
  await page.route(new RegExp(`/api/projects/share/${TOKEN}/comments`), (route) =>
    route.fulfill(json(200, { comments: [] })),
  );
  await page.route(new RegExp(`/api/projects/share/${TOKEN}(\\?.*)?$`), (route) => {
    if (o.password && route.request().headers()['x-share-password'] !== o.password) {
      return route.fulfill(json(401, { error: 'This link needs its password.', requiresPassword: true }));
    }
    return route.fulfill(json(200, {
      share: {
        token: TOKEN,
        role: o.role ?? 'viewer',
        allow_downloads: o.allowDownloads,
        full_playback: o.fullPlayback,
        expires_at: null,
        label: 'For a friend',
        recipient_kind: o.kind,
        sales_enabled: false,
      },
      project: { id: 'p1', name: 'E2E Project', cover_url: null, description: null, bpm_target: null, key_target: null, status: 'active' },
      tracks,
      creator: null,
      licenses: [],
      stems: [],
      artworkTheme: null,
    }));
  });
  return h;
}

/** Legacy track share (/share/[token]). */
async function stubLegacyShare(page: Page, o: Opts): Promise<Harness> {
  const h = await stubCommon(page);
  await page.route(new RegExp(`/api/share/${TOKEN}(\\?.*)?$`), (route) =>
    route.fulfill(json(200, {
      share: {
        token: TOKEN,
        title: 'Legacy share',
        allow_downloads: o.allowDownloads,
        full_playback: o.fullPlayback,
        recipient_kind: o.kind,
        sales_enabled: false,
      },
      tracks,
      creator: null,
      stems: [],
    })),
  );
  return h;
}

async function expectDownloadWorks(page: Page, h: Harness, password?: string) {
  const actions = page.getByTestId('share-actions');
  await expect(actions).toBeVisible();
  const button = actions.getByRole('button', { name: 'Download Track One' });
  await button.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('Track One.wav');
  expect(h.downloads).toHaveLength(1);
  const req = h.downloads[0];
  expect(new URL(req.url()).searchParams.get('track_id')).toBe(tracks[0].id);
  if (password) expect(req.headers()['x-share-password']).toBe(password);
}

async function expectDownloadsOff(page: Page, h: Harness) {
  const actions = page.getByTestId('share-actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByText('Downloads are off for this link.')).toBeVisible();
  await expect(actions.getByRole('button', { name: /^Download / })).toHaveCount(0);
  expect(h.downloads).toHaveLength(0);
}

/**
 * Pick the second track from the variant's own track list and require the
 * page's player to actually call play(). Without a mounted player container,
 * onPlay only flips React state and nothing is heard. WaveSurfer plays from a
 * blob: URL it made from the fetched file, so the play() source cannot name
 * the track; the fetch of track two plus a play() after the click does.
 */
async function expectPlays(page: Page, h: Harness, kind: Kind) {
  const row = kind === 'client'
    // The client row's play control is the cover button at the row's start.
    ? page.locator('div.group', { hasText: 'Track Two' }).locator('button').first()
    : page.locator('button', { hasText: 'Track Two' }).first();
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => { (window as unknown as { __played: string[] }).__played = []; });
  await row.click();
  await expect.poll(() => h.audio.includes('/e2e-share-tone-2.wav'), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played.length), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

// Producer / rapper / friend put the vinyl + waveform hero and a track list on
// the page. Pins the two things that were wrong there: the waveform under the
// vinyl was a SECOND player (so disc, waveform and sound ran on different
// state), and Download lived in a block at the bottom, not on the beat.
for (const kind of ['producer', 'rapper', 'friend'] as const) {
  test.describe(`project share · ${kind} · vinyl and rows`, () => {
    test('the vinyl, its waveform and the sound are one player', async ({ page }) => {
      const h = await stubProjectShare(page, { kind, allowDownloads: true, fullPlayback: true });
      await page.goto(`/projects/share/${TOKEN}`);

      const disc = page.getByTestId('share-vinyl-disc');
      const wave = page.getByTestId('share-vinyl-wave');
      await expect(disc).toHaveAttribute('data-spinning', 'false');
      // The page's engine draws into the container under the vinyl.
      await expect.poll(() => wave.evaluate((el) => el.childElementCount > 0)).toBe(true);

      await expectPlays(page, h, kind);
      // Playing Track Two moves the disc and keeps one waveform on the page.
      await expect(disc).toHaveAttribute('data-spinning', 'true');
      await expect(page.getByTestId('share-vinyl-wave')).toHaveCount(1);
    });

    test('Download is on the beat\'s own row', async ({ page }) => {
      const h = await stubProjectShare(page, { kind, allowDownloads: true, fullPlayback: true });
      await page.goto(`/projects/share/${TOKEN}`);
      const row = page.getByTestId('share-track-row').filter({ hasText: 'Track Two' });
      await row.scrollIntoViewIfNeeded();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.getByRole('button', { name: 'Download Track Two' }).click(),
      ]);
      // The stub names every file Track One.wav; the request names the beat.
      expect(download.suggestedFilename()).toMatch(/\.wav$/);
      expect(new URL(h.downloads[0].url()).searchParams.get('track_id')).toBe(tracks[1].id);
    });

    test('no download button on the rows when downloads are off', async ({ page }) => {
      await stubProjectShare(page, { kind, allowDownloads: false, fullPlayback: true });
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(page.getByTestId('share-track-row').first()).toBeVisible();
      await expect(page.getByTestId('share-track-row').getByRole('button', { name: /^Download / })).toHaveCount(0);
    });
  });
}

for (const kind of KINDS) {
  test.describe(`project share · ${kind} variant`, () => {
    test('downloads on + full track: player loads, playback says full, download saves the master', async ({ page }) => {
      const h = await stubProjectShare(page, { kind, allowDownloads: true, fullPlayback: true });
      await page.goto(`/projects/share/${TOKEN}`);
      await expectPlays(page, h, kind);
      await expect(page.getByTestId('share-playback-mode')).toHaveText(/Full track/);
      await expectDownloadWorks(page, h);
    });

    test('downloads off + 1:15 preview: no download control, playback says preview', async ({ page }) => {
      const h = await stubProjectShare(page, { kind, allowDownloads: false, fullPlayback: false });
      await page.goto(`/projects/share/${TOKEN}`);
      await expectPlays(page, h, kind);
      await expect(page.getByTestId('share-playback-mode')).toHaveText(/Preview · 1:15/);
      await expectDownloadsOff(page, h);
    });

    test('password-protected: unlock, then the download carries the password', async ({ page }) => {
      const h = await stubProjectShare(page, { kind, allowDownloads: true, fullPlayback: true, password: 'studio' });
      await page.goto(`/projects/share/${TOKEN}`);
      await page.getByPlaceholder(/password/i).fill('studio');
      await page.keyboard.press('Enter');
      await expectPlays(page, h, kind);
      await expectDownloadWorks(page, h, 'studio');
    });

    test('commenter: can open feedback from the variant and come back', async ({ page }) => {
      await stubProjectShare(page, { kind, allowDownloads: false, fullPlayback: true, role: 'commenter' });
      await page.goto(`/projects/share/${TOKEN}`);
      const open = page.getByTestId('share-actions').getByRole('button', { name: /Leave feedback/ });
      await open.scrollIntoViewIfNeeded();
      await open.click();
      await expect(page.getByPlaceholder('Your name')).toBeVisible();
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByTestId('share-actions')).toBeVisible();
    });

    test('viewer: no collaboration entry', async ({ page }) => {
      await stubProjectShare(page, { kind, allowDownloads: true, fullPlayback: true, role: 'viewer' });
      await page.goto(`/projects/share/${TOKEN}`);
      await expect(page.getByTestId('share-actions')).toBeVisible();
      await expect(page.getByRole('button', { name: /Leave feedback|Comment & edit/ })).toHaveCount(0);
    });
  });

  test.describe(`legacy share · ${kind} variant`, () => {
    test('downloads on: download works; full track labelled', async ({ page }) => {
      const h = await stubLegacyShare(page, { kind, allowDownloads: true, fullPlayback: true });
      await page.goto(`/share/${TOKEN}`);
      await expectPlays(page, h, kind);
      await expect(page.getByTestId('share-playback-mode')).toHaveText(/Full track/);
      await expectDownloadWorks(page, h);
    });

    test('downloads off: no download control; preview labelled', async ({ page }) => {
      const h = await stubLegacyShare(page, { kind, allowDownloads: false, fullPlayback: false });
      await page.goto(`/share/${TOKEN}`);
      await expect(page.getByTestId('share-playback-mode')).toHaveText(/Preview · 1:15/);
      await expectDownloadsOff(page, h);
    });
  });
}
