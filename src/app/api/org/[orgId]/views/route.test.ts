/**
 * /api/org/[orgId]/views, /views/[viewId] and /views/run (LABEL-37) through the
 * REAL org-access, the real stores and the real rules, against the in-memory
 * fixture of mocks/filters-fixture.ts (the catalogue of the seven 08 §A2
 * queries). What is proved here, as different members:
 *
 *   - saving: personal needs catalog.read, sharing catalog.write, a clause the
 *     saver's role cannot read is refused, names are unique per author;
 *   - events: view.created / updated / deleted, carrying neither the name nor
 *     any filter;
 *   - a SHARED view is recomputed per viewer: an unscoped owner's "missing
 *     artwork" shows a Kilo-scoped member only Kilo's songs;
 *   - a shared view that names an artist outside a scoped member's reach is
 *     not listed to them and cannot be run by id (404), and the definition
 *     they are shown never carries the ids they may not see;
 *   - change / delete rights: the author; an admin only takes a shared one down;
 *     a personal view of someone else does not exist for anyone (404).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { AR, AR_K, C1, C2, L, MKT, OWN, ADM, PROD, STRANGER, S1, S2, S4, filtersDb } from '@/lib/labelos/mocks/filters-fixture';
import { encodeDefinition, type Definition } from '@/lib/labelos/filters';

let current: string | null = null;
let db: MemoryDb;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  current = null;
  db = filtersDb();
  db.unique = { org_saved_views: [['org_id', 'subject', 'created_by', 'name']] };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(as: string | null, mod: 'list' | 'item' | 'run', method: string, opts: { id?: string; body?: unknown; query?: string } = {}) {
  current = as;
  const path = mod === 'list' ? './route' : mod === 'item' ? './[viewId]/route' : './run/route';
  const m = (await import(/* @vite-ignore */ path)) as Record<string, Handler>;
  const base = `https://app.test/api/org/${L}/views${mod === 'item' ? `/${opts.id}` : mod === 'run' ? '/run' : ''}${opts.query ?? ''}`;
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const req = new NextRequest(base, { method, ...(hasBody ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) } : {}) });
  const res = await m[method](req, { params: Promise.resolve({ orgId: L, ...(opts.id ? { viewId: opts.id } : {}) }) });
  return { status: res.status, body: await res.json() };
}

const songs = (filter: object): Definition => ({ v: 1, subject: 'songs', filter }) as Definition;
const MISSING = songs({ missing: ['artwork'] });
const save = (as: string, name: string, definition: Definition, shared = false) => call(as, 'list', 'POST', { body: { subject: definition.subject, name, definition, shared } });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const events = () => db.tables.activity_events.map((e) => e.verb as string);

describe('saving', () => {
  it('a personal view needs only catalog.read, a shared one catalog.write', async () => {
    expect((await save(MKT, 'Mine', MISSING)).status).toBe(201);
    const shared = await save(MKT, 'Team', MISSING, true);
    expect(shared.status).toBe(403);
    expect((await save(AR, 'Team', MISSING, true)).status).toBe(201);
  });

  it('outsiders are refused before anything is read or written', async () => {
    expect((await save(STRANGER, 'x', MISSING)).status).toBe(403);
    expect((await call(null, 'list', 'GET')).status).toBe(401);
    expect(db.tables.org_saved_views).toHaveLength(0);
  });

  it('refuses a clause the saver’s role cannot read, a malformed definition and a wrong subject', async () => {
    const credits = songs({ credits: [{ roles: ['producer'] }] });
    const r = await save(PROD, 'Producers', credits);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/credits/);
    expect((await call(AR, 'list', 'POST', { body: { subject: 'songs', name: 'bad', definition: { v: 1, subject: 'songs', filter: { stages: ['nope'] } } } })).status).toBe(400);
    expect((await call(AR, 'list', 'POST', { body: { subject: 'releases', name: 'wrong', definition: MISSING } })).status).toBe(400);
    expect(db.tables.org_saved_views).toHaveLength(0);
  });

  it('a name is unique per author, not per org', async () => {
    expect((await save(AR, 'Same', MISSING)).status).toBe(201);
    expect((await save(AR, 'Same', MISSING)).status).toBe(409);
    expect((await save(OWN, 'Same', MISSING)).status).toBe(201);
  });

  it('records view.created with neither the name nor the filter', async () => {
    await save(AR, 'Secret plans for Nova', songs({ artistIds: [C1] }), true);
    expect(events()).toEqual(['view.created']);
    const e = db.tables.activity_events[0];
    expect(e).toMatchObject({ org_id: L, actor_id: AR, subject_type: 'view', visibility: 'internal', audit: false });
    expect(JSON.stringify(e)).not.toMatch(/Secret|Nova|artistIds|C1/);
    expect(e.payload).toEqual({ subject: 'songs', shared: true });
    // and it names no artist, project or song, so a scoped member’s feed never carries it
    expect(e.artist_id ?? null).toBeNull();
    expect(e.project_id ?? null).toBeNull();
  });
});

