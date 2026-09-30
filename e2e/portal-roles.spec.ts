/**
 * Portals shaped by role (step 3, mig 135) end to end against a REAL database
 * (scripts/local-db). One portal link per contact, as before; its shape
 * follows the contact's MAIN role:
 *
 *   1. producer — loops first, "Loops & beats", Ask for stems → a request the
 *      producer sees in the workspace
 *   2. label — "Packs", toplines first, the pitch written in the workspace
 *      shows on the pack in the portal
 *   3. an artist's portal is unchanged
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);
const ids = {
  producer: randomUUID(), label: randomUUID(), artist: randomUUID(),
  beat: randomUUID(), loop: randomUUID(), topline: randomUUID(), song: randomUUID(),
};
const portals: Record<'producer' | 'label' | 'artist', string> = { producer: '', label: '', artist: '' };
const projects: Record<'producer' | 'label' | 'artist', string> = { producer: '', label: '', artist: '' };

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

async function asProducer(page: Page, baseURL: string) {
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  await page.context().addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

test.beforeAll(async ({ request, baseURL }) => {
  const dir = path.join(process.cwd(), 'public/uploads/e2e-local-db');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pr-audio.wav'), Buffer.from(`pr-${run}`));
  await rest(request, 'POST', 'contacts', [
    { id: ids.producer, user_id: PRODUCER_ID, name: `Kofi ${run}`, email: `pr-prod-${run}@local.test`, category: 'Producer' },
    { id: ids.label, user_id: PRODUCER_ID, name: `Ada AR ${run}`, email: `pr-label-${run}@local.test`, category: 'A&R' },
    { id: ids.artist, user_id: PRODUCER_ID, name: `Nova ${run}`, email: `pr-artist-${run}@local.test`, category: 'Artist' },
  ]);
  const t = (id: string, title: string, type: string, extra: Record<string, unknown> = {}) => ({
    id, user_id: PRODUCER_ID, title: `${title} ${run}`, type, audio_url: '/uploads/e2e-local-db/pr-audio.wav', duration_seconds: 3, stems_status: null, ...extra,
  });
  await rest(request, 'POST', 'tracks', [
    t(ids.beat, 'GLASS BEAT', 'beat'),
    t(ids.loop, 'GLASS LOOP', 'loop', { stems_status: 'done' }),
    t(ids.topline, 'GLASS TOPLINE', 'topline'),
    t(ids.song, 'GLASS SONG', 'song'),
  ]);
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  const headers = { cookie: `${c.name}=${c.value}` };
  for (const who of ['producer', 'label', 'artist'] as const) {
    const [project] = await rest(request, 'POST', 'projects', { user_id: PRODUCER_ID, name: `Glass ${who} ${run}` });
    projects[who] = project.id;
    // Beat first in project order: every shape below reorders from this.
    await rest(request, 'POST', 'project_tracks', [ids.beat, ids.loop, ids.topline, ids.song].map((track_id, position) => ({ project_id: project.id, track_id, position })));
    expect((await request.post(`${baseURL}/api/projects/${project.id}/contacts`, { headers, data: { contact_id: ids[who] } })).ok()).toBeTruthy();
    const share = await request.post(`${baseURL}/api/projects/${project.id}/contacts/${ids[who]}/share`, { headers, data: {} });
    expect(share.ok(), await share.text()).toBeTruthy();
    const all = (await (await request.get(RESEND)).json()) as Array<{ body: { to: string; text: string } }>;
    const invite = all.filter((e) => e.body.to === `pr-${who === 'producer' ? 'prod' : who}-${run}@local.test`).at(-1)!;
    portals[who] = invite.body.text.match(/https?:\/\/\S+\/artist\/[A-Za-z0-9_-]+/)![0];
  }
});

const rowOrder = (page: Page) => page.locator('li[data-track-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-track-id')));

test('1 · a producer’s portal: loops first, and stems one request away', async ({ page, baseURL, browser }) => {
  const portal = await browser.newPage();
  await portal.goto(portals.producer);
  await expect(portal.getByTestId('portal-tagline')).toContainText('Loops and beats to build on');
  await expect(portal.getByRole('tab', { name: 'Loops & beats' })).toBeVisible();
  expect(await rowOrder(portal)).toEqual([ids.loop, ids.beat, ids.topline]);

  const loopRow = portal.locator(`li[data-track-id="${ids.loop}"]`);
  const asked = portal.waitForResponse((r) => r.url().includes('/messages') && r.request().method() === 'POST');
  await loopRow.getByRole('button', { name: /Stems ready · ask/ }).click();
  expect((await asked).status()).toBe(201);
  await expect(portal.getByRole('status').filter({ hasText: 'Asked' })).toContainText(`GLASS LOOP ${run}`);
  await portal.close();

  // The producer sees it as an open request in the workspace.
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.producer}?tab=messages`);
  await expect(page.getByTestId('open-request')).toContainText(`Could I get the stems for “GLASS LOOP ${run}”?`);
  await page.goto(`/contacts/${ids.producer}?tab=projects`);
  await expect(page.getByTestId('portal-shape-note')).toContainText('producer portal');
});

test('2 · a label’s portal: packs, toplines first, and the pitch written for them', async ({ page, baseURL, browser }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.label}?tab=projects`);
  const pitch = page.getByTestId(`ws-pitch-${projects.label}`);
  await pitch.getByRole('button', { name: /Pitch for/ }).click();
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${projects.label}/contacts/${ids.label}`) && r.request().method() === 'PATCH');
  await pitch.getByRole('textbox').fill('Two toplines for the summer single. Hooks written, open to a feature.');
  await pitch.getByRole('textbox').press('Control+Enter');
  expect((await saved).ok()).toBeTruthy();

  const portal = await browser.newPage();
  await portal.goto(portals.label);
  await expect(portal.getByRole('heading', { name: 'Packs' })).toBeVisible();
  await expect(portal.getByRole('tab', { name: 'Toplines & beats' })).toBeVisible();
  expect(await rowOrder(portal)).toEqual([ids.topline, ids.beat, ids.loop]);
  await portal.getByRole('button', { name: new RegExp(`Glass label ${run}`) }).click();
  await expect(portal.getByTestId('portal-pitch')).toContainText('Two toplines for the summer single.');
  await expect(portal.getByRole('button', { name: /Ask for stems|Stems ready/ })).toHaveCount(0);
  await portal.close();
});

test('3 · an artist’s portal is the portal it always was', async ({ browser }) => {
  const portal = await browser.newPage();
  await portal.goto(portals.artist);
  await expect(portal.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(portal.getByRole('tab', { name: 'Beats', exact: true })).toBeVisible();
  expect(await rowOrder(portal)).toEqual([ids.beat, ids.topline, ids.loop]);
  await expect(portal.getByTestId('portal-pitch')).toHaveCount(0);
  await expect(portal.getByRole('button', { name: /Ask for stems|Stems ready/ })).toHaveCount(0);
  await portal.close();
});
