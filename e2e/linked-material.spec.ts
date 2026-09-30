/**
 * Linked material (migs 132 + 133) end to end against a REAL database
 * (scripts/local-db): loop and topline track types, links in both
 * directions, the one-zip download (unzipped and compared byte for byte),
 * "Share all", and the drawer's Linked panel.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { SERVICE_KEY, PRODUCER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ids = { song: randomUUID(), beat: randomUUID(), inst: randomUUID(), loop: randomUUID(), top: randomUUID(), loop2: randomUUID() };
let projectId = '';

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

const file = (name: string, body: string) => {
  const dir = path.join(process.cwd(), 'public/uploads/e2e-local-db');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
  return `/uploads/e2e-local-db/${name}`;
};

test.beforeAll(async ({ request }) => {
  const t = (id: string, title: string, type: string, body: string) => ({
    id, user_id: PRODUCER_ID, title: `${title} ${run}`, type, audio_url: file(`lm-${id}.wav`, body), duration_seconds: 3,
  });
  // loop and topline are real track types now (mig 133).
  await rest(request, 'POST', 'tracks', [
    t(ids.song, 'VELVET', 'song', `song-bytes-${run}`),
    t(ids.beat, 'VELVET BEAT', 'beat', `beat-bytes-${run}`),
    t(ids.inst, 'VELVET INST', 'instrumental', `inst-bytes-${run}`),
    t(ids.loop, 'KEYS LOOP', 'loop', `loop-bytes-${run}`),
    t(ids.top, 'HOOK TOPLINE', 'topline', `top-bytes-${run}`),
    t(ids.loop2, 'PAD LOOP', 'loop', `pad-bytes-${run}`),
  ]);
  const [project] = await rest(request, 'POST', 'projects', { user_id: PRODUCER_ID, name: `Linked ${run}` });
  projectId = project.id;
  await rest(request, 'POST', 'project_tracks', [{ project_id: projectId, track_id: ids.song, position: 0 }, { project_id: projectId, track_id: ids.beat, position: 1 }]);
});

test('1 · link a song to its beat, instrumental and loops; read it from every side', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  const link = (from: string, track_id: string, relation: string) => page.request.post(`/api/tracks/${from}/links`, { data: { track_id, relation } });
  for (const [from, to, rel] of [[ids.song, ids.beat, 'beat'], [ids.song, ids.inst, 'instrumental'], [ids.song, ids.loop, 'loop'], [ids.beat, ids.top, 'topline'], [ids.beat, ids.loop, 'loop']] as const) {
    const res = await link(from, to, rel);
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const fromSong = (await (await page.request.get(`/api/tracks/${ids.song}/links`)).json()).links;
  expect(fromSong.map((l: { label: string; track: { id: string } }) => [l.label, l.track.id])).toEqual([
    ['Beat', ids.beat], ['Instrumental', ids.inst], ['Loop', ids.loop],
  ]);
  // The "beat" link is the same row the song's Built on uses (song_beats + main beat).
  const [song] = await rest(page.request, 'GET', 'tracks', undefined, `?id=eq.${ids.song}&select=beat_track_id`);
  expect(song.beat_track_id).toBe(ids.beat);

  const fromBeat = (await (await page.request.get(`/api/tracks/${ids.beat}/links`)).json()).links;
  expect(fromBeat.map((l: { label: string }) => l.label)).toEqual(['Topline', 'Loop', 'Song on it']);
  const fromLoop = (await (await page.request.get(`/api/tracks/${ids.loop}/links`)).json()).links;
  expect(fromLoop.map((l: { label: string; track: { id: string } }) => l.label).sort()).toEqual(['Used in', 'Used in']);

  // Relinking a pair changes its relation instead of adding a second row.
  expect((await link(ids.song, ids.inst, 'version')).ok()).toBeTruthy();
  expect((await link(ids.song, ids.inst, 'instrumental')).ok()).toBeTruthy();
  expect(await rest(page.request, 'GET', 'track_links', undefined, `?from_track_id=eq.${ids.song}&to_track_id=eq.${ids.inst}&select=relation`)).toEqual([{ relation: 'instrumental' }]);

  // Refusals: itself, a track that isn't yours, an unknown relation.
  expect((await link(ids.song, ids.song, 'loop')).status()).toBe(400);
  expect((await link(ids.song, randomUUID(), 'loop')).status()).toBe(404);
  expect((await link(ids.song, ids.loop2, 'sample')).status()).toBe(400);
});

test('2 · one zip of the song and everything linked, byte for byte', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  const res = await page.request.get(`/api/tracks/${ids.song}/links/zip`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/zip');
  expect(res.headers()['content-disposition']).toContain(`VELVET ${run} - linked.zip`);
  const files = unzipSync(new Uint8Array(await res.body()));
  expect(Object.keys(files)).toEqual([
    `01 VELVET ${run}.wav`,
    `02 Beat - VELVET BEAT ${run}.wav`,
    `03 Instrumental - VELVET INST ${run}.wav`,
    `04 Loop - KEYS LOOP ${run}.wav`,
    'README.txt',
  ]);
  expect(strFromU8(files[`01 VELVET ${run}.wav`])).toBe(`song-bytes-${run}`);
  expect(strFromU8(files[`04 Loop - KEYS LOOP ${run}.wav`])).toBe(`loop-bytes-${run}`);
  expect(strFromU8(files['README.txt'])).toContain('(Instrumental)');
  // Not for anyone but the owner.
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`${baseURL}/api/tracks/${ids.song}/links/zip`)).status()).toBe(401);
  await anon.close();
});

test('3 · the drawer: link a loop, download all, share all', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/projects/${projectId}`);
  const row = page.locator('div', { hasText: `VELVET ${run}` }).filter({ has: page.getByRole('button', { name: 'Track actions' }) }).last();
  await row.getByRole('button', { name: 'Track actions' }).first().click();
  await page.getByRole('menuitem', { name: /View details/ }).click();

  const panel = page.getByTestId('track-linked');
  await expect(panel.getByTestId('linked-list')).toContainText(`KEYS LOOP ${run}`);
  await panel.getByRole('searchbox', { name: 'Search tracks to link' }).fill(`PAD LOOP ${run}`);
  // The relation is guessed from the type: a loop links as a Loop.
  const pick = panel.getByRole('button', { name: `Link PAD LOOP ${run} as Loop` });
  const linked = page.waitForResponse((r) => r.url().endsWith(`/api/tracks/${ids.song}/links`) && r.request().method() === 'POST');
  await pick.click();
  expect((await linked).ok()).toBeTruthy();
  await expect(panel.getByTestId('linked-list')).toContainText(`PAD LOOP ${run}`);
  await expect(panel.getByTestId('download-linked-zip')).toContainText('Download all (5)');

  const download = page.waitForEvent('download');
  await panel.getByTestId('download-linked-zip').click();
  expect((await download).suggestedFilename()).toBe(`VELVET ${run} - linked.zip`);

  const shared = page.waitForResponse((r) => r.url().endsWith('/api/share') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Share all' }).click();
  const share = await (await shared).json();
  expect(share.url).toMatch(/\/share\//);
  const [row2] = await rest(page.request, 'GET', 'share_links', undefined, `?token=eq.${share.token}&select=track_ids,allow_downloads`);
  expect(new Set(row2.track_ids)).toEqual(new Set([ids.song, ids.beat, ids.inst, ids.loop, ids.loop2]));
  expect(row2.allow_downloads).toBe(true);

  // Unlink from the panel.
  await panel.getByRole('button', { name: `Unlink PAD LOOP ${run}` }).click();
  await expect(panel.getByTestId('linked-list')).not.toContainText(`PAD LOOP ${run}`);
});
