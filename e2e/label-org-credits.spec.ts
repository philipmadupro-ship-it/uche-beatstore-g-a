/**
 * Parties + credits on `track_collaborators` (LABEL-27) end to end against a
 * REAL database (scripts/local-db: Postgres + PostgREST + RLS,
 * LABEL_OS_ENABLED=true, migration 153 included).
 *
 * What mocks cannot prove: the extended table behaves as the migration says
 * (a credit gets the song's org, a filename credit arrives proposed), the
 * ACCEPTANCE CRITERIA hold through the real stack —
 *   · an external member cannot propose a credit for someone else,
 *   · existing (producer) credits read unchanged —
 * and that the same rules hold at the database: the members' OWN JWTs read
 * straight from PostgREST see only what RLS lets them (an own line sees its own
 * credit and party; marketing and an external member see nothing).
 *
 * Cast: the producer owns the label (rights.write). The seed BUYER is an
 * EXTERNAL contributor on Nova's project (a project_members row, no org
 * membership). ARTIST_A is a label member with the producer function (an own
 * line); ARTIST_B is a marketing member (no rights ability).
 *
 * Skipped unless E2E_REAL_DB=1. Run: `npm run e2e:real-db`.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ANON_KEY, ARTIST_A_ID, ARTIST_B_ID, SERVICE_KEY, PRODUCER_ID, BUYER_ID, sessionCookie, userToken } from '../scripts/local-db/jwt.mjs';

const REST = 'http://127.0.0.1:54321/rest/v1';
const run = randomUUID().slice(0, 6);
const ORG = randomUUID();
const SLUG = `credits-${run}`;
const NOVA = randomUUID();
const NOVA_EP = randomUUID();
const OTHER_EP = randomUUID();
const MIDNIGHT = randomUUID();
const ELSEWHERE = randomUUID();
const PRODUCER_TRACK = randomUUID();

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

/** A PostgREST read with the member's OWN token, the way their browser would: RLS decides. */
async function readAs(request: APIRequestContext, who: { id: string; email: string } | null, p: string) {
  const res = await request.fetch(`${REST}/${p}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${who ? userToken(who.id, who.email) : ANON_KEY}` },
  });
  expect(res.ok(), `${p}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>[];
}

async function as(browser: Browser, baseURL: string, id: string, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const c = sessionCookie(id, email);
  await ctx.addCookies([{ name: c.name, value: c.value, url: baseURL }]);
  return ctx;
}

const producer = { id: PRODUCER_ID, email: 'producer@local.test' };
const external = { id: BUYER_ID, email: 'buyer@local.test' };
const ownLine = { id: ARTIST_A_ID, email: 'artist-a@local.test' };
const marketing = { id: ARTIST_B_ID, email: 'artist-b@local.test' };

const credits = `/api/org/${ORG}/tracks/${MIDNIGHT}/credits`;
type CreditJson = { id: string; name: string; status: string; mine: boolean; party: { legal?: { ipi: string | null } } | null };
type Event = { verb: string; audit: boolean; actor_id: string | null; visibility: string; payload: Record<string, unknown>; song_id: string | null };
const events = async (request: APIRequestContext, verb: string) =>
  (await rest(request, 'GET', `activity_events?select=verb,audit,actor_id,visibility,payload,song_id&org_id=eq.${ORG}&verb=eq.${verb}&order=created_at`)) as Event[];
const creditRows = async (request: APIRequestContext) =>
  (await rest(request, 'GET', `track_collaborators?select=id,name,role,scope,status,party_id,org_id,created_by,confirmed_by,source&track_id=eq.${MIDNIGHT}&order=created_at`)) as {
    id: string; name: string; role: string; scope: string; status: string; party_id: string | null; org_id: string | null; created_by: string | null; confirmed_by: string | null; source: string;
  }[];

let novaParty = '';

test.beforeAll(async ({ request }) => {
  const users = [BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',');
  await rest(request, 'DELETE', `org_members?user_id=in.(${users})`);
  await rest(request, 'DELETE', `project_members?user_id=in.(${users})`);
  await rest(request, 'POST', 'organizations', { id: ORG, name: `Credit Records ${run}`, slug: SLUG, kind: 'label', created_by: PRODUCER_ID });
  await rest(request, 'POST', 'org_members', [
    { org_id: ORG, user_id: PRODUCER_ID, role: 'owner', functions: [], scope: 'org', invited_by: null },
    { org_id: ORG, user_id: ARTIST_A_ID, role: 'member', functions: ['producer'], scope: 'org', invited_by: PRODUCER_ID },
    { org_id: ORG, user_id: ARTIST_B_ID, role: 'member', functions: ['marketing'], scope: 'org', invited_by: PRODUCER_ID },
  ]);
  await rest(request, 'POST', 'contacts', { id: NOVA, org_id: ORG, user_id: null, name: `Nova ${run}`, category: 'artist' });
  await rest(request, 'POST', 'projects', [
    { id: NOVA_EP, org_id: ORG, user_id: null, name: `Nova EP ${run}`, inbox_for_contact_id: NOVA },
    { id: OTHER_EP, org_id: ORG, user_id: null, name: `Other EP ${run}`, inbox_for_contact_id: null },
  ]);
  await rest(request, 'POST', 'tracks', [
    { id: MIDNIGHT, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Midnight ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${MIDNIGHT}.mp3` },
    { id: ELSEWHERE, org_id: ORG, user_id: null, created_by: PRODUCER_ID, title: `Elsewhere ${run}`, type: 'song', song_stage: 'in_review', audio_url: `/uploads/labelos-e2e-${ELSEWHERE}.mp3` },
  ]);
  await rest(request, 'POST', 'project_tracks', [
    { project_id: NOVA_EP, track_id: MIDNIGHT, position: 0 },
    { project_id: OTHER_EP, track_id: ELSEWHERE, position: 0 },
  ]);
  // The seed BUYER: an external CONTRIBUTOR on Nova's project only.
  await rest(request, 'POST', 'project_members', { org_id: ORG, project_id: NOVA_EP, user_id: BUYER_ID, role: 'contributor', allow_downloads: false, invited_by: PRODUCER_ID });
  // A producer-side track and credit, written exactly the way the producer app writes them (115).
  await rest(request, 'POST', 'tracks', { id: PRODUCER_TRACK, user_id: PRODUCER_ID, title: `Producer beat ${run}`, type: 'beat', audio_url: `/uploads/labelos-e2e-${PRODUCER_TRACK}.mp3` });
  await rest(request, 'POST', 'track_collaborators', { track_id: PRODUCER_TRACK, name: 'Wheezy', role: 'producer', source: 'manual' });
});

