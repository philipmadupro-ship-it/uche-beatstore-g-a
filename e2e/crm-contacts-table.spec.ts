import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';
import { makeContacts, makeSends } from './fixtures/crm-contacts';

/**
 * The CRM contact list (RAM-01 / RAM-02). Every API is stubbed, so this needs
 * no database. It covers the common workflows — find a contact, open it, send
 * (role preset, drag a track onto a row), see what was sent, change the role
 * and rename in place — plus the structural rules of the row (no button inside
 * a button, every control named) and a dense (5) versus large (500) list at
 * 1440 and 390 with no horizontal overflow.
 */
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day).toISOString();
const TRACKS = [1, 2, 3].map((i) => ({ id: `t${i}`, title: ['Night Shift', 'Cold Front', 'Late Add'][i - 1], type: i === 3 ? 'loop' : 'beat', bpm: 140, key: 'F', scale: 'minor', cover_url: null, status: 'finished', duration_seconds: 150, created_at: ago(20), track_tags: [] }));

type C = ReturnType<typeof makeContacts>[number];
let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });
test.beforeEach(async ({ context, baseURL }) => { if (stub) await context.addCookies([signInCookie(baseURL!)]); });

const FIXTURE: C[] = [
  { id: 'c-nova', name: 'Nova Vale', email: 'nova@example.com', category: 'producer', secondary_category: 'artist', crm_status: 'engaged', tags: [], created_at: ago(40), role: null, label: null, buyer_pipeline_status: null },
  { id: 'c-press', name: 'Pia Press', email: 'pia@example.com', category: 'press', secondary_category: null, crm_status: null, tags: [], created_at: ago(30), role: null, label: null, buyer_pipeline_status: null },
  { id: 'c-ar', name: 'Ada Label', email: 'ada@example.com', category: 'a&r', secondary_category: null, crm_status: 'prospect', tags: [], created_at: ago(20), role: null, label: null, buyer_pipeline_status: null },
] as C[];

const SENDS = [
  { id: 's1', contact_id: 'c-press', track_ids: ['t1', 't2'], share_token: 'a', message: '', status: 'sent', sent_at: ago(2), opened_at: ago(1), link_clicked_at: null },
  { id: 's2', contact_id: 'c-press', track_ids: ['t3'], share_token: 'b', message: '', status: 'sent', sent_at: ago(30), opened_at: null, link_clicked_at: null },
];

async function stubApis(page: Page, contacts: C[], sends: unknown[], patches: unknown[] = []) {
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/api/contacts') return route.fulfill({ json: contacts });
    if (p === '/api/beat_sends') return route.fulfill({ json: { sends } });
    if (p === '/api/contacts/scores') return route.fulfill({ json: { scores: {} } });
    if (p === '/api/contacts/segments') return route.fulfill({ json: { segments: [] } });
    if (p === '/api/contacts/artists') return route.fulfill({ json: { schemaReady: true, artists: [] } });
    if (p === '/api/contacts/roles') return route.fulfill({ json: { contacts: [] } });
    if (p === '/api/tracks') return route.fulfill({ json: TRACKS });
    if (p === '/api/projects') return route.fulfill({ json: { projects: [] } });
    if (p === '/api/campaigns') return route.fulfill({ json: { campaigns: [] } });
    if (p === '/api/email') return route.fulfill({ json: { fromEmail: 'hello@example.com', producerName: 'Uche' } });
    if (p === '/api/beat_sends/duplicates') return route.fulfill({ json: { duplicates: [] } });
    const m = p.match(/^\/api\/contacts\/([^/]+)$/);
    if (m && req.method() === 'PATCH') { patches.push({ id: m[1], ...req.postDataJSON() }); return route.fulfill({ json: { contact: {} } }); }
    if (m) return route.fulfill({ json: { contact: contacts.find((c) => c.id === m[1]) ?? contacts[0] } });
    if (/\/workspace$/.test(p)) return route.fulfill({ json: { schemaReady: false, workspaceMode: false } });
    return route.fulfill({ json: { items: [], activity: [], tasks: [], summary: {} } });
  });
}

