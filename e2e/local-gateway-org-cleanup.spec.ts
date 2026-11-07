/**
 * The real-database stack's org cleanup (LABEL-77): migration 195 refuses to delete an organization before its 30-day
 * grace period; the local gateway ages `deleted_at` only for a request carrying `x-e2e-org-cleanup: 1`. This proves
 * both halves against the real trigger: without the header the refusal stands, with it the delete goes through.
 *
 * Skipped unless E2E_REAL_DB=1 (process.env.E2E_REAL_DB). Run: `npm run e2e:real-db`.
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PRODUCER_ID, SERVICE_KEY } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
test.skip(process.env.E2E_REAL_DB !== '1', 'needs the local database stack (scripts/local-db)');

test('an org delete without the test header meets the 195 guard; with it, the cleanup works', async () => {
  // The config adds the cleanup header to every request context; this one switches it off, as the app's own client has it.
  const bare = await pwRequest.newContext({ extraHTTPHeaders: { 'x-e2e-org-cleanup': '0' } });
  const h = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' };
  const id = randomUUID();
  const made = await bare.post(`${REST}/organizations`, { headers: h, data: { id, name: `Cleanup ${id.slice(0, 6)}`, slug: `cleanup-${id.slice(0, 6)}`, kind: 'label', created_by: PRODUCER_ID } });
  expect(made.ok(), await made.text()).toBeTruthy();

  const refused = await bare.delete(`${REST}/organizations?id=eq.${id}`, { headers: h });
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toContain('deleted only by the purge');

  const cleaned = await bare.delete(`${REST}/organizations?id=eq.${id}`, { headers: { ...h, 'x-e2e-org-cleanup': '1' } });
  expect(cleaned.ok(), await cleaned.text()).toBeTruthy();
  const left = await bare.get(`${REST}/organizations?id=eq.${id}&select=id`, { headers: h });
  expect(await left.json()).toEqual([]);
  await bare.dispose();
});