test.afterAll(async ({ request }) => {
  await rest(request, 'DELETE', `tracks?id=eq.${PRODUCER_TRACK}`);
  await rest(request, 'DELETE', `organizations?id=eq.${ORG}`);
  await rest(request, 'DELETE', `project_members?user_id=in.(${[BUYER_ID, ARTIST_A_ID, ARTIST_B_ID].join(',')})`);
});

test('1 · existing credits read unchanged: a producer credit has no org, party, scope — and is confirmed', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const res = await ctx.request.get(`/api/tracks/${PRODUCER_TRACK}/collaborators`);
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  // The producer route names its columns: the payload is byte-for-byte the shape it always had, none of the new ones.
  expect(Object.keys(rows[0]).sort()).toEqual(['contact_id', 'created_at', 'id', 'name', 'role', 'source', 'track_id']);
  expect(rows[0]).toMatchObject({ name: 'Wheezy', role: 'producer', source: 'manual', contact_id: null });
  // … and in the table the row carries no Label OS data: no org, no party, no scope, confirmed.
  expect(await rest(ctx.request, 'GET', `track_collaborators?select=org_id,party_id,scope,status,created_by,confirmed_by&track_id=eq.${PRODUCER_TRACK}`)).toEqual([
    { org_id: null, party_id: null, scope: null, status: 'confirmed', created_by: null, confirmed_by: null },
  ]);

  // The producer's own route still adds, links and removes exactly as before.
  const add = await ctx.request.post(`/api/tracks/${PRODUCER_TRACK}/collaborators`, { data: { name: 'Metro', role: 'feature' } });
  expect(add.status()).toBeLessThan(300);
  expect(await rest(ctx.request, 'GET', `track_collaborators?select=name,org_id,party_id,status&track_id=eq.${PRODUCER_TRACK}&order=name`)).toEqual([
    { name: 'Metro', org_id: null, party_id: null, status: 'confirmed' },
    { name: 'Wheezy', org_id: null, party_id: null, status: 'confirmed' },
  ]);

  // The producer's route cannot reach an org track's credits.
  const org = await ctx.request.get(`/api/tracks/${MIDNIGHT}/collaborators`);
  expect([403, 404]).toContain(org.status());
  // The database refuses to hang Label OS data on a producer credit.
  const bad = await ctx.request.fetch(`${REST}/track_collaborators`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    data: JSON.stringify({ track_id: PRODUCER_TRACK, name: 'Nope', role: 'writer', status: 'proposed' }),
  });
  expect(bad.status()).toBeGreaterThanOrEqual(400);
});

