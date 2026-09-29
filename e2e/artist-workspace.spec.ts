/**
 * Artist Relationship Workspace, end to end, against a REAL database.
 *
 * Unlike the stubbed specs, this drives the real routes over real Postgres +
 * PostgREST with row-level security on (scripts/local-db), so every write the
 * UI makes is actually applied and read back. It covers the plan's flows:
 *
 *   1. start a workspace → new project → add beats → Share with the artist
 *   2. the artist opens the one permanent link, plays, taps Interested
 *   3. the producer sees it (workspace, bell, project row), moves decisions
 *   4. a beat added later is NEW in the portal and counted by Notify
 *   5. song → beat, the track drawer's People, downloads, revoke
 *   6. a signed-in buyer cannot reach the producer routes
 *
 * Skipped unless E2E_REAL_DB=1 (set by scripts/local-db/env.sh). Run:
 *   bash scripts/local-db/reset.sh && bash scripts/local-db/up.sh
 *   source scripts/local-db/env.sh && npm run dev -- -p 3457   # other shell
 *   E2E_REAL_DB=1 npx playwright test e2e/artist-workspace.spec.ts
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);

const ids = {
  artist: randomUUID(),
  midnight: randomUUID(),
  nightDrive: randomUUID(),
  dawn: randomUUID(),
  demo: randomUUID(),
};
const artistName = `Artist ${run}`;
const projectName = `Summer EP ${run}`;

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

async function rest(request: APIRequestContext, method: string, table: string, body?: unknown, query = '') {
  const res = await request.fetch(`${REST}/${table}${query}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${table}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

function wav(freq: number): Buffer {
  const rate = 22050;
  const n = rate * 3;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  return buf;
}

async function asProducer(page: Page, baseURL: string) {
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  await page.context().addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

async function lastEmail(request: APIRequestContext, to: string) {
  const all = (await (await request.get(RESEND)).json()) as Array<{ body: { to: string; subject: string; text: string } }>;
  return all.filter((e) => e.body.to === to).at(-1)?.body ?? null;
}

let projectId = '';
let portalUrl = '';

test.beforeAll(async ({ request }) => {
  const dir = path.join(process.cwd(), 'public/uploads/e2e-local-db');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, f] of [['midnight', 220], ['night-drive', 262], ['dawn', 330], ['demo', 196]] as const) {
    fs.writeFileSync(path.join(dir, `${name}.wav`), wav(f));
  }
  await rest(request, 'POST', 'contacts', { id: ids.artist, user_id: PRODUCER_ID, name: artistName, email: `artist-${run}@local.test`, genre: 'Trap', city: 'Paris' });
  const track = (id: string, title: string, file: string, type = 'beat') => ({
    id, user_id: PRODUCER_ID, title, type, audio_url: `/uploads/e2e-local-db/${file}.wav`, wav_url: `/uploads/e2e-local-db/${file}.wav`, bpm: 140, key: 'F', scale: 'minor', duration_seconds: 3,
  });
  await rest(request, 'POST', 'tracks', [
    track(ids.midnight, `MIDNIGHT ${run}`, 'midnight'),
    track(ids.nightDrive, `NIGHT DRIVE ${run}`, 'night-drive'),
    track(ids.dawn, `DAWN ${run}`, 'dawn'),
    track(ids.demo, `MIDNIGHT VOCAL ${run}`, 'demo', 'song'),
  ]);
});

test('1 · start a workspace, add beats, share with the artist', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.artist}`);
  await page.getByRole('button', { name: 'Start workspace' }).click();
  await page.getByPlaceholder(`${artistName} — New project`).fill(projectName);
  await page.getByRole('button', { name: `New project for ${artistName}` }).click();
  await expect(page.getByTestId('artist-workspace')).toBeVisible();
  await expect(page.getByTestId('relationship-stage')).toHaveText('Working together');

  const [project] = await rest(page.request, 'GET', 'projects', undefined, `?name=eq.${encodeURIComponent(projectName)}&select=id`);
  projectId = project.id;
  const add = await page.request.post(`/api/projects/${projectId}/tracks`, { data: { track_ids: [ids.midnight, ids.nightDrive] } });
  expect(add.ok()).toBeTruthy();

  await page.goto(`/contacts/${ids.artist}?tab=projects`);
  await page.getByRole('button', { name: `Share with ${artistName}` }).click();
  await expect(page.getByRole('switch', { name: 'In portal' })).toHaveAttribute('aria-checked', 'true');

  const invite = await lastEmail(page.request, `artist-${run}@local.test`);
  expect(invite?.subject).toContain(projectName);
  portalUrl = invite!.text.match(/https?:\/\/\S+\/artist\/[A-Za-z0-9_-]+/)![0];
});

test('2 · the artist opens the portal, plays a beat and taps Interested', async ({ browser }) => {
  const artist = await browser.newPage();
  await artist.goto(portalUrl);
  const row = (t: string) => artist.locator('li', { hasText: t });
  await expect(row(`MIDNIGHT ${run}`)).toContainText('New');
  await expect(row(`NIGHT DRIVE ${run}`)).toContainText('New');
  await expect(artist.getByText(`DAWN ${run}`)).toHaveCount(0);

  const played = artist.waitForRequest((r) => r.url().includes('/play') && r.method() === 'POST');
  await row(`MIDNIGHT ${run}`).getByRole('button', { name: `Play MIDNIGHT ${run}` }).click();
  await played;

  await row(`MIDNIGHT ${run}`).getByRole('button', { name: /Interested/ }).click();
  await expect(row(`MIDNIGHT ${run}`).getByRole('button', { name: /Interested/ })).toHaveAttribute('aria-pressed', 'true');
  await artist.close();
});

test('3 · the producer sees it, and moves decisions', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.artist}?tab=beats`);
  const mid = page.getByTestId(`ws-beat-${ids.midnight}`);
  await expect(mid.getByRole('button', { name: `Decision for MIDNIGHT ${run}` })).toContainText('Interested');
  await expect(mid).toContainText('Played');

  await page.getByTestId(`ws-beat-${ids.nightDrive}`).getByRole('button', { name: `Decision for NIGHT DRIVE ${run}` }).click();
  await page.getByRole('option', { name: 'Selected' }).click();
  await expect(page.getByTestId(`ws-beat-${ids.nightDrive}`).getByRole('button', { name: `Decision for NIGHT DRIVE ${run}` })).toContainText('Selected');

  const notes = await (await page.request.get('/api/notifications')).json();
  expect(notes.notifications.some((n: { kind: string; title: string }) => n.kind === 'artist_reaction' && n.title === `${artistName} is interested in MIDNIGHT ${run}`)).toBeTruthy();

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByTestId('project-artists-strip')).toContainText(artistName);
  await expect(page.getByTestId('track-decision-pills').first()).toContainText(`${artistName} · `);
});

test('4 · a beat added later is NEW in the portal and counted by Notify', async ({ page, baseURL, browser }) => {
  // Move the story back in time: project linked and beats added two hours
  // ago, the artist's last visit one hour ago. Then add a beat "now".
  const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  await rest(page.request, 'PATCH', 'project_contacts', { created_at: twoHoursAgo }, `?project_id=eq.${projectId}`);
  await rest(page.request, 'PATCH', 'project_tracks', { added_at: twoHoursAgo }, `?project_id=eq.${projectId}`);
  await rest(page.request, 'PATCH', 'artist_portals', { last_viewed_at: hourAgo, previous_viewed_at: twoHoursAgo }, `?contact_id=eq.${ids.artist}`);

  await asProducer(page, baseURL!);
  expect((await page.request.post(`/api/projects/${projectId}/tracks`, { data: { track_ids: [ids.dawn] } })).ok()).toBeTruthy();
  await page.goto(`/contacts/${ids.artist}`);
  const notify = page.getByRole('button', { name: /Notify · 1 new/ });
  await expect(notify).toBeEnabled();
  await notify.click();
  await expect(page.getByRole('button', { name: /^Notify$/ })).toBeDisabled();
  const digest = await lastEmail(page.request, `artist-${run}@local.test`);
  expect(digest?.text).toContain(`DAWN ${run}`);
  expect(digest?.text).toContain(portalUrl);

  const artist = await browser.newPage();
  await artist.goto(portalUrl);
  await expect(artist.locator('li', { hasText: `DAWN ${run}` })).toContainText('New');
  await expect(artist.locator('li', { hasText: `MIDNIGHT ${run}` })).not.toContainText('New');
  await artist.close();
});

test('5 · song built on a beat, People in the drawer, downloads, revoke', async ({ page, baseURL, browser }) => {
  await asProducer(page, baseURL!);
  expect((await page.request.post(`/api/projects/${projectId}/tracks`, { data: { track_ids: [ids.demo] } })).ok()).toBeTruthy();

  await page.goto(`/contacts/${ids.artist}?tab=songs`);
  await page.getByRole('button', { name: `Beat MIDNIGHT VOCAL ${run} is built on` }).click();
  await page.getByRole('option', { name: `MIDNIGHT ${run}`, exact: true }).click();
  await expect(page.getByTestId(`ws-song-${ids.demo}`)).toContainText(`Built on MIDNIGHT ${run}`);

  await page.goto(`/projects/${projectId}`);
  const row = page.locator('div', { hasText: `MIDNIGHT ${run}` }).filter({ has: page.getByRole('button', { name: 'Track actions' }) }).last();
  await row.getByRole('button', { name: 'Track actions' }).first().click();
  await page.getByRole('menuitem', { name: /View details/ }).click();
  const people = page.getByTestId('track-people');
  await expect(people).toContainText(artistName);
  await expect(people).toContainText(projectName);
  await expect(people).toContainText('Interested');
  await expect(people).toContainText(`MIDNIGHT VOCAL ${run}`);
  await page.keyboard.press('Escape');

  await page.goto(`/contacts/${ids.artist}?tab=projects`);
  await page.getByRole('switch', { name: 'Downloads' }).click();
  await expect(page.getByRole('switch', { name: 'Downloads' })).toHaveAttribute('aria-checked', 'true');

  const artist = await browser.newPage();
  await artist.goto(portalUrl);
  const download = artist.waitForEvent('download');
  await artist.getByRole('button', { name: `Download MIDNIGHT ${run}` }).click();
  expect((await download).suggestedFilename()).toBe(`MIDNIGHT ${run}.wav`);

  await page.getByRole('button', { name: 'Portal actions' }).click();
  await page.getByRole('menuitem', { name: /Revoke portal/ }).click();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Portal revoked', { exact: true }).first()).toBeVisible();

  await artist.reload();
  await expect(artist.getByText('This link is no longer active. Ask for a new one.')).toBeVisible();
  await artist.close();
});

test('6 · a signed-in buyer cannot reach the producer routes', async ({ playwright, baseURL }) => {
  const c = sessionCookie(BUYER_ID, 'buyer@local.test');
  const buyer = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `${c.name}=${c.value}` } });
  expect((await buyer.get(`/api/contacts/${ids.artist}/workspace`)).status()).toBe(403);
  expect((await buyer.put(`/api/contacts/${ids.artist}/decisions`, { data: { track_ids: [ids.midnight], decision: 'released' } })).status()).toBe(403);
  expect((await buyer.post(`/api/projects/${projectId}/contacts`, { data: { contact_id: ids.artist } })).status()).toBe(403);
  // The portal API is public-by-token: a buyer session is neither needed nor a key.
  const token = portalUrl.split('/artist/')[1];
  expect((await buyer.get(`/api/portal/${token}`)).status()).toBe(410);
  await buyer.dispose();
});
