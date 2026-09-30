/**
 * Artist Relationship Workspace, phase 2, end to end against a REAL database
 * (scripts/local-db): every write the UI makes is applied by Postgres +
 * PostgREST with RLS on, and read back.
 *
 *   1. project files — upload on the project page, portal visibility per
 *      file, the artist downloads, the workspace Files tab and Notify see it
 *   2. portal comments — the artist comments on a beat, the producer is
 *      notified and replies from the workspace, the artist sees the reply;
 *      share-link holders never see the thread; comments can be switched off
 *   3. the Artists card view on /contacts
 *   4. ⌘K search — songs labelled with their artist, files, artists
 *   5. a credit linked to a contact, and the contact's photo
 *   6. the daily digest cron — sends once, then is idempotent
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db` (see scripts/local-db).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);

const ids = { artist: randomUUID(), beat: randomUUID(), beat2: randomUUID(), song: randomUUID(), late: randomUUID() };
const artistName = `Phase2 Artist ${run}`;
const artistEmail = `p2-${run}@local.test`;
const projectName = `Phase2 EP ${run}`;

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

async function emailsTo(request: APIRequestContext, to: string) {
  const all = (await (await request.get(RESEND)).json()) as Array<{ body: { to: string; subject: string; text: string } }>;
  return all.filter((e) => e.body.to === to).map((e) => e.body);
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

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let projectId = '';
let portalUrl = '';
let portalToken = '';
const lyricsText = `Verse one for ${run}\nhook hook hook\n`;

test.beforeAll(async ({ request, baseURL }) => {
  const dir = path.join(process.cwd(), 'public/uploads/e2e-local-db');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'p2-beat.wav'), wav(247));
  await rest(request, 'POST', 'contacts', { id: ids.artist, user_id: PRODUCER_ID, name: artistName, email: artistEmail });
  const track = (id: string, title: string, type = 'beat') => ({
    id, user_id: PRODUCER_ID, title, type, audio_url: '/uploads/e2e-local-db/p2-beat.wav', bpm: 90, duration_seconds: 3,
  });
  await rest(request, 'POST', 'tracks', [
    track(ids.beat, `LANTERN ${run}`),
    track(ids.beat2, `HARBOR ${run}`),
    track(ids.song, `LANTERN SONG ${run}`, 'song'),
    track(ids.late, `LATECOMER ${run}`),
  ]);
  const [project] = await rest(request, 'POST', 'projects', { user_id: PRODUCER_ID, name: projectName });
  projectId = project.id;
  await rest(request, 'POST', 'project_tracks', [
    { project_id: projectId, track_id: ids.beat, position: 0 },
    { project_id: projectId, track_id: ids.beat2, position: 1 },
    { project_id: projectId, track_id: ids.song, position: 2 },
  ]);

  // Link + share through the real routes, so the portal and last_notified_at are real.
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  const headers = { cookie: `${c.name}=${c.value}` };
  const link = await request.post(`${baseURL}/api/projects/${projectId}/contacts`, { headers, data: { contact_id: ids.artist } });
  expect(link.ok(), await link.text()).toBeTruthy();
  const share = await request.post(`${baseURL}/api/projects/${projectId}/contacts/${ids.artist}/share`, { headers, data: {} });
  expect(share.ok(), await share.text()).toBeTruthy();
  const invite = (await emailsTo(request, artistEmail)).at(-1)!;
  portalUrl = invite.text.match(/https?:\/\/\S+\/artist\/[A-Za-z0-9_-]+/)![0];
  portalToken = portalUrl.split('/artist/')[1];
});

test('1 · project files: upload, portal visibility per file, download, Files tab, Notify', async ({ page, baseURL, browser }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/projects/${projectId}`);
  const files = page.getByTestId('project-files');
  await expect(files).toBeVisible();
  // Shared with an artist already, so new files default to visible.
  const visible = files.getByLabel('Artists can see new files');
  await expect(visible).toBeChecked();

  await page.getByTestId('project-files-input').setInputFiles({ name: 'Lyrics.txt', mimeType: 'text/plain', buffer: Buffer.from(lyricsText) });
  await expect(files).toContainText('Lyrics');
  await visible.uncheck();
  await page.getByTestId('project-files-input').setInputFiles({ name: 'Split sheet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%private\n') });
  await expect(files).toContainText('Split sheet');
  // A script is refused, whatever the browser claims it is.
  const html = await page.request.post(`/api/projects/${projectId}/assets`, { multipart: { file: { name: 'x.html', mimeType: 'text/plain', buffer: Buffer.from('<script>1</script>') } } });
  expect(html.status()).toBe(415);

  const rows = await rest(page.request, 'GET', 'project_assets', undefined, `?project_id=eq.${projectId}&select=id,label,in_portal,url,kind,mime`);
  const lyrics = rows.find((r: { label: string }) => r.label === 'Lyrics');
  const split = rows.find((r: { label: string }) => r.label === 'Split sheet');
  expect(lyrics).toMatchObject({ in_portal: true, kind: 'lyrics', mime: 'text/plain' });
  expect(split).toMatchObject({ in_portal: false, kind: 'document' });
  expect(lyrics.url).toMatch(/^local:\/\/project-assets\//);
  // The list the browser gets never carries the storage reference.
  expect(JSON.stringify(await (await page.request.get(`/api/projects/${projectId}/assets`)).json())).not.toContain('local://');

  // Notify counts the new file.
  await page.goto(`/contacts/${ids.artist}`);
  await expect(page.getByRole('button', { name: /Notify · 1 new/ })).toBeEnabled();

  const artist = await browser.newPage();
  await artist.goto(portalUrl);
  await artist.getByRole('tab', { name: 'Files' }).click();
  const list = artist.getByTestId('portal-files');
  await expect(list).toContainText('Lyrics');
  await expect(list).toContainText('New');
  await expect(list).not.toContainText('Split sheet');
  const download = artist.waitForEvent('download');
  await artist.getByRole('button', { name: 'Download Lyrics' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Lyrics.txt');
  expect(fs.readFileSync((await saved.path())!, 'utf8')).toBe(lyricsText);
  // The hidden file does not exist, as far as the portal is concerned.
  expect((await artist.request.get(`/api/portal/${portalToken}/files/${split.id}`)).status()).toBe(404);
  await artist.close();

  await page.goto(`/contacts/${ids.artist}?tab=files`);
  await expect(page.getByTestId(`ws-file-${lyrics.id}`)).toContainText('downloaded today');
  await expect(page.getByTestId(`ws-file-${split.id}`).getByRole('switch', { name: 'In portal' })).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: /Notify · 1 new/ }).click();
  await expect(page.getByRole('button', { name: /^Notify$/ })).toBeDisabled();
  const digest = (await emailsTo(page.request, artistEmail)).at(-1)!;
  expect(digest.text).toContain('File: Lyrics');
  expect(digest.text).not.toContain('Split sheet');
});

test('2 · portal comments: artist → producer → reply → artist; private from share links; switchable', async ({ page, baseURL, browser }) => {
  const artist = await browser.newPage();
  await artist.goto(portalUrl);
  const row = artist.locator(`li[data-track-id="${ids.beat}"]`);
  await row.getByRole('button', { name: /Interested/ }).click();
  await row.getByRole('button', { name: new RegExp(`Comments on LANTERN ${run}`) }).click();
  await row.getByPlaceholder(`Comment on LANTERN ${run}…`).fill('Can I get a version without the flute?');
  await row.getByRole('button', { name: 'Send' }).click();
  await expect(row.getByTestId('portal-thread')).toContainText('Can I get a version without the flute?');

  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.artist}?tab=activity`);
  const notes = await (await page.request.get('/api/notifications')).json();
  expect(notes.notifications.some((n: { kind: string; title: string }) => n.kind === 'portal_comment' && n.title === `${artistName} commented on LANTERN ${run}`)).toBeTruthy();

  const panel = page.getByTestId('artist-comments');
  await expect(panel).toContainText('Can I get a version without the flute?');
  await panel.getByPlaceholder('Reply…').fill('Yes — sending it tonight.');
  await panel.getByRole('button', { name: 'Reply' }).click();
  await expect(panel).toContainText('Yes — sending it tonight.');

  await artist.reload();
  await artist.locator(`li[data-track-id="${ids.beat}"]`).getByRole('button', { name: /Comments on LANTERN/ }).click();
  const thread = artist.locator(`li[data-track-id="${ids.beat}"]`).getByTestId('portal-thread');
  await expect(thread).toContainText('Yes — sending it tonight.');
  await expect(thread).toContainText('UCHE');

  // A share link to the same project never shows the artist's thread.
  const shareToken = `p2share${run}`;
  await rest(page.request, 'POST', 'project_shares', { project_id: projectId, token: shareToken, role: 'commenter' });
  const shareComments = await (await page.request.get(`/api/projects/share/${shareToken}/comments`)).json();
  expect(JSON.stringify(shareComments)).not.toContain('flute');

  // Comments off for this project → the portal refuses and says so.
  expect((await page.request.patch(`/api/projects/${projectId}/contacts/${ids.artist}`, { data: { can_comment: false } })).ok()).toBeTruthy();
  const refused = await artist.request.post(`/api/portal/${portalToken}/comments`, { data: { project_id: projectId, track_id: ids.beat, body: 'again' } });
  expect(refused.status()).toBe(403);
  // A beat that is not in the portal is simply not found.
  const outside = await artist.request.post(`/api/portal/${portalToken}/comments`, { data: { project_id: projectId, track_id: ids.late, body: 'x' } });
  expect([403, 404]).toContain(outside.status());
  expect((await page.request.patch(`/api/projects/${projectId}/contacts/${ids.artist}`, { data: { can_comment: true } })).ok()).toBeTruthy();
  await artist.close();
});

test('3 · the Artists card view', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'artists' }).click();
  const card = page.getByTestId(`artist-card-${ids.artist}`);
  await expect(card).toContainText(artistName);
  await expect(card).toContainText('Working together');
  await expect(card).toContainText(projectName);
  await expect(card).toContainText('1 interested');
  await expect(card).toContainText('1 download');
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${ids.artist}`));
});

test('4 · credit linked to a contact, search labels, and the contact photo', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  const credit = await page.request.post(`/api/tracks/${ids.song}/collaborators`, { data: { name: artistName, role: 'feature' } });
  expect(credit.ok(), await credit.text()).toBeTruthy();
  const { id: creditId } = await credit.json();
  const linked = await page.request.patch(`/api/tracks/${ids.song}/collaborators`, { data: { id: creditId, contact_id: ids.artist } });
  expect(linked.ok(), await linked.text()).toBeTruthy();
  expect((await linked.json()).contact_id).toBe(ids.artist);
  // Another producer's contact id (or nonsense) cannot be attached.
  expect((await page.request.patch(`/api/tracks/${ids.song}/collaborators`, { data: { id: creditId, contact_id: randomUUID() } })).status()).toBe(404);

  const songHit = await (await page.request.get(`/api/search?q=${encodeURIComponent(`LANTERN SONG ${run}`)}`)).json();
  expect(songHit.tracks.find((t: { id: string }) => t.id === ids.song)?.artist).toBe(artistName);
  const fileHit = await (await page.request.get('/api/search?q=Lyrics')).json();
  expect(fileHit.files.some((f: { project_id: string; label: string }) => f.project_id === projectId && f.label === 'Lyrics')).toBeTruthy();
  const artistHit = await (await page.request.get(`/api/search?q=${encodeURIComponent(artistName)}`)).json();
  expect(artistHit.contacts.find((c: { id: string }) => c.id === ids.artist)?.is_artist).toBe(true);

  // The palette shows it.
  await page.goto('/library');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  // The shortcut listener attaches on hydration; press until it answers.
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await palette.getByRole('textbox').fill(`LANTERN SONG ${run}`);
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toContainText(`SONG · ${artistName}`);
  await page.keyboard.press('Escape');

  // The credited song is in the artist's Songs tab.
  await page.goto(`/contacts/${ids.artist}?tab=songs`);
  await expect(page.getByTestId(`ws-song-${ids.song}`)).toBeVisible();

  // Photo.
  await page.goto(`/contacts/${ids.artist}`);
  const patched = page.waitForResponse((r) => r.url().endsWith(`/api/contacts/${ids.artist}`) && r.request().method() === 'PATCH');
  await page.getByTestId('contact-avatar-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  expect((await patched).ok()).toBeTruthy();
  await expect(page.getByTestId('contact-avatar-img')).toBeVisible();
  const [contact] = await rest(page.request, 'GET', 'contacts', undefined, `?id=eq.${ids.artist}&select=avatar_url`);
  expect(contact.avatar_url).toMatch(/^\/uploads\//);
  expect((await page.request.patch(`/api/contacts/${ids.artist}`, { data: { avatar_url: 'r2://private/x.png' } })).status()).toBe(400);
});

test('5 · the daily digest: opt in, one email, then idempotent', async ({ page, baseURL, request }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.artist}`);
  await page.getByRole('button', { name: 'Portal actions' }).click();
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/contacts/${ids.artist}/portal`) && r.request().method() === 'POST');
  await page.getByRole('menuitemcheckbox', { name: /Daily digest/ }).or(page.getByRole('menuitem', { name: /Daily digest/ })).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByText('· daily digest')).toBeVisible();
  const [portal] = await rest(page.request, 'GET', 'artist_portals', undefined, `?contact_id=eq.${ids.artist}&select=auto_digest`);
  expect(portal.auto_digest).toBe(true);

  // Yesterday's notify, then a beat added today.
  const yesterday = new Date(Date.now() - 26 * 3_600_000).toISOString();
  await rest(page.request, 'PATCH', 'project_contacts', { last_notified_at: yesterday }, `?project_id=eq.${projectId}&contact_id=eq.${ids.artist}`);
  expect((await page.request.post(`/api/projects/${projectId}/tracks`, { data: { track_ids: [ids.late] } })).ok()).toBeTruthy();

  const before = (await emailsTo(request, artistEmail)).length;
  const cron = () => request.get(`${baseURL}/api/cron/artist-digest`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? 'local-cron'}` } });
  expect((await request.get(`${baseURL}/api/cron/artist-digest`)).status()).toBe(401);
  const first = await (await cron()).json();
  expect(first.sent).toBeGreaterThanOrEqual(1);
  const mails = await emailsTo(request, artistEmail);
  expect(mails.length).toBe(before + 1);
  expect(mails.at(-1)!.text).toContain(`LATECOMER ${run}`);

  const second = await (await cron()).json();
  expect(second.ok).toBe(true);
  expect((await emailsTo(request, artistEmail)).length).toBe(before + 1);
});