test('2 · the owner makes a party and proposes, then confirms, a credit — on the real page', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, producer.id, producer.email);
  const created = await ctx.request.post(`/api/org/${ORG}/parties`, {
    data: { display_name: `Nova ${run}`, legal_name: `Nova Okafor ${run}`, ipi: '00 987.654-321', pro: 'SACEM', pro_affiliation: 'affiliated', contact_id: NOVA },
  });
  expect(created.status()).toBe(201);
  const { party } = await created.json();
  novaParty = party.id;
  expect(party.legal).toMatchObject({ ipi: '00987654321' });
  expect(await rest(ctx.request, 'GET', `parties?select=ipi,org_id,created_by&id=eq.${novaParty}`)).toEqual([{ ipi: '00987654321', org_id: ORG, created_by: PRODUCER_ID }]);
  expect((await events(ctx.request, 'party.created')).map((e) => [e.actor_id, e.visibility])).toEqual([[PRODUCER_ID, 'internal']]);
  expect(JSON.stringify(await events(ctx.request, 'party.created'))).not.toContain('00987654321');

  const page = await ctx.newPage();
  await page.goto(`/o/${SLUG}/songs/${MIDNIGHT}`);
  const section = page.getByTestId('org-credits');
  await expect(section).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('credit-add').click();
  await page.getByRole('button', { name: /Rights holder/ }).click();
  await page.getByRole('option', { name: `Nova ${run}` }).click();
  await page.getByRole('button', { name: /Credit role/ }).click();
  await page.getByRole('option', { name: /Songwriter/ }).click();
  await page.getByTestId('credit-submit').click();

  const pill = section.getByTestId('credit-person').first();
  await expect(pill).toContainText(`Nova ${run}`, { timeout: 30_000 });
  await expect(pill).toHaveAttribute('data-status', 'proposed');
  await expect(section.getByTestId('credit-status')).toHaveText('proposed');

  await pill.click();
  await expect(page.getByTestId('credit-party')).toHaveText(`Rights holder: Nova ${run} (Nova Okafor ${run}) · IPI 00987654321 · SACEM`);
  await page.getByTestId('credit-confirm').click();
  await expect(pill).toHaveAttribute('data-status', 'confirmed', { timeout: 30_000 });

  const rows = await creditRows(ctx.request);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: `Nova ${run}`, role: 'songwriter', scope: 'composition', status: 'confirmed', party_id: novaParty, org_id: ORG, created_by: PRODUCER_ID, confirmed_by: PRODUCER_ID, source: 'manual' });
  expect((await events(ctx.request, 'credit.proposed')).map((e) => [e.actor_id, e.audit, e.visibility, e.song_id])).toEqual([[PRODUCER_ID, false, 'artist', MIDNIGHT]]);
  expect((await events(ctx.request, 'credit.confirmed')).map((e) => [e.actor_id, e.audit, e.visibility, e.song_id])).toEqual([[PRODUCER_ID, true, 'artist', MIDNIGHT]]);
  expect(JSON.stringify(await events(ctx.request, 'credit.confirmed'))).not.toContain('Okafor');
});

