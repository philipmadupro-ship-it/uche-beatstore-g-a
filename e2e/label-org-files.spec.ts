/**
 * Org project files (LABEL-15) end to end against a REAL database
 * (scripts/local-db: Postgres + PostgREST + RLS, LABEL_OS_ENABLED=true). What
 * mocks cannot prove: migration 143's trigger takes the org from the project
 * and accepts exactly the ownerless row the route writes, its CHECK makes a
 * contract restricted, the read policies agree with the routes, and the
 * restricted-download audit event lands in `activity_events`.
 *
 * The producer owns a label with artist Nova and project "Nova EP"; the seed
 * BUYER is a marketing member (catalogue read, finished material, no
 * contracts). Without R2 files go to `data/orgs/<org>/assets/…`, never
 * `public/`; the run removes them.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const NOVA = randomUUID();
const PROJECT = randomUUID();

test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function rest(request: APIRequestContext, method: string, p: string, body?: unknown) {
  const res = await request.fetch(`${REST}/${p}`, {
    method,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok(), `${method} ${p}: ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function signedIn(context: BrowserContext, baseURL: string, id: string, email: string) {
  const c = sessionCookie(id, email);
  await context.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
}

const files = `/api/org/${ORG}/projects/${PROJECT}/assets`;
const ids: Record<string, string> = {};

async function upload(api: APIRequestContext, name: string, body: string, fields: Record<string, string> = {}) {
  return api.post(files, {
    multipart: { file: { name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) }, ...fields },
  });
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Files Records ${run}`, slug: `files-${run}`, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' });
  await rest(request, 'POST', 'org_members', { org_id: ORG, user_id: BUYER_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', { id: PROJECT, org_id: ORG, user_id: null, name: `Nova EP ${run}` });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  fs.rmSync(path.join(process.cwd(), 'data', 'orgs', ORG), { recursive: true, force: true });
});

test('1 · the owner adds artwork and a contract: ownerless rows, the contract restricted, bytes outside public/', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const api = ctx.request;

  const art = await upload(api, 'cover.png', 'png-bytes');
  expect(art.status(), await art.text()).toBe(201);
  ids.art = (await art.json()).asset.id;
  const deal = await upload(api, `Nova ${run} recording agreement.pdf`, 'contract-bytes', { sensitivity: 'normal' });
  expect(deal.status(), await deal.text()).toBe(201);
  const dealView = (await deal.json()).asset;
  expect(dealView).toMatchObject({ kind: 'contract', sensitivity: 'restricted', in_portal: false });
  ids.deal = dealView.id;
  const session = await upload(api, 'Midnight.als', 'als-bytes');
  expect(session.status(), await session.text()).toBe(201);
  ids.session = (await session.json()).asset.id;
  expect((await upload(api, 'x.html', '<script>')).status()).toBe(415);

  const rows = (await rest(request, 'GET', `project_assets?select=id,org_id,user_id,created_by,kind,sensitivity,url&project_id=eq.${PROJECT}&order=position`)) as Record<string, string | null>[];
  expect(rows.map((r) => [r.kind, r.sensitivity])).toEqual([['artwork', 'normal'], ['contract', 'restricted'], ['session', 'normal']]);
  for (const r of rows) {
    expect(r).toMatchObject({ org_id: ORG, user_id: null, created_by: PRODUCER_ID });
    expect(r.url).toMatch(new RegExp(`^local://orgs/${ORG}/assets/${PROJECT}/[A-Za-z0-9_-]{16}\\.[a-z]+$`));
    expect(fs.existsSync(path.join(process.cwd(), 'data', String(r.url).slice('local://'.length)))).toBe(true);
  }
  await ctx.close();
});

test('2 · marketing sees and opens the artwork only; the contract and the session are 403', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, BUYER_ID, 'buyer@local.test');
  const api = ctx.request;

  const list = await api.get(files);
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.assets.map((a: { kind: string }) => a.kind)).toEqual(['artwork']);
  expect(body.permissions).toEqual({ write: false, restricted: false });
  expect(JSON.stringify(body)).not.toMatch(/local:\/\/|r2:\/\//);

  const art = await api.get(`${files}/${ids.art}/download`);
  expect(art.status()).toBe(200);
  expect(await art.text()).toBe('png-bytes');
  expect((await api.get(`${files}/${ids.deal}/download`)).status()).toBe(403);
  expect((await api.get(`${files}/${ids.session}/download`)).status()).toBe(403);
  expect((await upload(api, 'press photo.jpg', 'x')).status()).toBe(403);
  await ctx.close();
});

test('3 · the same rule in Postgres: marketing reads only the artwork row through PostgREST', async ({ request }) => {
  const asMember = await request.get(`${REST}/project_assets?select=kind,sensitivity&project_id=eq.${PROJECT}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(BUYER_ID, 'buyer@local.test')}` },
  });
  expect(asMember.status()).toBe(200);
  expect(await asMember.json()).toEqual([{ kind: 'artwork', sensitivity: 'normal' }]);
  const asOwner = await request.get(`${REST}/project_assets?select=kind&project_id=eq.${PROJECT}&order=position`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${userToken(PRODUCER_ID, 'producer@local.test')}` },
  });
  expect((await asOwner.json()).map((r: { kind: string }) => r.kind)).toEqual(['artwork', 'contract', 'session']);
});

test('4 · the owner downloads the contract and the audit event is recorded', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const res = await ctx.request.get(`${files}/${ids.deal}/download`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe('contract-bytes');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');

  const events = (await rest(request, 'GET', `activity_events?select=verb,actor_id,subject_id,audit,project_id&org_id=eq.${ORG}&verb=eq.file.restricted_downloaded`)) as Record<string, unknown>[];
  expect(events).toEqual([{ verb: 'file.restricted_downloaded', actor_id: PRODUCER_ID, subject_id: ids.deal, audit: true, project_id: PROJECT }]);
  // An ordinary download is not audited.
  expect((await ctx.request.get(`${files}/${ids.art}/download`)).status()).toBe(200);
  const audited = (await rest(request, 'GET', `activity_events?select=id&org_id=eq.${ORG}&audit=eq.true`)) as unknown[];
  expect(audited).toHaveLength(1);
  await ctx.close();
});

test('5 · deleting removes the row and the stored bytes', async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext();
  await signedIn(ctx, baseURL!, PRODUCER_ID, 'producer@local.test');
  const [row] = (await rest(request, 'GET', `project_assets?select=url&id=eq.${ids.session}`)) as { url: string }[];
  const res = await ctx.request.delete(`${files}/${ids.session}`);
  expect(res.status()).toBe(200);
  expect(await rest(request, 'GET', `project_assets?select=id&id=eq.${ids.session}`)).toEqual([]);
  expect(fs.existsSync(path.join(process.cwd(), 'data', row.url.slice('local://'.length)))).toBe(false);
  await ctx.close();
});
