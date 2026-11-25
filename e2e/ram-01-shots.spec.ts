import { test, type Page } from '@playwright/test';
import { makeContacts, makeSends } from './fixtures/crm-contacts';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * RAM-01 review screenshots (CRM). Everything is stubbed; writes PNGs to
 * RAM01_SHOTS/<phase> when RAM01_SHOTS is set, otherwise skipped.
 */
test.skip(!process.env.RAM01_SHOTS, 'screenshot run only');
const OUT = process.env.RAM01_SHOTS ?? '';
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day).toISOString();

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => { if (stubSupabaseConfigured()) stub = await startStubSupabase(); });
test.afterAll(async () => { await stub?.close(); });

const TRACKS = [1, 2, 3].map((i) => ({ id: `t${i}`, title: ['Night Shift', 'Cold Front', 'Late Add'][i - 1], type: i === 3 ? 'loop' : 'beat', bpm: 140 - i * 10, key: 'F', scale: 'minor', cover_url: null, status: 'finished', duration_seconds: 150, created_at: ago(20), track_tags: [] }));

async function stubApis(page: Page, contacts: ReturnType<typeof makeContacts>, artists = true) {
  const sends = makeSends(contacts);
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/contacts') return route.fulfill({ json: contacts });
    if (p === '/api/beat_sends') return route.fulfill({ json: { sends } });
    if (p === '/api/contacts/scores') return route.fulfill({ json: { scores: {} } });
    if (p === '/api/contacts/segments') return route.fulfill({ json: { segments: [] } });
    if (p === '/api/contacts/artists') {
      const picks = artists ? contacts.filter((c) => ['artist', 'rapper'].includes(c.category)).slice(0, 4) : [];
      return route.fulfill({ json: { schemaReady: true, artists: picks.map((c, i) => ({
        contact: { id: c.id, name: c.name, avatar_url: null },
        relationship: { stage: ['new', 'contacted', 'engaged', 'interested'][i % 4], parked: null },
        activeProject: { id: `p${i}`, name: `Project ${i + 1}`, cover_url: null }, projectCount: 1 + i, projectNames: [`Project ${i + 1}`],
        decisions: { interested: i }, moving: i, plays: 10 * i, downloads: i, portal: { live: true, lastViewedAt: ago(i + 1) }, notifyCount: i,
      })) } });
    }
    if (p === '/api/contacts/roles') {
      const group = new URL(route.request().url()).searchParams.get('group');
      const cats = group === 'label' ? ['a&r', 'label', 'manager'] : ['producer', 'engineer'];
      return route.fulfill({ json: { contacts: contacts.filter((c) => cats.includes(c.category)).slice(0, 5).map((c, i) => ({ contact: { id: c.id, name: c.name, email: c.email, avatar_url: null, category: c.category, secondary_category: null }, sent: { loops: 2 + i, toplines: i, beats: 1, songs: 0, packs: i % 2 }, lastSentAt: ago(3 + i), credited: { total: i, loops: 0 } })) } });
    }
    if (p === '/api/contacts/followups' || p.startsWith('/api/contacts/tasks')) return route.fulfill({ json: { tasks: [], items: [] } });
    if (p === '/api/tracks') return route.fulfill({ json: TRACKS });
    if (p === '/api/projects') return route.fulfill({ json: { projects: [] } });
    if (p === '/api/campaigns') return route.fulfill({ json: { campaigns: [] } });
    if (p === '/api/email') return route.fulfill({ json: { fromEmail: 'hello@example.com', producerName: 'Uche' } });
    if (p === '/api/beat_sends/duplicates') return route.fulfill({ json: { duplicates: [] } });
    const m = p.match(/^\/api\/contacts\/([^/]+)$/);
    if (m) return route.fulfill({ json: { contact: contacts.find((c) => c.id === m[1]) ?? contacts[0] } });
    if (/\/workspace$/.test(p)) return route.fulfill({ json: { schemaReady: false, workspaceMode: false } });
    if (/activity|timeline|tasks|comments|messages/.test(p)) return route.fulfill({ json: { items: [], activity: [], tasks: [], summary: {} } });
    return route.fulfill({ json: {} });
  });
}

