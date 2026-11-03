/**
 * Collaborators (LABEL-69) end to end against a REAL database (scripts/local-db,
 * LABEL_OS_ENABLED=true from env.sh):
 *
 *   PRODUCER  owner of label org ONE, invites a collaborator from the members panel
 *   BUYER     the seed buyer: a rapper with their own account, no org membership
 *
 * The owner invites BUYER to a project as a contributor WITH a credit (rapper) on
 * a song; BUYER accepts; the credit is proposed for BUYER's own party in the
 * owner's name; /shared ("My sessions") then lists it as an ask, grouped under
 * the org beside a second org's project (and its open split ask); BUYER
 * confirms the credit from that page. Nothing of another project's, another
 * person's or a draft's is listed.
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const RESEND = 'http://127.0.0.1:54400/emails';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const ORG2 = randomUUID();
const SLUG = `collab-${run}`;
const SLUG2 = `collab2-${run}`;
const P1 = randomUUID();
const P2 = randomUUID(); // a project of org ONE the collaborator is NOT on
const P3 = randomUUID(); // a project of org TWO they are on
const S1 = randomUUID();
const S2 = randomUUID();
const S3 = randomUUID();
const PARTY2 = randomUUID();
const SHEET = randomUUID();
const LINE = randomUUID();
const BUYER_EMAIL = 'buyer@local.test';
const shots = 'e2e-artifacts/LABEL-69';

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

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(shots, { recursive: true });
  await rest(request, 'DELETE', `org_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`);
  await rest(request, 'POST', 'organizations', [
    { id: ORG, name: `Collab Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID },
    { id: ORG2, name: `Second Label ${run}`, slug: SLUG2, kind: 'label', created_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', scope: 'org' },
    { org_id: ORG2, user_id: PRODUCER_ID, role: 'owner', scope: 'org' },
  ]);
  await rest(request, 'POST', 'projects', [
    { id: P1, org_id: ORG, user_id: null, name: `Midnight EP ${run}` },
    { id: P2, org_id: ORG, user_id: null, name: `Secret LP ${run}` },
    { id: P3, org_id: ORG2, user_id: null, name: `Summer Tape ${run}` },
  ]);
  await rest(request, 'POST', 'tracks', [
    { id: S1, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: '/uploads/none.wav' },
    { id: S2, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Secret ${run}`, type: 'song', song_stage: 'in_review', audio_url: '/uploads/none.wav' },
    { id: S3, org_id: ORG2, user_id: null, created_by: PRODUCER_ID, title: `Summer ${run}`, type: 'song', song_stage: 'in_review', audio_url: '/uploads/none.wav' },
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: P1, track_id: S1, position: 0 },
    { project_id: P2, track_id: S2, position: 0 },
    { project_id: P3, track_id: S3, position: 0 },
  ]);
  // Org TWO: the collaborator is already on P3 with their own party and a circulated split line to acknowledge.
  await rest(request, 'POST', 'project_members', { org_id: ORG2, project_id: P3, user_id: BUYER_ID, role: 'contributor', allow_downloads: false, invited_by: PRODUCER_ID });
  await rest(request, 'POST', 'parties', { id: PARTY2, org_id: ORG2, kind: 'person', display_name: 'Rap Buyer', user_id: BUYER_ID, created_by: PRODUCER_ID });
  await rest(request, 'POST', 'split_sheets', { id: SHEET, org_id: ORG2, track_id: S3, kind: 'master', version: 1, status: 'draft', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'split_lines', { id: LINE, split_sheet_id: SHEET, org_id: ORG2, track_id: S3, party_id: PARTY2, role: 'master_owner', share: 100, position: 0 });
  await rest(request, 'PATCH', `split_sheets?id=eq.${SHEET}`, { status: 'circulated', circulated_by: PRODUCER_ID, circulated_at: new Date().toISOString() });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `organizations?id=in.(${ORG},${ORG2})`);
  await rest(request, 'DELETE', `project_members?user_id=eq.${BUYER_ID}`);
});

test('1 · invite a rapper with a credit; they accept; My sessions lists the asks across two orgs; they confirm', async ({ browser, baseURL, request }) => {
  const producer = await browser.newContext();
  const pc = sessionCookie(PRODUCER_ID, 'producer@local.test');
  await producer.addCookies([{ name: pc.name, value: pc.value, url: baseURL! }]);
  const pp = await producer.newPage();
  await pp.request.delete(RESEND);
  await pp.goto(`/o/${SLUG}/projects/${P1}`);
  const panel = pp.getByTestId('project-members');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText('Loading…')).toHaveCount(0, { timeout: 60_000 }); // hydrated and loaded
  await panel.getByLabel('Email address').fill(BUYER_EMAIL);
  await panel.getByRole('button', { name: 'Credit', exact: true }).click();
  await pp.getByRole('option', { name: 'Credit as rapper' }).click();
  await panel.getByRole('button', { name: /^Invite$/ }).click();
  await expect(panel.getByText(/credit: Rapper/)).toBeVisible({ timeout: 30_000 });
  await pp.screenshot({ path: `${shots}/producer-invite-1440.png`, fullPage: true });

  const mails = (await (await pp.request.get(RESEND)).json()) as { body: { to: string | string[]; html: string } }[];
  const mail = mails.find((m) => [m.body.to].flat().includes(BUYER_EMAIL));
  const token = String(mail!.body.html).match(/\/join\/([A-Za-z0-9_-]{43})"/)![1];

  // The tag is on the invitation and nowhere an invitee could widen.
  const inv = (await rest(request, 'GET', `org_invitations?select=functions,project_role&org_id=eq.${ORG}&project_id=eq.${P1}`)) as { functions: string[]; project_role: string }[];
  expect(inv[0].functions).toEqual(['collab:rapper', `song:${S1}`]);

  // The collaborator accepts.
  const xCtx = await browser.newContext();
  const bc = sessionCookie(BUYER_ID, BUYER_EMAIL);
  await xCtx.addCookies([{ name: bc.name, value: bc.value, url: baseURL! }]);
  const x = await xCtx.newPage();
  await x.goto(`/join/${token}`);
  await x.getByRole('button', { name: 'Accept and open the project' }).click();
  await expect(x.getByRole('status')).toContainText('You now have access to');

  // Proposed for THEIR party, in the inviter's name; they cannot have proposed it themselves.
  const credits = (await rest(request, 'GET', `track_collaborators?select=id,role,role_detail,status,created_by,party_id&track_id=eq.${S1}`)) as {
    id: string; role: string; role_detail: string; status: string; created_by: string; party_id: string;
  }[];
  expect(credits).toHaveLength(1);
  expect(credits[0]).toMatchObject({ role: 'vocalist', role_detail: 'Rap', status: 'proposed', created_by: PRODUCER_ID });
  const party = (await rest(request, 'GET', `parties?select=user_id,org_id&id=eq.${credits[0].party_id}`)) as { user_id: string; org_id: string }[];
  expect(party).toEqual([{ user_id: BUYER_ID, org_id: ORG }]);

  // ── My sessions ───────────────────────────────────────────────────────
  for (const [w, h, name] of [[1440, 900, '1440'], [390, 844, '390']] as const) {
    await x.setViewportSize({ width: w, height: h });
    await x.goto('/shared');
    await expect(x.getByTestId('my-sessions')).toBeVisible({ timeout: 60_000 });
    await expect(x.getByTestId(`session-org-${ORG}`)).toContainText(`Collab Records ${run}`);
    await expect(x.getByTestId(`session-org-${ORG2}`)).toContainText(`Second Label ${run}`);
    await expect(x.getByTestId(`session-org-${ORG}`).getByTestId('ask-credit')).toContainText('Confirm your credit: Vocalist');
    await expect(x.getByTestId(`session-org-${ORG2}`).getByTestId('ask-split')).toContainText('Acknowledge your split');
    // Nothing of the org's other project, and no way into the org.
    await expect(x.locator('body')).not.toContainText(`Secret LP ${run}`);
    expect(await x.locator('a[href^="/o/"]').count()).toBe(0);
    await x.screenshot({ path: `${shots}/my-sessions-${name}.png`, fullPage: true });
  }

  // Confirm the credit from the page.
  await x.getByTestId(`session-org-${ORG}`).getByRole('button', { name: 'Confirm' }).click();
  await expect(x.getByTestId(`session-org-${ORG}`).getByTestId('ask-credit')).toHaveCount(0, { timeout: 30_000 });
  const after = (await rest(request, 'GET', `track_collaborators?select=status,confirmed_by&id=eq.${credits[0].id}`)) as { status: string; confirmed_by: string }[];
  expect(after).toEqual([{ status: 'confirmed', confirmed_by: BUYER_ID }]);

  // And acknowledge the second org's split.
  await x.getByTestId(`session-org-${ORG2}`).getByRole('button', { name: 'Acknowledge' }).click();
  await expect(x.getByTestId('ask-split')).toHaveCount(0, { timeout: 30_000 });
  const line = (await rest(request, 'GET', `split_lines?select=signed_at,signature_method&id=eq.${LINE}`)) as { signed_at: string | null; signature_method: string }[];
  expect(line[0].signature_method).toBe('acknowledged');
  await x.screenshot({ path: `${shots}/my-sessions-after.png`, fullPage: true });

  // The producer app and the store are untouched.
  expect((await x.request.get('/store')).status()).toBe(200);
});
