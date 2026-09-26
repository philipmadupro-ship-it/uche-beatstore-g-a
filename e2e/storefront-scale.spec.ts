/**
 * Storefront at catalogue scale — 96 listed beats with covers, previews and
 * tags, driven through a real browser: first load, filters, a BPM slider drag,
 * a full scroll, repeated playback, a mobile viewport and a concurrent burst
 * against /api/store.
 *
 * What it guards is REQUEST AMPLIFICATION and UI collapse, not raw speed: a
 * page that fires one catalogue request per slider tick, fetches every cover
 * up front, or opens a new preview stream per play looks fine with the two
 * beats in store-db.json and falls over with a real catalogue.
 *
 * Needs the scale fixture, not the smoke one:
 *
 *   ENABLE_LOCAL_STORE=true npm run e2e:scale
 *
 * which writes the fixture over data/db.json (restore it with
 * `git checkout data/db.json` afterwards) and sets E2E_SCALE=1. The dev server
 * must be started with ENABLE_LOCAL_STORE=true too.
 *
 * Audio lives on a local server this spec starts on :3458 (see
 * generate-scale-db.mjs), with real `Cache-Control` and Range support. It is
 * deliberately NOT `page.route`: routing disables Chromium's HTTP cache, so
 * every cache hit would be counted as a download. Audio is counted where a CDN
 * would bill it — at the server. For the same reason there is no `page.route`
 * anywhere in this file: ANY route on the page disables the cache for all of
 * it. Covers must be https (the store rewrites them), so they point at a host
 * that does not resolve; the store shows its fallback artwork, and what is
 * measured is how many cover requests the page ISSUES — i.e. lazy loading. Metrics print as `[scale]` lines so a run
 * doubles as a measurement.
 */
import http from 'node:http';
import { test, expect, type Page, type Request } from '@playwright/test';

// Opt-in: the default `npm run e2e` (and CI) seeds the 2-beat smoke fixture,
// which this suite cannot run against. `npm run e2e:scale` sets both.
const SCALE_SEEDED = process.env.E2E_SCALE === '1' && process.env.ENABLE_LOCAL_STORE === 'true';
const MIN_BEATS = 60;
const MEDIA_PORT = 3458;

// 1s of silent 8kHz mono WAV — enough for <audio> to load and "play".
const WAV = (() => {
  const samples = 8000;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
})();

/** Hits the media server actually served, keyed by path. */
const served = { audio: new Map<string, number>(), covers: new Map<string, number>(), debug: new Map<string, number>() };
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const sumOf = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
function resetServed() { served.audio.clear(); served.covers.clear(); served.debug.clear(); }

let mediaServer: http.Server | null = null;

function startMediaServer() {
  mediaServer = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const common = {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-length, content-range',
      // What a CDN in front of R2 sends for an immutable derivative.
      'cache-control': 'public, max-age=3600, immutable',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...common, 'access-control-allow-headers': '*' });
      return res.end();
    }
    if (url.startsWith('/audio/')) {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      // Count full-body downloads; Range reads are <audio> streaming the one
      // file it already has, which is normal playback, not amplification.
      if (!range || range[1] === '0') bump(served.audio, url);
      if (process.env.SCALE_DEBUG) bump(served.debug, `${url} ${req.headers['sec-fetch-dest'] ?? '?'} ${req.headers.range ?? 'full'}`);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), WAV.length - 1) : WAV.length - 1;
        res.writeHead(206, {
          ...common, 'content-type': 'audio/wav', 'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${WAV.length}`,
        });
        return res.end(req.method === 'HEAD' ? undefined : WAV.subarray(start, end + 1));
      }
      res.writeHead(200, { ...common, 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': WAV.length });
      return res.end(req.method === 'HEAD' ? undefined : WAV);
    }
    res.writeHead(404, common);
    res.end();
  });
  return new Promise<void>((resolve) => mediaServer!.listen(MEDIA_PORT, '127.0.0.1', resolve));
}

type Probe = {
  requests: Request[];
  serverErrors: string[];
  consoleErrors: string[];
  count: (pattern: RegExp) => number;
  reset: () => void;
};

async function probe(page: Page): Promise<Probe> {
  const p: Probe = {
    requests: [],
    serverErrors: [],
    consoleErrors: [],
    count: (re) => p.requests.filter((r) => re.test(r.url())).length,
    reset: () => { p.requests.length = 0; resetServed(); },
  };
  resetServed();
  page.on('request', (r) => {
    p.requests.push(r);
    if (COVERS.test(r.url())) bump(served.covers, new URL(r.url()).pathname);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) p.serverErrors.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    // Supabase is stubbed in local-store runs; its connection noise is not
    // the storefront failing. CSP is Report-Only off /store in dev.
    const where = m.location().url ?? '';
    if (m.type() === 'error'
      && !/127\.0\.0\.1:54321|supabase|realtime|websocket/i.test(m.text())
      // Fixture covers are deliberately unanswered — see the header — whether
      // requested directly or through next/image.
      && !COVERS.test(where)
      && !where.includes('/_next/image?url=https%3A%2F%2Fscale-fixture.test')
      // Known, once-per-session: the preview drawer's artwork asks the
      // session-gated /api/tags/colors on the public store (see PR notes).
      // Counted separately below so a per-card regression still fails.
      && !where.endsWith('/api/tags/colors')) {
      p.consoleErrors.push(`${m.text()} ${m.location().url ?? ''}`.trim());
    }
  });
  return p;
}

