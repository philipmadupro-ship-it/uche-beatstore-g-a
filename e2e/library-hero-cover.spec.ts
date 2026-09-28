/**
 * The Library hero's cover tile must show the cover INSIDE the tile, cropped
 * to a centred square, whatever the source image's shape.
 *
 * It did not. The tile had `overflow-hidden` but no positioning, and the cover
 * is a next/image `fill` — `position: absolute; inset: 0`. An absolute child
 * resolves against the nearest POSITIONED ancestor and is not clipped by a
 * static one's overflow, so the cover escaped the 100/132px tile and stretched
 * across the whole hero row, painted over the title and buttons. Covers that
 * skip the optimizer (a pasted URL on another host, blob:/data:) went through
 * a plain <img> with no size at all and rendered at their natural size — a
 * top-left corner of the picture instead of a centred crop.
 *
 * Track data is stubbed so the test controls the cover's shape, and the
 * optimizer is answered with the same bytes: what is under test is layout.
 *
 * `/library` is auth-gated when Supabase is configured. In CI the proxy has a
 * stub Supabase URL and bounces to /login, so this runs where the dashboard is
 * reachable (local-store dev: `ENABLE_LOCAL_STORE=true` with no Supabase env)
 * and skips — saying why — where it is not.
 */
import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

// ── A minimal PNG encoder, so the fixture needs no image dependency ──────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A w×h PNG: blue field, a red band along the image's first 20% (left edge of
 * a landscape, top of a portrait) and a white centre square. A correct centred
 * crop of a non-square image hides the red band; a top-left render shows it.
 */
function fixturePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const landscape = w > h;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      let rgb = [40, 70, 160];
      const edge = landscape ? x < w * 0.2 : h > w && y < h * 0.2;
      if (edge) rgb = [200, 40, 40];
      const cx = Math.abs(x - w / 2) < Math.min(w, h) * 0.1;
      const cy = Math.abs(y - h / 2) < Math.min(w, h) * 0.1;
      if (cx && cy) rgb = [255, 255, 255];
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SHAPES = {
  square: fixturePng(400, 400),
  portrait: fixturePng(300, 600),
  landscape: fixturePng(800, 300),
} as const;
type Shape = keyof typeof SHAPES;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

function track(coverUrl: string | null) {
  return {
    id: 'e2e-hero-cover-track',
    user_id: 'local-user',
    title: 'HERO COVER FIXTURE',
    type: 'beat',
    audio_url: null,
    peaks_url: null,
    cover_url: coverUrl,
    duration_seconds: 120,
    bpm: 140,
    key: 'F',
    scale: 'minor',
    rating: null,
    created_at: '2026-09-01T00:00:00.000Z',
    track_tags: [],
  };
}

/**
 * Serve one fixture track. `optimized` covers are a same-origin path, which
 * CoverImage hands to next/image; the rest are a data: URL, which it renders
 * as a plain <img>. Those are the two branches that each broke.
 */
async function stubLibrary(page: Page, shape: Shape | null, optimized: boolean) {
  const png = shape ? SHAPES[shape] : null;
  const coverUrl = !png
    ? null
    : optimized
      ? `/e2e-hero-cover-${shape}.png`
      : `data:image/png;base64,${png.toString('base64')}`;

  await page.route(/\/api\/tracks\?/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tracks: [track(coverUrl)], pageInfo: { hasMore: false, nextCursor: null } }),
    }),
  );
  if (png) {
    await page.route(/\/_next\/image\?/, (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    );
  }
}

async function openLibrary(page: Page) {
  await page.goto('/library');
  test.skip(
    new URL(page.url()).pathname.startsWith('/login'),
    '/library is auth-gated here; run against local-store dev with no Supabase env',
  );
  const tile = page.getByTestId('library-hero-cover');
  await expect(tile).toBeVisible();
  return tile;
}

for (const vp of VIEWPORTS) {
  test.describe(`Library hero cover @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const optimized of [true, false]) {
      for (const shape of Object.keys(SHAPES) as Shape[]) {
        const branch = optimized ? 'next/image' : 'plain img';
        test(`${shape} cover (${branch}) fills the tile with a centred crop`, async ({ page }) => {
          await stubLibrary(page, shape, optimized);
          const tile = await openLibrary(page);

          const img = tile.locator('img').first();
          await expect(img).toBeVisible();
          await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

          const t = (await tile.boundingBox())!;
          const i = (await img.boundingBox())!;
          // The image box is exactly the tile: not the hero row, not the
          // picture's natural size. 1px tolerance for the tile's border.
          expect(Math.abs(i.x - t.x)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(i.y - t.y)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(i.width - t.width)).toBeLessThanOrEqual(3);
          expect(Math.abs(i.height - t.height)).toBeLessThanOrEqual(3);

          const fit = await img.evaluate((el) => {
            const s = getComputedStyle(el);
            return { objectFit: s.objectFit, objectPosition: s.objectPosition };
          });
          expect(fit.objectFit).toBe('cover');
          expect(fit.objectPosition).toBe('50% 50%');

          // The title must not be painted over.
          const h1 = page.getByRole('heading', { level: 1, name: 'Home' });
          const hb = (await h1.boundingBox())!;
          const topAtTitle = await page.evaluate(
            ([x, y]) => document.elementFromPoint(x, y)?.closest('h1') !== null,
            [hb.x + Math.min(hb.width / 2, 20), hb.y + hb.height / 2],
          );
          expect(topAtTitle).toBe(true);

          await page.screenshot({
            path: test.info().outputPath(`hero-${vp.name}-${shape}-${optimized ? 'optimized' : 'plain'}.png`),
            clip: { x: 0, y: Math.max(0, t.y - 40), width: vp.width, height: t.height + 80 },
          });
        });
      }
    }

    test('missing cover falls back to generated artwork that fills the tile', async ({ page }) => {
      await stubLibrary(page, null, false);
      const tile = await openLibrary(page);

      await expect(tile.locator('img[src^="/e2e-hero-cover"], img[src^="data:"]')).toHaveCount(0);
      const fallback = tile.locator('[role="presentation"]').first();
      await expect(fallback).toBeVisible();
      const t = (await tile.boundingBox())!;
      const f = (await fallback.boundingBox())!;
      expect(Math.abs(f.width - t.width)).toBeLessThanOrEqual(3);
      expect(Math.abs(f.height - t.height)).toBeLessThanOrEqual(3);
      const painted = await fallback.evaluate((el) => {
        const s = getComputedStyle(el);
        return s.backgroundImage !== 'none' || el.querySelector('img') !== null;
      });
      expect(painted).toBe(true);

      await page.screenshot({
        path: test.info().outputPath(`hero-${vp.name}-missing.png`),
        clip: { x: 0, y: Math.max(0, t.y - 40), width: vp.width, height: t.height + 80 },
      });
    });
  });
}