/** The server render sees an empty stub database, so load the list with the toolbar's Refresh. */
async function openList(page: Page, tab: 'network' | 'producers' = 'network') {
  await page.addInitScript((t) => { try { localStorage.setItem('contacts.view', t); } catch { /* */ } }, tab);
  await page.goto('/contacts');
  // A click before hydration is lost, so press Refresh until the rows arrive.
  await expect(async () => {
    await page.getByTitle('Refresh').click();
    await expect(page.getByTestId('contact-row').first()).toBeVisible({ timeout: 2500 });
  }).toPass({ timeout: 25_000 });
}
const row = (page: Page, name: string) => page.getByTestId('contact-row').filter({ hasText: name });

test('find a contact, read its role and what was sent, open it', async ({ page }) => {
  await stubApis(page, FIXTURE, SENDS);
  await openList(page);
  const pia = row(page, 'Pia Press');
  await expect(pia).toBeVisible();
  // The ROLE leads; the derived "sent music" kind is only a tooltip on the sent column, never an "Artist" badge.
  await expect(pia).toContainText('Press');
  await expect(pia).not.toContainText('Has been sent music');
  await expect(pia.getByTitle('Has been sent music')).toHaveCount(1);
  await expect(pia).not.toContainText(/^Artist$/);
  await expect(pia).toContainText('2 sends · 3 tracks');
  await expect(pia).toContainText('Opened');

  await page.getByLabel(/Search contacts/).fill('pia');
  await expect(page.getByTestId('contact-row')).toHaveCount(1);
  // The whole row is the open target, not just the name.
  await pia.getByRole('link', { name: 'Open Pia Press' }).click({ position: { x: 300, y: 10 } });
  await expect(page).toHaveURL(/\/contacts\/c-press$/);
});