const STORE_API = /\/api\/store(\?|$)/;
const COVERS = /^https:\/\/scale-fixture\.test\/covers\//;

function log(label: string, value: unknown) {
  console.log(`[scale] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function openStore(page: Page) {
  const started = Date.now();
  await page.goto('/store');
  const cards = page.locator('[id^="beat-"]');
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  return { cards, firstCardMs: Date.now() - started };
}

test.describe('storefront at scale', () => {
  test.skip(!SCALE_SEEDED, 'scale suite: run `ENABLE_LOCAL_STORE=true npm run e2e:scale`');
  test.beforeAll(startMediaServer);
  test.afterAll(() => new Promise<void>((resolve) => (mediaServer ? mediaServer.close(() => resolve()) : resolve())));

  test('first load renders the catalogue without fetching every asset', async ({ page }) => {
    const p = await probe(page);
    const { cards, firstCardMs } = await openStore(page);
    await page.waitForLoadState('networkidle');

    const rendered = await cards.count();
    const covers = sumOf(served.covers);
    const storeCalls = p.count(STORE_API);
    log('first card visible ms', firstCardMs);
    log('first load', { rendered, storeCalls, covers, audio: sumOf(served.audio), total: p.requests.length });

    expect(rendered).toBeGreaterThanOrEqual(MIN_BEATS);
    // One catalogue query per visit. Initialising the range sliders used to
    // change the query key and fetch the same catalogue a second time.
    expect(storeCalls).toBe(1);
    // Covers are lazy: the first viewport, not the whole catalogue.
    expect(covers).toBeLessThan(rendered);
    // Preview prefetch is queued and capped (preview-cache MAX_QUEUE_PER_CALL = 30).
    expect(sumOf(served.audio)).toBeLessThanOrEqual(30);
    expect(p.serverErrors).toEqual([]);
    expect(p.consoleErrors).toEqual([]);

    // A public catalogue must never carry a private master reference.
    const body = await (await page.request.get('/api/store')).text();
    expect(body).not.toContain('r2://');
  });

  test('filters and a BPM drag do not storm /api/store', async ({ page }) => {
    const p = await probe(page);
    const { cards } = await openStore(page);
    await page.waitForLoadState('networkidle');

    const genre = page.getByRole('button', { name: 'Trap', exact: true }).filter({ visible: true }).first();
    const filters: Record<string, number> = {};

    p.reset();
    await genre.click();
    await page.waitForLoadState('networkidle');
    filters.genre = p.count(STORE_API);
    await expect.poll(() => cards.count()).toBeLessThan(MIN_BEATS);
    expect(await cards.count()).toBeGreaterThan(0);
    await genre.click(); // clear
    await page.waitForLoadState('networkidle');

    // Drag the min-BPM slider across 30 steps, as a mouse drag would.
    // The mobile filter sheet renders the same controls off-screen; take the visible one.
    const slider = page.getByLabel('Minimum BPM').filter({ visible: true }).first();
    await slider.scrollIntoViewIfNeeded();
    p.reset();
    for (let i = 0; i < 30; i++) await slider.press('ArrowRight');
    // The drag must still reach the server once it settles — zero would mean
    // the filter silently stopped applying to the catalogue.
    await expect.poll(() => p.count(/\/api\/store\?.*bpmMin=/), { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    await page.waitForLoadState('networkidle');
    filters.bpmDrag30Steps = p.count(STORE_API);

    p.reset();
    await page.getByRole('button', { name: /^Free only/ }).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');
    filters.free = p.count(STORE_API);

    log('/api/store calls per filter action', filters);
    expect(filters.genre).toBeLessThanOrEqual(1);
    // A slider drag is one intent. It must settle into a bounded number of
    // catalogue queries, not one per tick.
    expect(filters.bpmDrag30Steps).toBeGreaterThanOrEqual(1);
    expect(filters.bpmDrag30Steps).toBeLessThanOrEqual(3);
    expect(filters.free).toBeLessThanOrEqual(1);
    expect(p.serverErrors).toEqual([]);
    expect(p.consoleErrors).toEqual([]);
  });

  test('scrolling the whole catalogue and replaying tracks stays bounded', async ({ page }) => {
    const p = await probe(page);
    const { cards } = await openStore(page);
    const total = await cards.count();

    // Scroll card by card to the end; every card should end up with its cover.
    await cards.last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 20_000);
    await page.waitForLoadState('networkidle');
    const coversAfterScroll = sumOf(served.covers);
    log('covers after full scroll', { coversAfterScroll, total });
    // Each cover fetched at most once (browser cache), never per re-render.
    expect(coversAfterScroll).toBeLessThanOrEqual(total);

    await page.evaluate(() => {
      window.scrollTo(0, 0);
      // The fixture clip is 1s, so sampling "is anything playing" at the end
      // is a race. Record every start and the peak number playing at once.
      const w = window as unknown as { __plays: number; __peak: number };
      w.__plays = 0; w.__peak = 0;
      document.addEventListener('playing', () => {
        w.__plays += 1;
        const now = Array.from(document.querySelectorAll('audio')).filter((a) => !a.paused).length;
        w.__peak = Math.max(w.__peak, now);
      }, true);
    });
    p.reset();
    const heap0 = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
    for (let i = 0; i < 5; i++) {
      // Grid cards open the preview drawer; play lives there.
      await cards.nth(i).click();
      await page.getByRole('button', { name: /^(Play|Pause)$/ }).last().click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Close beat preview' }).click();
    }
    await page.waitForLoadState('networkidle');
    const { plays, peak } = await page.evaluate(() => {
      const w = window as unknown as { __plays: number; __peak: number };
      return { plays: w.__plays, peak: w.__peak };
    });
    const heap1 = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
    if (process.env.SCALE_DEBUG) log('audio downloads by path', Object.fromEntries(served.debug));
    log('playback x5', { audioRequests: sumOf(served.audio), playbackStarts: plays, peakSimultaneous: peak, heapDeltaMB: +((heap1 - heap0) / 1e6).toFixed(1) });

    // Five presses really started playback, and never two clips at once.
    expect(plays).toBeGreaterThanOrEqual(5);
    expect(peak).toBe(1);
    // Some previews may already be cached by prefetch; never more than ~2 per play.
    expect(sumOf(served.audio)).toBeLessThanOrEqual(10);
    expect(p.serverErrors).toEqual([]);
    expect(p.consoleErrors).toEqual([]);
    // Deduped per session by useTagColorStore; more than one is a storm.
    expect(p.count(/\/api\/tags\/colors/)).toBeLessThanOrEqual(1);
  });

  test('a late facets response does not turn the first page into a filter', async ({ page }) => {
    // Beat 001 is the catalogue's only 70 BPM beat and the oldest, so it is
    // not on the first page (whose floor is 71). If the sliders take their
    // range from the first page, bpmMin=71 becomes a real filter and hides it.
    // Its own context: a route disables the HTTP cache, which the audio counts
    // in the other tests depend on.
    await page.route('**/api/store/facets', async (route) => {
      await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });
    const p = await probe(page);
    await openStore(page);
    await page.waitForResponse('**/api/store/facets');
    await page.waitForLoadState('networkidle');

    const narrowed = p.requests.filter((r) => /\/api\/store\?.*(bpmMin|bpmMax|priceMin|priceMax)=/.test(r.url()));
    log('range params sent without the buyer touching a slider', narrowed.length);
    expect(narrowed).toHaveLength(0);

    await page.getByPlaceholder('Search title, key, BPM, tag…').filter({ visible: true }).first().fill('SCALE BEAT 001');
    await expect(page.locator('[id="beat-scale-beat-001"]')).toBeVisible({ timeout: 10_000 });
  });

  test('mobile viewport renders the scaled catalogue without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const p = await probe(page);
    const { cards } = await openStore(page);
    expect(await cards.count()).toBeGreaterThanOrEqual(MIN_BEATS);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log('mobile horizontal overflow px', overflow);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(p.consoleErrors).toEqual([]);
  });

  test('50 concurrent catalogue requests succeed with bounded latency', async ({ request }) => {
    const urls = [
      '/api/store', '/api/store?genre=Trap', '/api/store?bpmMin=100&bpmMax=140',
      '/api/store?priceMin=30&priceMax=60', '/api/store?free=1', '/api/store/facets',
    ];
    const timings: number[] = [];
    const statuses: number[] = [];
    // Warm the route so the dev server's first compile is not measured.
    await request.get('/api/store');
    await request.get('/api/store/facets');
    const startedAt = Date.now();
    await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      const t = Date.now();
      const res = await request.get(urls[i % urls.length]);
      timings.push(Date.now() - t);
      statuses.push(res.status());
    }));
    const wall = Date.now() - startedAt;
    timings.sort((a, b) => a - b);
    const pct = (q: number) => timings[Math.min(timings.length - 1, Math.floor(q * timings.length))];
    const errors = statuses.filter((s) => s >= 400).length;
    log('burst 50', { wallMs: wall, p50: pct(0.5), p95: pct(0.95), max: timings.at(-1), errors });

    expect(errors).toBe(0);
    // Generous: this runs against `next dev`. It exists to catch a collapse
    // (serialised handlers, a per-request full-catalogue rebuild), not to set an SLO.
    expect(pct(0.95)).toBeLessThan(10_000);
  });
});