test('3 · ACCEPTANCE: an external member cannot propose a credit for someone else — and can for themselves', async ({ browser, baseURL }) => {
  const ctx = await as(browser, baseURL!, external.id, external.email);
  const api = ctx.request;
  const before = await creditRows(api);

  // They read their OWN lines only: Nova's credit, party, legal name and IPI are not theirs.
  const read = await api.get(credits);
  expect(read.status()).toBe(200);
  const body = await read.json();
  expect(body.me).toMatchObject({ reach: 'own', canPropose: true, canWrite: false });
  expect(body.credits).toEqual([]);
  expect(JSON.stringify(body)).not.toContain('Okafor');
  expect(JSON.stringify(body)).not.toContain('00987654321');

  for (const data of [
    { role: 'mixer', party_id: novaParty },
    { role: 'songwriter', name: `Nova ${run}` },
    { role: 'mixer', contact_id: NOVA },
    { role: 'mixer', party_id: novaParty, name: 'Anyone' },
  ]) {
    const res = await api.post(credits, { data });
    expect(res.status(), JSON.stringify(data)).toBe(403);
    expect((await res.json()).error).toBe('You can only propose a credit that names you');
  }
  expect(await creditRows(api)).toEqual(before);
  expect(await events(api, 'credit.proposed')).toHaveLength(1);

  // Naming themselves works: their own party is made, the credit waits.
  const ok = await api.post(credits, { data: { role: 'instrumentalist', role_detail: 'Rhodes' } });
  expect(ok.status()).toBe(201);
  const { credit } = (await ok.json()) as { credit: CreditJson };
  expect(credit).toMatchObject({ status: 'proposed', mine: true });
  const mine = (await rest(api, 'GET', `parties?select=id,user_id,display_name,org_id&org_id=eq.${ORG}&user_id=eq.${BUYER_ID}`)) as { user_id: string }[];
  expect(mine).toHaveLength(1);
  const rows = await creditRows(api);
  expect(rows.find((r) => r.id === credit.id)).toMatchObject({ role: 'instrumentalist', scope: 'recording', status: 'proposed', org_id: ORG, created_by: BUYER_ID, confirmed_by: null });

  // They cannot confirm what they proposed; they cannot touch Nova's credit at all (it is not theirs).
  expect((await api.patch(`${credits}/${credit.id}`, { data: { action: 'confirm' } })).status()).toBe(403);
  const novaCredit = rows.find((r) => r.role === 'songwriter')!;
  expect((await api.patch(`${credits}/${novaCredit.id}`, { data: { action: 'dispute' } })).status()).toBe(404);
  expect((await creditRows(api)).find((r) => r.id === novaCredit.id)!.status).toBe('confirmed');

  // Another project of the same org is not theirs: 404 for the song's credits.
  expect((await api.get(`/api/org/${ORG}/tracks/${ELSEWHERE}/credits`)).status()).toBe(404);
  // The party directory is not theirs.
  expect([403, 404]).toContain((await api.get(`/api/org/${ORG}/parties`)).status());
  expect([403, 404]).toContain((await api.post(`/api/org/${ORG}/parties`, { data: { display_name: 'Forged' } })).status());
});

test('4 · the owner confirms the external member’s credit (a second pair of eyes); who may decide what', async ({ browser, baseURL }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  const rows = await creditRows(owner.request);
  const theirs = rows.find((r) => r.role === 'instrumentalist')!;
  const res = await owner.request.patch(`${credits}/${theirs.id}`, { data: { action: 'confirm' } });
  expect(res.status()).toBe(200);
  expect((await creditRows(owner.request)).find((r) => r.id === theirs.id)).toMatchObject({ status: 'confirmed', confirmed_by: PRODUCER_ID });
  expect((await events(owner.request, 'credit.confirmed')).map((e) => e.actor_id)).toEqual([PRODUCER_ID, PRODUCER_ID]);
  expect((await owner.request.patch(`${credits}/${theirs.id}`, { data: { action: 'confirm' } })).status()).toBe(409);

  // The credited person disputes THEIR OWN credit, with a reason; it is an audit event.
  const ext = await as(browser, baseURL!, external.id, external.email);
  const dispute = await ext.request.patch(`${credits}/${theirs.id}`, { data: { action: 'dispute', note: 'it was a Wurlitzer' } });
  expect(dispute.status()).toBe(200);
  expect((await creditRows(owner.request)).find((r) => r.id === theirs.id)).toMatchObject({ status: 'disputed', confirmed_by: null });
  const disputed = await events(owner.request, 'credit.disputed');
  expect(disputed.map((e) => [e.actor_id, e.audit, e.visibility])).toEqual([[BUYER_ID, true, 'artist']]);
  expect(JSON.stringify(disputed)).not.toContain('Wurlitzer');
  expect((await rest(owner.request, 'GET', `track_collaborators?select=dispute_note&id=eq.${theirs.id}`))).toEqual([{ dispute_note: 'it was a Wurlitzer' }]);

  // Marketing (no rights ability) decides nothing.
  const mk = await as(browser, baseURL!, marketing.id, marketing.email);
  expect((await mk.request.patch(`${credits}/${theirs.id}`, { data: { action: 'confirm' } })).status()).toBe(403);
});