describe('a shared view is recomputed for each viewer', () => {
  it('the owner’s "missing artwork" shows a Kilo-scoped member only Kilo’s songs', async () => {
    const made = await save(OWN, 'Missing artwork', MISSING, true);
    const id = made.body.view.id;
    const owner = await call(OWN, 'run', 'GET', { query: `?view=${id}` });
    expect(ids(owner.body.result.rows)).toEqual([S1, S2, S4].sort());
    const scoped = await call(AR_K, 'run', 'GET', { query: `?view=${id}` });
    expect(scoped.status).toBe(200);
    expect(ids(scoped.body.result.rows)).toEqual([S2]);
    expect(scoped.body.result.total).toBe(1);
    expect(JSON.stringify(scoped.body)).not.toMatch(/Nova|Home|Tasked/);
  });

  it('the list shows a scoped member the views they may run, never those that name artists beyond them', async () => {
    await save(OWN, 'Missing artwork', MISSING, true);
    await save(OWN, 'Nova work', songs({ artistIds: [C1], missing: ['artwork'] }), true);
    await save(OWN, 'Both artists', songs({ artistIds: [C1, C2] }), true);
    await save(OWN, 'Kilo work', songs({ artistIds: [C2] }), true);
    await save(OWN, 'My private one', songs({ stages: ['inbox'] }), false);

    const owner = await call(OWN, 'list', 'GET', { query: '?subject=songs' });
    expect(owner.body.views.map((v: { name: string }) => v.name)).toEqual(['Both artists', 'Kilo work', 'Missing artwork', 'My private one', 'Nova work']);
    expect(owner.body.names.artists).toMatchObject({ [C1]: 'Nova', [C2]: 'Kilo' });

    const scoped = await call(AR_K, 'list', 'GET', { query: '?subject=songs' });
    expect(scoped.body.views.map((v: { name: string }) => v.name)).toEqual(['Kilo work', 'Missing artwork']);
    // nothing of Nova in the whole answer: not a name, not an id
    expect(JSON.stringify(scoped.body)).not.toMatch(new RegExp(`Nova|${C1}`));
    expect(scoped.body.names.artists).toEqual({ [C2]: 'Kilo' });
  });

  it('a view hidden from a scoped member cannot be run by id (404), and an ad-hoc filter naming Nova gives them nothing of hers', async () => {
    const hidden = (await save(OWN, 'Nova work', songs({ artistIds: [C1] }), true)).body.view.id;
    expect((await call(AR_K, 'run', 'GET', { query: `?view=${hidden}` })).status).toBe(404);
    const adhoc = await call(AR_K, 'run', 'GET', { query: `?f=${encodeDefinition(songs({ artistIds: [C1] }))}` });
    expect(adhoc.status).toBe(200);
    expect(adhoc.body.result.rows).toEqual([]);
    // the definition echoed back has the artist they may not see dropped
    expect(JSON.stringify(adhoc.body.definition)).not.toContain(C1);
    expect(adhoc.body.narrowed).toBe(true);
  });

  it('a personal view is nobody else’s — listed, run or touched', async () => {
    const mine = (await save(AR, 'Private', MISSING)).body.view.id;
    expect((await call(OWN, 'list', 'GET')).body.views).toEqual([]);
    expect((await call(OWN, 'run', 'GET', { query: `?view=${mine}` })).status).toBe(404);
    expect((await call(ADM, 'item', 'PATCH', { id: mine, body: { shared: false } })).status).toBe(404);
    expect((await call(ADM, 'item', 'DELETE', { id: mine })).status).toBe(404);
    expect(db.tables.org_saved_views).toHaveLength(1);
  });

  it('a member whose role cannot read the clauses gets no rows and is told which', async () => {
    const view = (await save(AR, 'Producers', songs({ credits: [{ roles: ['producer'] }] }), true)).body.view.id;
    const own = await call(AR, 'run', 'GET', { query: `?view=${view}` });
    expect(own.body.result.rows.length).toBe(1);
    const producer = await call(PROD, 'run', 'GET', { query: `?view=${view}` });
    expect(producer.status).toBe(200);
    expect(producer.body.result).toMatchObject({ rows: [], total: 0, unavailable: ['credits'] });
  });
});

