import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * Duplicate-send notice in the send flow (SHARE-08). The APIs are stubbed, so
 * this needs no database: it drives the real SendBeatModal from the campaign
 * page (the bulk surface) and checks the heads-up, "Remove these tracks",
 * "Skip recipients who have them", and that the send itself is never blocked.
 *
 * `SHARE08_SHOTS=<dir>` also writes the review screenshots there.
 */
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day).toISOString();
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';

const track = (id: string, title: string, bpm: number) => ({
  id, title, type: 'beat', bpm, key: 'F', scale: 'minor', cover_url: null, status: 'finished',
  duration_seconds: 150, created_at: ago(20), track_tags: [],
});
const TRACKS = [track('t1', 'Night Shift', 140), track('t2', 'Cold Front', 92), track('t3', 'Late Add', 128)];

const NAMES = ['Nova', 'Kai', 'Rio', 'Sage', 'Wren'];
const targets = NAMES.map((name, i) => ({
  id: `tg${i}`, contact_id: `ct${i}`, status: 'sent', last_nudge_at: null, nudge_count: 0, created_at: ago(30),
  contact: { id: `ct${i}`, name, email: `${name.toLowerCase()}@example.com`, role: 'artist' },
  sends_count: 0, last_sent_at: null,
}));

// Review screenshots: SHARE08_W=390 renders the phone layout at 2x.
if (process.env.SHARE08_W) test.use({ viewport: { width: Number(process.env.SHARE08_W), height: 900 }, deviceScaleFactor: 2 });

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });

async function setup(page: Page, nTargets: number, duplicates: unknown[]) {
  const sent: unknown[] = [];
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === `/api/campaigns/${CAMPAIGN}`) {
      return route.fulfill({ json: { campaign: { id: CAMPAIGN, name: 'November outreach', description: null, nudge_after_days: null, created_at: ago(30) }, targets: targets.slice(0, nTargets) } });
    }
    if (p === '/api/beat_sends/duplicates') return route.fulfill({ json: { duplicates } });
    if (p === '/api/tracks') return route.fulfill({ json: TRACKS });
    if (p === '/api/projects') return route.fulfill({ json: { projects: [] } });
    if (p === '/api/campaigns') return route.fulfill({ json: { campaigns: [{ id: CAMPAIGN, name: 'November outreach' }] } });
    if (p === '/api/share') { sent.push(route.request().postDataJSON()); return route.fulfill({ json: { token: `tok${sent.length}` } }); }
    if (p === '/api/email') return route.fulfill({ json: { success: true } });
    if (/^\/api\/campaigns\/.+\/targets$/.test(p)) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/campaigns/${CAMPAIGN}`);
  await page.getByRole('button', { name: /Send beats/ }).click();
  await page.getByText('Night Shift', { exact: true }).first().click();
  await page.getByText('Cold Front', { exact: true }).first().click();
  return sent;
}

const dup = (key: string, titles: string[], over: Record<string, unknown> = {}) => ({
  key, tracks: titles.map((t) => ({ id: t === 'Night Shift' ? 't1' : 't2', title: t })),
  last_sent_at: ago(3), email_opened: true, link_clicked: false, activity: { opens: 1, plays: 2, downloads: 0 }, ...over,
});

test.beforeEach(async ({ context, baseURL }) => {
  if (stub) await context.addCookies([signInCookie(baseURL!)]);
});

async function shot(page: Page, name: string) {
  const dir = process.env.SHARE08_SHOTS;
  if (dir) await page.getByLabel('Already sent').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test('single send: the heads-up shows, Send stays on, Remove drops the tracks', async ({ page }) => {
  const sent = await setup(page, 1, [dup('ct0', ['Night Shift'])]);
  const notice = page.getByLabel('Already sent');
  await expect(notice).toContainText('Already sent to Nova: Night Shift');
  await expect(notice).toContainText('3 days ago · opened · played 2×');
  await expect(page.getByRole('button', { name: /Send to Nova/ })).toBeEnabled();
  await shot(page, `single-${page.viewportSize()?.width}`);

  await page.getByRole('button', { name: 'Remove these tracks' }).click();
  await expect(notice).toContainText('Leaving Night Shift out for Nova');
  await page.getByRole('button', { name: /Send to Nova/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { track_ids: string[] }).track_ids).toEqual(['t2']);
});

test('bulk: 2 of 5 duplicated, Skip recipients who have them sends to the other 3', async ({ page }) => {
  const sent = await setup(page, 5, [dup('ct0', ['Night Shift']), dup('ct2', ['Night Shift', 'Cold Front'], { last_sent_at: ago(40), email_opened: false, activity: null })]);
  const notice = page.getByLabel('Already sent');
  await expect(notice).toContainText('Already sent to Nova');
  await expect(notice).toContainText('Already sent to Rio');
  await expect(page.getByRole('button', { name: /Send to 5 contacts/ })).toBeEnabled();
  await shot(page, `bulk-${page.viewportSize()?.width}`);

  await page.getByRole('button', { name: 'Skip recipients who have them' }).click();
  await expect(page.getByRole('button', { name: /Send to 3 contacts/ })).toBeEnabled();
  await page.getByRole('button', { name: /Send to 3 contacts/ }).click();
  await expect.poll(() => sent.length).toBe(3);
});