const TAB_NAME: Record<string, RegExp> = { artists: /^Artists/, producers: /^Producers/, labels: /^Labels/, network: /^Other contacts/ };
async function openContacts(page: Page, tab: string) {
  // The server render sees an empty stub database, so load the list through the toolbar's Refresh (network tab), then switch tab.
  await page.addInitScript(() => { try { localStorage.setItem('contacts.view', 'network'); } catch { /* */ } });
  await page.goto('/contacts');
  await page.getByTitle('Refresh').click();
  await page.waitForTimeout(1000);
  if (tab !== 'network') await page.getByRole('button', { name: TAB_NAME[tab] }).click();
  await page.waitForTimeout(800);
}

const sizes = [{ w: 1440, h: 900 }, { w: 390, h: 844 }];
for (const { w, h } of sizes) {
  test.describe(`${w}`, () => {
    test.use({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    test.beforeEach(async ({ context, baseURL }) => { if (stub) await context.addCookies([signInCookie(baseURL!)]); });
    const shot = (page: Page, name: string, full = true) => page.screenshot({ path: `${OUT}/${process.env.RAM01_PHASE ?? 'before'}/${name}-${w}.png`, fullPage: full });

    for (const tab of ['artists', 'producers', 'labels', 'network']) {
      test(`tab ${tab}`, async ({ page }) => {
        await stubApis(page, makeContacts(24));
        await openContacts(page, tab);
        await shot(page, `contacts-${tab}`);
      });
    }
    test('dense 5 and large 500', async ({ page }) => {
      await stubApis(page, makeContacts(5), false);
      await openContacts(page, 'network');
      await shot(page, 'contacts-network-5');
      await page.unroute('**/api/**');
      await stubApis(page, makeContacts(500), false);
      await page.getByTitle('Refresh').click();
      await page.waitForTimeout(1200);
      await shot(page, 'contacts-network-500', false);
    });
    test('workspace contact page', async ({ page }) => {
      const contacts = makeContacts(24);
      await stubApis(page, contacts);
      const base = {
        schemaReady: true, workspaceMode: true,
        relationship: { stage: 'working_together', parked: null },
        portal: { id: 'p1', token: 'tok123', url: 'http://localhost:3457/artist/tok123', password_hash: null, hasPassword: false, revoked_at: null, last_viewed_at: ago(1), previous_viewed_at: ago(5), view_count: 12, created_at: ago(40), auto_digest: false, require_sign_in: false },
        notify: { count: 2, tracks: 2, files: 0, projects: 1 },
        projects: [{ id: 'p1', name: 'Project 1', cover_url: null, status: 'active', description: null, link: { project_id: 'p1', role: null, in_portal: true, allow_downloads: true, can_comment: true, last_notified_at: ago(3), created_at: ago(30) }, trackCount: 2, beats: 2, songs: 0, newForArtist: 1 }],
        beats: [], songs: [], files: [], trackFiles: [],
        totals: { plays: 14, downloads: 2, portalVisits: 12 }, filesReady: true,
        messages: { ready: true, unread: 0, openRequests: 0 },
        counts: { interested: 1, selected: 0, recording: 0, recorded: 0, released: 0, passed: 0, moving: 1 },
      };
      await page.route('**/api/contacts/*/workspace', (route) => route.fulfill({ json: base }));
      await page.goto(`/contacts/${contacts[1].id}`);
      await page.waitForTimeout(2000);
      await shot(page, 'contact-workspace');
    });
    test('contact page + send modal', async ({ page }) => {
      const contacts = makeContacts(24);
      await stubApis(page, contacts);
      await page.goto(`/contacts/${contacts[1].id}`);
      await page.waitForTimeout(1500);
      await shot(page, 'contact-page');
      await page.getByRole('button', { name: /send/i }).first().click();
      await page.waitForTimeout(1200);
      await shot(page, 'send-modal', false);
    });
  });
}
