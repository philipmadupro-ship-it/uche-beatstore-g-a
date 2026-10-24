/**
 * Go-live order safety: the code on this branch must not 500 whether or not
 * the Label OS migrations are applied, and with LABEL_OS_ENABLED on or off.
 * Run against the three database states of the go-live
 * (docs/bstudio-label-os/go-live.md) and either flag value:
 *
 *   - production today: migrations 001-129 only (seed-production-state.sql),
 *   - after the bundle: every migration applied,
 *
 * The producer dashboard, the public storefront, the buyer account, share
 * pages and the artist portal are each opened and every response they cause
 * must be below 500 (a missing Label OS table must degrade, never throw). The
 * spec asserts nothing about Label OS itself except that, with the flag off,
 * its pages and routes answer 404 rather than 500.
 *
 * Needs the real-database stack and the seeded producer (fixed ids from
 * scripts/local-db/seed-production-state.sql). Skipped unless E2E_REAL_DB=1 and
 * E2E_GO_LIVE=1. Run: `E2E_REAL_DB=1 E2E_GO_LIVE=1 npx playwright test e2e/go-live-order-safety.spec.ts`
 * (set E2E_LABEL_OS=off when the dev server runs with LABEL_OS_ENABLED unset).
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

test.skip(process.env.E2E_REAL_DB !== '1' || process.env.E2E_GO_LIVE !== '1', 'needs the local stack + production-state seed');
test.setTimeout(240_000);

const TRACK = '0b0e1a57-0000-4000-8000-00000000a001';
const TRACK_2 = '0b0e1a57-0000-4000-8000-00000000a002';
const PROJECT = '0b0e1a57-0000-4000-8000-00000000b001';
const PLAYLIST = '0b0e1a57-0000-4000-8000-00000000c001';
const CONTACT = '0b0e1a57-0000-4000-8000-00000000d001';
const labelOsOff = process.env.E2E_LABEL_OS === 'off';

const PRODUCER_PAGES = [
  '/library', `/library?view=all`, '/projects', `/projects/${PROJECT}`, '/playlists', `/playlists/${PLAYLIST}`,
  '/contacts', `/contacts/${CONTACT}`, '/campaigns', '/calendar', '/links', '/store-editor', '/sales', '/analytics',
  '/settings', '/profile', '/studio', '/offline', '/cover-art',
];
const PRODUCER_APIS = [
  '/api/whoami', '/api/tracks', `/api/tracks/${TRACK}`, '/api/projects', `/api/projects/${PROJECT}`, '/api/playlists',
  '/api/contacts', '/api/contacts/artists', '/api/contacts/roles?group=artist', `/api/contacts/${CONTACT}/workspace`,
  '/api/notifications', '/api/activity', '/api/sales', '/api/analytics', '/api/links', '/api/profile', '/api/licenses',
  '/api/promo-codes', '/api/beat_sends', '/api/campaigns', '/api/calendar', '/api/search?q=night', '/api/store-summary',
  '/api/tracks/store-summary',
];
const STORE_PAGES = [
  '/store', `/store/${TRACK}`, `/store/${TRACK_2}`, `/store/projects/${PROJECT}`, '/store/producer/uche', '/store/checkout',
  `/store/checkout?project_id=${PROJECT}`, '/store/account', '/store/orders', '/store/privacy', `/store/playlists/${PLAYLIST}`,
  '/store/download?session_id=cs_test_rehearsal_1', '/store/projects/access/access-token-rehearsal',
];
const STORE_APIS = [
  '/api/store', `/api/store/${TRACK}`, '/api/store/facets', '/api/store/drops', '/api/store/momentum',
  `/api/store/projects/${PROJECT}`, '/api/store/producer/uche', `/api/store/playlists/${PLAYLIST}`,
  '/api/store/projects/access/access-token-rehearsal',
];
const PUBLIC_PAGES = ['/share/share-token-rehearsal', '/artist/portal-token-rehearsal', '/login'];
const BUYER_PAGES = ['/store/account/me'];
const BUYER_APIS = ['/api/store/me', '/api/store/account/me'];

type Hit = { url: string; status: number };

/** Opens every path and collects EVERY failure, so one run lists them all. */
async function visitAll(page: Page, paths: string[]) {
  const bad: Hit[] = [];
  const problems: string[] = [];
  let current = '';
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 500 && (u.includes('/api/') || r.request().resourceType() === 'document')) bad.push({ url: `${current} → ${u}`, status: r.status() });
  });
  for (const p of paths) {
    current = p;
    const res = await page.goto(p, { waitUntil: 'domcontentloaded' }).catch((e: Error) => { problems.push(`${p}: ${e.message.split('\n')[0]}`); return null; });
    if (!res) continue;
    if (res.status() >= 500) problems.push(`${p}: document ${res.status()}`);
    // Let the page's own data calls run so a failing one shows up in `bad`.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    const text = (await page.locator('body').innerText().catch(() => '')) ?? '';
    if (/Application error|Internal Server Error|server-side exception/i.test(text)) problems.push(`${p}: shows an application error`);
  }
  expect([...problems, ...bad.map((b) => `${b.status} ${b.url}`)], 'pages that failed or caused a 5xx').toEqual([]);
}

