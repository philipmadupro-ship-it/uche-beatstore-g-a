/**
 * Contact roles (mig 134) end to end against a REAL database
 * (scripts/local-db): a main role plus one extra, a tab per role on
 * /contacts (Artists · Producers · Labels & A&R · Other contacts), the
 * role summary cards with the send that fits each role, and the Send Beat
 * modal opening pre-filtered (loops for a producer, toplines for a label).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SERVICE_KEY, PRODUCER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ids = { kofi: randomUUID(), ada: randomUUID(), nova: randomUUID(), buyer: randomUUID(), loop: randomUUID(), top: randomUUID() };
const name = (n: string) => `${n} ${run}`;

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
  // Start every test from the same tab choice.
  await page.addInitScript(() => { try { localStorage.removeItem('contacts.view'); } catch { /* */ } });
}

test.beforeAll(async ({ request }) => {
  await rest(request, 'POST', 'contacts', [
    { id: ids.kofi, user_id: PRODUCER_ID, name: name('Kofi'), email: `kofi-${run}@local.test`, category: 'producer', secondary_category: null },
    { id: ids.ada, user_id: PRODUCER_ID, name: name('Ada'), email: `ada-${run}@local.test`, category: 'a&r', secondary_category: null },
    { id: ids.nova, user_id: PRODUCER_ID, name: name('Nova'), email: `nova-${run}@local.test`, category: 'artist', secondary_category: 'producer' },
    { id: ids.buyer, user_id: PRODUCER_ID, name: name('Buyer'), email: `buyer-${run}@local.test`, category: 'buyer', secondary_category: null },
  ]);
  await rest(request, 'POST', 'tracks', [
    { id: ids.loop, user_id: PRODUCER_ID, title: name('KEYS LOOP'), type: 'loop', audio_url: '/uploads/x.wav' },
    { id: ids.top, user_id: PRODUCER_ID, title: name('HOOK TOPLINE'), type: 'topline', audio_url: '/uploads/y.wav' },
  ]);
  await rest(request, 'POST', 'beat_sends', [
    { contact_id: ids.kofi, track_ids: [ids.loop], status: 'sent', message: '' },
    { contact_id: ids.ada, track_ids: [ids.top], status: 'sent', message: '' },
  ]);
});

test('1 · each role has its tab; a two-role contact is in both; everyone else is Other', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto('/contacts');

  await page.getByRole('button', { name: /^Producers/ }).click();
  const producers = page.getByTestId('role-strip-producer');
  // Cards are most-recently-contacted first (Kofi was just sent a loop); the rest are one click away.
  await expect(producers.getByTestId(`role-card-${ids.kofi}`)).toContainText('1 loop');
  const showAll = page.getByRole('button', { name: /^Show all/ });
  if (await showAll.isVisible()) await showAll.click();
  await expect(producers.getByTestId(`role-card-${ids.nova}`)).toContainText('also Artist');
  await expect(producers).not.toContainText(name('Ada'));

  await page.getByRole('button', { name: /^Labels & A&R/ }).click();
  const labels = page.getByTestId('role-strip-label');
  const ada = labels.getByTestId(`role-card-${ids.ada}`);
  await expect(ada).toContainText('1 topline');
  await expect(ada.getByRole('button', { name: 'Send toplines' })).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Send a pack' })).toBeVisible();
  await expect(labels).not.toContainText(name('Kofi'));

  await page.getByRole('button', { name: /^Other contacts/ }).click();
  await page.getByPlaceholder(/Search/).first().fill(run);
  await expect(page.getByText(name('Buyer')).first()).toBeVisible();
  for (const n of ['Kofi', 'Ada', 'Nova']) await expect(page.getByText(name(n))).toHaveCount(0);

  await page.getByRole('button', { name: /^Artists/ }).click();
  const noWs = page.getByTestId('artists-without-workspace');
  await expect(noWs).toContainText(name('Nova'));
  await expect(noWs).toContainText('also Producer');
});

test('2 · the send that fits the role: loops for a producer, toplines for a label', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto('/contacts');
  await page.getByRole('button', { name: /^Producers/ }).click();
  await page.getByTestId(`role-card-${ids.kofi}`).getByRole('button', { name: 'Send loops' }).click();
  await expect(page.getByRole('button', { name: 'Show every type' })).toContainText('Loops only');
  await expect(page.getByText(name('KEYS LOOP')).first()).toBeVisible();
  await expect(page.getByText(name('HOOK TOPLINE'))).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Labels & A&R/ }).click();
  await page.getByTestId(`role-card-${ids.ada}`).getByRole('button', { name: 'Send toplines' }).click();
  await expect(page.getByRole('button', { name: 'Show every type' })).toContainText('Toplines + Songs only');
  await expect(page.getByText(name('HOOK TOPLINE')).first()).toBeVisible();
  await expect(page.getByText(name('KEYS LOOP'))).toHaveCount(0);
});

test('3 · set the main role and one extra on the contact page', async ({ page, baseURL }) => {
  await asProducer(page, baseURL!);
  await page.goto(`/contacts/${ids.buyer}`);
  const roles = page.getByTestId('contact-roles');
  await roles.getByRole('button', { name: 'Main role' }).click();
  let saved = page.waitForResponse((r) => r.url().endsWith(`/api/contacts/${ids.buyer}`) && r.request().method() === 'PATCH');
  await page.getByRole('option', { name: 'Label', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await roles.getByRole('button', { name: 'Extra role' }).click();
  saved = page.waitForResponse((r) => r.url().endsWith(`/api/contacts/${ids.buyer}`) && r.request().method() === 'PATCH');
  await page.getByRole('option', { name: 'Producer', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(roles).toContainText('Shows under Labels & A&R and Producers');
  const [row] = await rest(page.request, 'GET', 'contacts', undefined, `?id=eq.${ids.buyer}&select=category,secondary_category`);
  expect(row).toEqual({ category: 'label', secondary_category: 'producer' });
});