test('the send button follows the role, and the menu offers every send for it', async ({ page }) => {
  await stubApis(page, FIXTURE, SENDS);
  await openList(page, 'producers');
  // A producer is offered loops; with "also Artist" the menu offers beats too.
  await expect(page.getByRole('button', { name: 'Send loops to Nova Vale' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Nova Vale' }).click();
  await expect(page.getByRole('menuitem', { name: 'Send loops' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Send beats' }).click();
  await expect(page.getByText('Send to contact')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Send loops to Nova Vale' }).click();
  await expect(page.getByText('Send to contact')).toBeVisible();
});

test('everyone else is offered plain tracks', async ({ page }) => {
  await stubApis(page, FIXTURE, SENDS);
  await openList(page);
  await expect(page.getByRole('button', { name: 'Send tracks to Pia Press' })).toBeVisible();
});

test('change role from the menu: PATCHes the category and says where it went', async ({ page }) => {
  const patches: unknown[] = [];
  await stubApis(page, FIXTURE, SENDS, patches);
  await openList(page);
  await page.getByRole('button', { name: 'More actions for Pia Press' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Producer' }).click();
  await expect.poll(() => patches).toContainEqual({ id: 'c-press', category: 'producer' });
  await expect(page.getByText(/shows under Producers/)).toBeVisible();
  // It now belongs to the Producers tab, so it leaves Other contacts.
  await expect(row(page, 'Pia Press')).toHaveCount(0);
});

test('rename in place from the menu', async ({ page }) => {
  const patches: unknown[] = [];
  await stubApis(page, FIXTURE, SENDS, patches);
  await openList(page);
  await page.getByRole('button', { name: 'More actions for Pia Press' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = page.getByRole('textbox', { name: /name of Pia Press/ });
  await input.fill('Pia Records');
  await input.press('Enter');
  await expect.poll(() => patches).toContainEqual({ id: 'c-press', name: 'Pia Records' });
  await expect(row(page, 'Pia Records')).toBeVisible();
});

test('dragging a track onto a contact opens the send modal with that track', async ({ page }) => {
  await stubApis(page, FIXTURE, SENDS);
  await openList(page);
  const target = row(page, 'Pia Press');
  await target.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('application/x-antigravity-track', JSON.stringify({ kind: 'track', id: 't1', title: 'Night Shift' }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText('Send to contact')).toBeVisible();
  // The dragged track is already ticked.
  await expect(page.getByText('1 track', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Night Shift').first()).toBeVisible();
});

test('rows nest nothing inside a button or link and every control has a name', async ({ page }) => {
  await stubApis(page, FIXTURE, SENDS);
  await openList(page);
  await expect(page.locator('[data-testid="contact-row"] button button, [data-testid="contact-row"] a button, [data-testid="contact-row"] a a, [data-testid="contact-row"] button a')).toHaveCount(0);
  const unnamed = await page.getByTestId('contact-row').evaluateAll((rows) => rows.flatMap((r) =>
    [...r.querySelectorAll('a, button, [role="combobox"]')].filter((el) => {
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
      return !name;
    }).map((el) => el.outerHTML.slice(0, 80))));
  expect(unnamed).toEqual([]);
});

test('contact page: sent-to list, role-following send, role in the header, view all', async ({ page }) => {
  await stubApis(page, FIXTURE, SENDS);
  await page.goto('/contacts/c-press');
  const sent = page.getByTestId('contact-sent-list');
  await expect(sent).toContainText('Night Shift +1');
  await expect(sent).toContainText('Opened');
  await expect(page.getByTestId('contact-role-line')).toContainText('Press');
  await expect(page.getByRole('button', { name: 'Send tracks to Pia Press' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Change role' }).or(page.getByRole('button', { name: 'Change role' }))).toBeVisible();

  await page.getByRole('link', { name: /View all 2 sends to Pia Press/ }).click();
  await expect(page).toHaveURL(/tab=activity&contact=c-press/);
  await expect(page.getByText(/Showing sends to/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show everyone' })).toBeVisible();
});

for (const w of [1440, 390]) {
  test.describe(`dense and large lists at ${w}`, () => {
    test.use({ viewport: { width: w, height: 900 } });
    for (const n of [5, 500]) {
      test(`${n} contacts: fits the width, ${n > 50 ? 'pages at 50' : 'shows all'}`, async ({ page }) => {
        const contacts = makeContacts(n).map((c, i) => ({ ...c, category: ['buyer', 'friend', 'press', 'other'][i % 4], secondary_category: null })) as C[];
        await stubApis(page, contacts, makeSends(contacts as ReturnType<typeof makeContacts>));
        await openList(page);
        await expect(page.getByTestId('contact-row')).toHaveCount(Math.min(n, 50));
        if (n > 50) await expect(page.getByText(`of ${n}`).first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        // A row stays one compact line or two, never a card wall.
        const h = await page.getByTestId('contact-row').first().evaluate((el) => el.getBoundingClientRect().height);
        expect(h).toBeLessThan(w === 390 ? 110 : 80);
      });
    }
  });
}

test.describe('chrome above the list at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('stats and Pipeline are one line, the filter row starts at Category, the sub-line has no kind hint', async ({ page }) => {
    await stubApis(page, FIXTURE, SENDS);
    await page.addInitScript(() => { try { localStorage.setItem('contacts.view', 'network'); } catch { /* */ } });
    await page.goto('/contacts');
    // Before anything is loaded or pressed, the filter row is at its start with Category fully inside the gutter.
    const filters = page.getByRole('button', { name: /^Category/ });
    await expect(filters).toBeVisible();
    const start = await filters.evaluate((el) => {
      const row = el.closest('.overflow-x-auto') as HTMLElement;
      return { scroll: row.scrollLeft, left: el.getBoundingClientRect().left, search: (document.querySelector('input[aria-label^="Search contacts"]') as HTMLElement).getBoundingClientRect().left };
    });
    expect(start.scroll).toBe(0);
    expect(Math.round(start.left)).toBe(Math.round(start.search));
    await openList(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const bar = page.getByRole('button', { name: 'Send pipeline' }).locator('..');
    expect((await bar.boundingBox())!.height).toBeLessThan(40);
    await expect(bar).toContainText('to nudge');
    // The kind hint is not printed in the row text (it lives in the sent column's tooltip and on the contact page).
    await expect(row(page, 'Pia Press')).not.toContainText(/Has been sent music/i);
  });
});