async function callAll(ctx: BrowserContext, paths: string[]) {
  const failures: string[] = [];
  for (const p of paths) {
    const res = await ctx.request.get(p, { failOnStatusCode: false });
    if (res.status() >= 500) failures.push(`${p} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  }
  expect(failures, 'GET routes that answered 5xx').toEqual([]);
}

async function signedIn(browser: import('@playwright/test').Browser, baseURL: string, id: string, email: string, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`go-live order safety @${viewport.width}`, () => {
    test('the producer dashboard opens without a 5xx', async ({ browser, baseURL }) => {
      const ctx = await signedIn(browser, baseURL!, PRODUCER_ID, 'producer@local.test', viewport);
      await visitAll(await ctx.newPage(), PRODUCER_PAGES);
      if (viewport.width === 1440) await callAll(ctx, PRODUCER_APIS);
      await ctx.close();
    });

    test('the public storefront, share pages and portal open without a 5xx', async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ viewport });
      await visitAll(await ctx.newPage(), [...STORE_PAGES, ...PUBLIC_PAGES]);
      if (viewport.width === 1440) await callAll(ctx, STORE_APIS);
      await ctx.close();
      void baseURL;
    });

    test('the buyer account opens without a 5xx', async ({ browser, baseURL }) => {
      const ctx = await signedIn(browser, baseURL!, BUYER_ID, 'buyer@local.test', viewport);
      await visitAll(await ctx.newPage(), BUYER_PAGES);
      if (viewport.width === 1440) await callAll(ctx, BUYER_APIS);
      await ctx.close();
    });
  });
}

test('the producer can still write: projects, playlists, contacts, tracks, profile', async ({ browser, baseURL }) => {
  const ctx = await signedIn(browser, baseURL!, PRODUCER_ID, 'producer@local.test', { width: 1440, height: 900 });
  const api = ctx.request;
  const json = (data: unknown) => ({ data: JSON.stringify(data), headers: { 'content-type': 'application/json' }, failOnStatusCode: false });
  const failures: string[] = [];
  const check = async (label: string, res: import('@playwright/test').APIResponse, ok = [200, 201]) => {
    if (res.status() >= 500 || !ok.includes(res.status())) failures.push(`${label} → ${res.status()} ${(await res.text()).slice(0, 160)}`);
  };

  const created = await api.post('/api/projects', json({ name: 'Go-live check' }));
  await check('POST /api/projects', created);
  const projectId = (await created.json().catch(() => ({})))?.project?.id as string | undefined;
  if (projectId) {
    await check('PATCH /api/projects/:id', await api.patch(`/api/projects/${projectId}`, json({ name: 'Go-live check 2' })));
    await check('GET /api/projects/:id', await api.get(`/api/projects/${projectId}`, { failOnStatusCode: false }));
    await check('DELETE /api/projects/:id', await api.delete(`/api/projects/${projectId}`, { failOnStatusCode: false }));
  }
  const playlist = await api.post('/api/playlists', json({ name: 'Go-live list' }));
  await check('POST /api/playlists', playlist);
  await check('PATCH /api/tracks/:id', await api.patch(`/api/tracks/${TRACK_2}`, json({ rating: 5 })));
  await check('POST /api/contacts', await api.post('/api/contacts', json({ name: 'Go-live contact', email: 'golive@contact.test' })));
  await check('POST /api/profile', await api.post('/api/profile', json({ display_name: 'UCHE' })));
  await check('GET /api/tracks (after writes)', await api.get('/api/tracks', { failOnStatusCode: false }));
  expect(failures, 'producer writes that failed').toEqual([]);
  await ctx.close();
});

test('a buyer can still favourite a beat and make an offer', async ({ browser, baseURL }) => {
  const ctx = await signedIn(browser, baseURL!, BUYER_ID, 'buyer@local.test', { width: 1440, height: 900 });
  const api = ctx.request;
  const json = (data: unknown) => ({ data: JSON.stringify(data), headers: { 'content-type': 'application/json' }, failOnStatusCode: false });
  const failures: string[] = [];
  for (const [label, res] of [
    ['POST /api/store/me set_favorite', await api.post('/api/store/me', json({ action: 'set_favorite', track_id: TRACK, favorited: true }))],
    ['POST /api/store/offer', await api.post('/api/store/offer', json({ track_id: TRACK_2, buyer_email: 'buyer@local.test', offered_price_usd: 20, message: 'hi' }))],
    ['GET /api/store/me', await api.get('/api/store/me', { failOnStatusCode: false })],
  ] as const) {
    if (res.status() >= 500) failures.push(`${label} → ${res.status()} ${(await res.text()).slice(0, 160)}`);
  }
  expect(failures, 'buyer calls that answered 5xx').toEqual([]);
  await ctx.close();
});

test('with Label OS off its pages and routes are 404, not 500', async ({ browser, baseURL }) => {
  test.skip(!labelOsOff, 'only when the dev server runs without LABEL_OS_ENABLED (E2E_LABEL_OS=off)');
  const ctx = await signedIn(browser, baseURL!, PRODUCER_ID, 'producer@local.test', { width: 1440, height: 900 });
  const page = await ctx.newPage();
  for (const p of ['/o', '/o/anything', '/setup', '/platform', '/join/abc', '/shared']) {
    const res = await page.goto(p, { waitUntil: 'domcontentloaded' });
    expect(res!.status(), p).toBe(404);
  }
  for (const p of ['/api/org', '/api/platform/licensees']) {
    const res = await ctx.request.get(p, { failOnStatusCode: false });
    expect(res.status(), p).toBe(404);
  }
  await ctx.close();
});
