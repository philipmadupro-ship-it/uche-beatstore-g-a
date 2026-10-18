/**
 * Contact uploads through the portal link (PORTAL-UP, mig 190), end to end
 * against a REAL database (scripts/local-db): Postgres + PostgREST with RLS,
 * migration 190's same-owner trigger, the real routes and the real pages.
 *
 *   1. the producer switches Uploads on for one project of the contact's link
 *      and puts a password on the link — both from the workspace
 *   2. the contact opens the link with no account, types the password and
 *      sends a file; the API refuses a project with uploads off (403), a
 *      project outside the portal (404), a script (415) and a missing password
 *   3. the producer sees the file on the project page and in the workspace
 *      Files tab, credited to the contact, with a notification
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db` (see scripts/local-db).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);

const contactId = randomUUID();
const contactName = `Upload Artist ${run}`;
const contactEmail = `up-${run}@local.test`;
const openProject = `Uploads open ${run}`;
const closedProject = `Uploads closed ${run}`;
const outsideProject = `Not shared ${run}`;
const PASSWORD = `pw-${run}`;

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

const ids = { open: '', closed: '', outside: '' };
let portalUrl = '';
let portalToken = '';

test.beforeAll(async ({ request, baseURL }) => {
  await rest(request, 'POST', 'contacts', { id: contactId, user_id: PRODUCER_ID, name: contactName, email: contactEmail });
  for (const [key, name] of [['open', openProject], ['closed', closedProject], ['outside', outsideProject]] as const) {
    const [p] = await rest(request, 'POST', 'projects', { user_id: PRODUCER_ID, name });
    ids[key] = p.id;
  }
  const c = sessionCookie(PRODUCER_ID, 'producer@local.test');
  const headers = { cookie: `${c.name}=${c.value}` };
  for (const pid of [ids.open, ids.closed]) {
    const link = await request.post(`${baseURL}/api/projects/${pid}/contacts`, { headers, data: { contact_id: contactId } });
    expect(link.ok(), await link.text()).toBeTruthy();
    const share = await request.post(`${baseURL}/api/projects/${pid}/contacts/${contactId}/share`, { headers, data: {} });
    expect(share.ok(), await share.text()).toBeTruthy();
  }
  const mails = (await (await request.get(RESEND)).json()) as Array<{ body: { to: string; text: string } }>;
  const invite = mails.filter((m) => m.body.to === contactEmail).at(-1)!.body;
  portalUrl = invite.text.match(/https?:\/\/\S+\/artist\/[A-Za-z0-9_-]+/)![0];
  portalToken = portalUrl.split('/artist/')[1];
});

test('1 · the producer opens uploads on one project and locks the link with a password', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${contactId}?tab=projects`);
  const open = page.getByTestId(`ws-project-${ids.open}`);
  const uploads = open.getByRole('switch', { name: 'Uploads' });
  await expect(uploads).toHaveAttribute('aria-checked', 'false');
  await uploads.click();
  await expect(uploads).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId(`ws-project-${ids.closed}`).getByRole('switch', { name: 'Uploads' })).toHaveAttribute('aria-checked', 'false');

  const links = await rest(page.request, 'GET', 'project_contacts', undefined, `?contact_id=eq.${contactId}&select=project_id,can_upload`);
  expect(links.find((l: { project_id: string }) => l.project_id === ids.open).can_upload).toBe(true);
  expect(links.find((l: { project_id: string }) => l.project_id === ids.closed).can_upload).toBe(false);

  await page.getByRole('button', { name: 'Portal actions' }).click();
  await page.getByRole('menuitem', { name: /Set a password/ }).click();
  const form = page.getByTestId('portal-password-form');
  await form.getByLabel('Portal password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByTestId('portal-has-password')).toBeVisible();
  const [portal] = await rest(page.request, 'GET', 'artist_portals', undefined, `?contact_id=eq.${contactId}&select=token,password_hash`);
  expect(portal.token).toBe(portalToken); // setting a password does not change the link
  expect(portal.password_hash).toBeTruthy();
});

test('2 · the contact opens the link without an account, types the password and sends a file', async ({ browser, request, baseURL }) => {
  const ctx = await browser.newContext();
  const artist = await ctx.newPage();
  await artist.goto(portalUrl);
  await artist.getByPlaceholder('Password').fill(PASSWORD);
  await artist.getByRole('button', { name: 'Open', exact: true }).click();
  await artist.getByRole('tab', { name: 'Files' }).click();
  const upload = artist.getByTestId('portal-upload');
  await expect(upload).toBeVisible();
  // Only the project with uploads on can be picked, so there is one target.
  await expect(upload).toContainText(`Send a file to ${openProject}`);
  await artist.getByTestId('portal-upload-input').setInputFiles({ name: 'Verse idea.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3fake-mp3-bytes') });
  await expect(upload).toContainText('Sent 1 file');
  const files = artist.getByTestId('portal-files');
  await expect(files).toContainText('Verse idea');
  await expect(files).toContainText('Sent by you');

  const rows = await rest(request, 'GET', 'project_assets', undefined, `?project_id=eq.${ids.open}&select=id,label,url,mime,in_portal,uploaded_by_contact_id,user_id`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ label: 'Verse idea', mime: 'audio/mpeg', in_portal: true, uploaded_by_contact_id: contactId, user_id: PRODUCER_ID });
  expect(rows[0].url).toMatch(new RegExp(`^local://project-assets/${ids.open}/`));

  // The API's own answers, with and without the password.
  const post = (projectId: string, name: string, password: string | null = PASSWORD) => request.post(`${baseURL}/api/portal/${portalToken}/files`, {
    headers: password ? { 'x-share-password': password } : {},
    multipart: { project_id: projectId, file: { name, mimeType: 'application/octet-stream', buffer: Buffer.from('x') } },
  });
  expect((await post(ids.open, 'a.pdf', null)).status()).toBe(401);
  expect((await post(ids.closed, 'a.pdf')).status()).toBe(403);
  expect((await post(ids.outside, 'a.pdf')).status()).toBe(404);
  expect((await post(ids.open, 'evil.html')).status()).toBe(415);
  expect((await post(ids.open, 'logo.svg')).status()).toBe(415);
  // A storage reference is never taken from the client.
  const forged = await request.post(`${baseURL}/api/portal/${portalToken}/files`, {
    headers: { 'x-share-password': PASSWORD, 'content-type': 'application/json' },
    data: { project_id: ids.open, url: rows[0].url, file_name: 'copy.mp3' },
  });
  expect(forged.status()).toBe(400);
  await ctx.close();
});

test('3 · the producer sees the upload on the project page and in the workspace Files tab', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  const [asset] = await rest(page.request, 'GET', 'project_assets', undefined, `?project_id=eq.${ids.open}&select=id`);

  await page.goto(`/projects/${ids.open}`);
  await expect(page.getByTestId(`project-file-from-${asset.id}`)).toContainText(`From ${contactName}`, { timeout: 30_000 });
  expect(JSON.stringify(await (await page.request.get(`/api/projects/${ids.open}/assets`)).json())).not.toContain('local://');

  await page.goto(`/contacts/${contactId}?tab=files`);
  await expect(page.getByTestId(`ws-file-${asset.id}`)).toContainText('Verse idea');
  await expect(page.getByTestId(`ws-file-from-artist-${asset.id}`)).toContainText(`From ${contactName}`);

  const notes = await rest(page.request, 'GET', 'notifications', undefined, `?user_id=eq.${PRODUCER_ID}&kind=eq.portal_upload&select=title,data`);
  expect(notes.some((n: { title: string; data: { asset_id?: string } }) => n.title === `${contactName} uploaded a file to ${openProject}` && n.data.asset_id === asset.id)).toBe(true);

  // The contact's own upload is not something to Notify them about.
  await page.goto(`/contacts/${contactId}`);
  await expect(page.getByRole('button', { name: /Notify · \d+ new/ })).toHaveCount(0);
});