describe('changing and deleting', () => {
  it('the author edits their own view; the event lists what changed, not the new text', async () => {
    const id = (await save(AR, 'Old name', MISSING)).body.view.id;
    const r = await call(AR, 'item', 'PATCH', { id, body: { name: 'New name', definition: songs({ stages: ['inbox'] }) } });
    expect(r.status).toBe(200);
    expect(r.body.view).toMatchObject({ name: 'New name', mine: true, canEdit: true });
    expect(events()).toEqual(['view.created', 'view.updated']);
    expect(db.tables.activity_events[1].payload).toEqual({ subject: 'songs', changed: ['name', 'definition'], shared: false });
    expect(JSON.stringify(db.tables.activity_events)).not.toMatch(/New name|Old name|inbox/);
  });

  it('only the author edits; a reader of a shared view is told 403', async () => {
    const id = (await save(AR, 'Team view', MISSING, true)).body.view.id;
    expect((await call(MKT, 'item', 'PATCH', { id, body: { name: 'mine now' } })).status).toBe(403);
    expect((await call(MKT, 'item', 'DELETE', { id })).status).toBe(403);
    expect(db.tables.org_saved_views[0].name).toBe('Team view');
  });

  it('an admin takes a shared view down or deletes it, and cannot rewrite it', async () => {
    const id = (await save(AR, 'Team view', MISSING, true)).body.view.id;
    expect((await call(ADM, 'item', 'PATCH', { id, body: { name: 'x' } })).status).toBe(403);
    expect((await call(ADM, 'item', 'PATCH', { id, body: { shared: false } })).status).toBe(200);
    expect(db.tables.org_saved_views[0].shared).toBe(false);
    // now personal: the admin no longer knows it exists
    expect((await call(ADM, 'item', 'DELETE', { id })).status).toBe(404);
    const id2 = (await save(AR, 'Other', MISSING, true)).body.view.id;
    expect((await call(ADM, 'item', 'DELETE', { id: id2 })).status).toBe(200);
    expect(events().filter((v) => v === 'view.deleted')).toHaveLength(1);
  });

  it('the author cannot share without catalog.write, and a rights clause is re-checked on edit', async () => {
    const id = (await save(MKT, 'Mine', MISSING)).body.view.id;
    expect((await call(MKT, 'item', 'PATCH', { id, body: { shared: true } })).status).toBe(403);
    expect((await call(MKT, 'item', 'PATCH', { id, body: { definition: songs({ splits: 'incomplete' }) } })).status).toBe(403);
  });

  it('an unknown id and a bad id are 404', async () => {
    expect((await call(OWN, 'item', 'DELETE', { id: '90000000-0000-4000-8000-000000000009' })).status).toBe(404);
    expect((await call(OWN, 'item', 'DELETE', { id: 'nope' })).status).toBe(404);
  });
});

describe('run', () => {
  it('needs exactly one of view and f', async () => {
    expect((await call(OWN, 'run', 'GET')).status).toBe(400);
    expect((await call(OWN, 'run', 'GET', { query: `?view=${S1}&f=x` })).status).toBe(400);
    expect((await call(OWN, 'run', 'GET', { query: '?f=%25%25' })).status).toBe(400);
  });

  it('runs releases with their gates', async () => {
    const def: Definition = { v: 1, subject: 'releases', filter: { states: ['draft'] } };
    const r = await call(OWN, 'run', 'GET', { query: `?f=${encodeDefinition(def)}` });
    expect(r.status).toBe(200);
    expect(r.body.result.kind).toBe('releases');
    expect(r.body.result.rows).toHaveLength(1);
  });
});