test('5 · the same rules at the database, with each member’s OWN JWT (RLS)', async ({ request }) => {
  // The owner (rights.read): every credit of the song, and the parties.
  const all = await readAs(request, producer, `track_collaborators?select=name,role,status&track_id=eq.${MIDNIGHT}&order=created_at`);
  expect(all.map((r) => r.role)).toEqual(['songwriter', 'instrumentalist']);
  expect((await readAs(request, producer, `parties?select=ipi&id=eq.${novaParty}`))).toEqual([{ ipi: '00987654321' }]);

  // The external member: not an org member — PostgREST shows them nothing.
  expect(await readAs(request, external, `track_collaborators?select=id&track_id=eq.${MIDNIGHT}`)).toEqual([]);
  expect(await readAs(request, external, 'parties?select=id')).toEqual([]);

  // Marketing: catalog.read but no rights ability — nothing.
  expect(await readAs(request, marketing, `track_collaborators?select=id&track_id=eq.${MIDNIGHT}`)).toEqual([]);
  expect(await readAs(request, marketing, 'parties?select=id')).toEqual([]);

  // An own line (producer function): only the credit whose party is theirs. None yet — they have no party.
  expect(await readAs(request, ownLine, `track_collaborators?select=id&track_id=eq.${MIDNIGHT}`)).toEqual([]);

  // Anon, and the API roles can write nothing.
  expect(await readAs(request, null, `track_collaborators?select=id&track_id=eq.${MIDNIGHT}`)).toEqual([]);
  const forged = await request.fetch(`${REST}/track_collaborators`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(producer.id, producer.email)}`, 'content-type': 'application/json' },
    data: JSON.stringify({ track_id: MIDNIGHT, name: 'Forged', role: 'mixer' }),
  });
  expect(forged.status()).toBeGreaterThanOrEqual(400);
  const forgedParty = await request.fetch(`${REST}/parties`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${userToken(producer.id, producer.email)}`, 'content-type': 'application/json' },
    data: JSON.stringify({ org_id: ORG, display_name: 'Forged' }),
  });
  expect(forgedParty.status()).toBeGreaterThanOrEqual(400);
});

test('6 · an own line reads its own credit and party — and nothing else', async ({ browser, baseURL, request }) => {
  const owner = await as(browser, baseURL!, producer.id, producer.email);
  // The owner credits the producer-function member through a party linked to their account.
  const p = await owner.request.post(`/api/org/${ORG}/parties`, { data: { display_name: `Ada Producer ${run}`, legal_name: 'Ada Lovelace', ipi: '00111111111', user_id: ownLine.id } });
  expect(p.status()).toBe(201);
  const { party } = await p.json();
  const c = await owner.request.post(credits, { data: { role: 'producer', party_id: party.id } });
  expect(c.status()).toBe(201);

  // Through the app: only their line, and their own legal data.
  const ctx = await as(browser, baseURL!, ownLine.id, ownLine.email);
  const read = await (await ctx.request.get(credits)).json();
  expect(read.me.reach).toBe('own');
  expect(read.credits.map((x: CreditJson) => x.name)).toEqual([`Ada Producer ${run}`]);
  expect(read.credits[0].party.legal).toMatchObject({ ipi: '00111111111' });
  expect(JSON.stringify(read)).not.toContain('Okafor');
  const dir = await (await ctx.request.get(`/api/org/${ORG}/parties`)).json();
  expect(dir.parties.map((x: { displayName: string }) => x.displayName)).toEqual([`Ada Producer ${run}`]);
  expect((await ctx.request.post(`/api/org/${ORG}/parties`, { data: { display_name: 'Forged' } })).status()).toBe(403);
  expect((await ctx.request.post(credits, { data: { role: 'mixer', party_id: novaParty } })).status()).toBe(403);

  // And straight from PostgREST with their own JWT: the same.
  const rows = await readAs(request, ownLine, `track_collaborators?select=name,role&track_id=eq.${MIDNIGHT}`);
  expect(rows).toEqual([{ name: `Ada Producer ${run}`, role: 'producer' }]);
  expect(await readAs(request, ownLine, 'parties?select=display_name')).toEqual([{ display_name: `Ada Producer ${run}` }]);

  // They confirm the credit the owner proposed for them.
  const rowsAll = await creditRows(owner.request);
  const mine = rowsAll.find((r) => r.role === 'producer')!;
  expect((await ctx.request.patch(`${credits}/${mine.id}`, { data: { action: 'confirm' } })).status()).toBe(200);
  expect((await creditRows(owner.request)).find((r) => r.id === mine.id)).toMatchObject({ status: 'confirmed', confirmed_by: ownLine.id });
});
