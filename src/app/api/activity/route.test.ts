/**
 * GET /api/activity — the producer's own activity feed never carries an
 * ORGANIZATION's rows (LABEL-22). Org projects, tracks and comments are
 * ownerless (user_id NULL, org_id set), and the feed's legacy "or user_id is
 * null" arm would otherwise hand every producer an org's song titles and its
 * comments — internal, team-only notes included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const ME = '20000000-0000-4000-8000-000000000001';
const ORG = '10000000-0000-4000-8000-000000000001';
const MY_P = '40000000-0000-4000-8000-0000000000a1';
const LEGACY_P = '40000000-0000-4000-8000-0000000000a2'; // a pre-ownership producer row: user_id NULL, no org
const ORG_P = '40000000-0000-4000-8000-0000000000b1';

let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@/lib/db', () => ({
  createServiceClient: () => mem.client,
  isSupabaseConfigured: () => true,
  getAll: () => [],
  query: () => [],
}));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const at = '2026-10-02T10:00:00Z';
const comment = (id: string, project: string, body: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: project, track_id: null, user_id: null, share_token: null, author_name: 'Guest', body, created_at: at, ...extra,
});

beforeEach(() => {
  db = {
    tables: {
      tracks: [
        { id: 't-mine', user_id: ME, org_id: null, title: 'My beat', created_at: at },
        { id: 't-org', user_id: null, org_id: ORG, title: 'The label’s unreleased single', created_at: at },
        { id: 't-other', user_id: 'someone-else', org_id: null, title: 'THEIR-TRACK', created_at: at },
      ],
      projects: [
        { id: MY_P, user_id: ME, org_id: null },
        { id: LEGACY_P, user_id: null, org_id: null },
        { id: ORG_P, user_id: null, org_id: ORG },
      ],
      project_comments: [
        comment('c1', MY_P, 'Nice drums'),
        comment('c2', LEGACY_P, 'Legacy project comment'),
        comment('c3', ORG_P, 'TEAM-ONLY: the artist wants out of the deal', { visibility: 'internal', user_id: 'u-team' }),
        comment('c4', ORG_P, 'A visible note on the label’s project', { user_id: 'u-team' }),
      ],
      track_versions: [
        { id: 'v-mine', track_id: 't-mine', version_label: 'v2', created_at: at },
        { id: 'v-other', track_id: 't-other', version_label: 'THEIRS-V', created_at: at },
      ],
      beat_sends: [
        { id: 's-mine', contact_id: 'c-mine', track_ids: ['t-mine'], sent_at: at, opened_at: '2026-10-02T11:00:00Z', link_clicked_at: null },
        { id: 's-other', contact_id: 'c-other', track_ids: ['t-other'], sent_at: at, opened_at: at },
      ],
      rating_history: [],
      contacts: [
        { id: 'c-mine', user_id: ME, name: 'Nova' },
        { id: 'c-other', user_id: 'someone-else', name: 'THEIR-CONTACT' },
        { id: 'c-org', user_id: null, org_id: ORG, name: 'ORG-CONTACT' },
      ],
      notifications: [
        { id: 'n1', user_id: ME, org_id: null, kind: 'purchase', title: 'New sale — My beat ($29.00)', body: 'From buyer@example.com', data: {}, created_at: at },
        { id: 'n2', user_id: ME, org_id: null, kind: 'share_comment', title: 'DUP-COMMENT', data: {}, created_at: at },
        { id: 'n3', user_id: ME, org_id: ORG, kind: 'task_assigned', title: 'ORG-ASK', data: {}, created_at: at },
        { id: 'n4', user_id: 'someone-else', org_id: null, kind: 'purchase', title: 'THEIR-SALE', data: {}, created_at: at },
      ],
      contact_activity: [
        { id: 'a1', user_id: ME, contact_id: 'c-mine', kind: 'decision_changed', metadata: { set_by: 'artist', decision: 'interested', track_id: 't-mine' }, occurred_at: at },
        { id: 'a2', user_id: ME, contact_id: 'c-mine', kind: 'track_played', metadata: {}, occurred_at: at },
        { id: 'a3', user_id: 'someone-else', contact_id: 'c-other', kind: 'artist_message', metadata: {}, occurred_at: at },
      ],
    },
  };
  mem = memoryAdmin(db);
});

const get = () => new NextRequest('http://localhost/api/activity?from=2026-10-01T00:00:00Z&to=2026-10-03T00:00:00Z');

describe('GET /api/activity', () => {
  it('lists the producer’s own rows (and legacy ownerless producer rows), never an organization’s', async () => {
    const { GET } = await import('./route');
    const res = await GET(get());
    expect(res.status).toBe(200);
    const { activity } = (await res.json()) as { activity: { title: string }[] };
    const titles = activity.map((a) => a.title).join(' | ');
    expect(titles).toContain('Nice drums');
    expect(titles).toContain('Legacy project comment');
    expect(titles).toContain('My beat');
    for (const leak of ['TEAM-ONLY', 'wants out of the deal', 'visible note on the label', 'unreleased single']) expect(titles, leak).not.toContain(leak);
  });

  it('on a database before the org columns it still lists the producer’s rows', async () => {
    // PostgREST answers 42703 for a filter on a column that is not there.
    // (Only THAT steps down: see the next test for any other failure.)
    const real = mem.client.from.bind(mem.client);
    mem.client.from = ((table: string) => {
      const b = real(table);
      const is = b.is.bind(b);
      let missing = false;
      b.is = ((col: string, v: null) => {
        if (col === 'org_id') missing = true;
        return is(col, v);
      }) as typeof b.is;
      const then = b.then.bind(b);
      b.then = ((resolve: (r: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) =>
        missing ? Promise.resolve({ data: null, error: { code: '42703', message: 'column org_id does not exist' } }).then(resolve, reject) : then(resolve, reject)) as typeof b.then;
      return b;
    }) as typeof mem.client.from;
    const { GET } = await import('./route');
    const res = await GET(get());
    const { activity } = (await res.json()) as { activity: { title: string }[] };
    expect(activity.map((a) => a.title).join(' | ')).toContain('Nice drums');
  });

  it('any OTHER failure of the org-excluding read is an error, never a quiet fallback to the filter that lets org rows in', async () => {
    const real = mem.client.from.bind(mem.client);
    mem.client.from = ((table: string) => {
      const b = real(table);
      let touched = false;
      const is = b.is.bind(b);
      b.is = ((col: string, v: null) => {
        if (col === 'org_id') touched = true;
        return is(col, v);
      }) as typeof b.is;
      const then = b.then.bind(b);
      b.then = ((resolve: (r: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) =>
        touched ? Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).then(resolve, reject) : then(resolve, reject)) as typeof b.then;
      return b;
    }) as typeof mem.client.from;
    const { GET } = await import('./route');
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('TEAM-ONLY');
  });

  it('another owner’s rows are never SELECTED, not merely filtered out afterwards', async () => {
    const seen: { table: string; filters: string[] }[] = [];
    const real = mem.client.from.bind(mem.client);
    mem.client.from = ((table: string) => {
      const b = real(table);
      const rec = { table, filters: [] as string[] };
      seen.push(rec);
      for (const m of ['eq', 'in', 'or', 'is'] as const) {
        const orig = (b as unknown as Record<string, (...a: unknown[]) => unknown>)[m].bind(b);
        (b as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { rec.filters.push(`${m}:${JSON.stringify(a)}`); return orig(...a); };
      }
      return b;
    }) as typeof mem.client.from;
    const { GET } = await import('./route');
    const res = await GET(get());
    const text = JSON.stringify(await res.json());
    for (const leak of ['THEIRS-V', 'THEIR-CONTACT', 'ORG-CONTACT', 'THEIR-SALE', 'THEIR-TRACK', 'ORG-ASK']) expect(text, leak).not.toContain(leak);
    // every child stream carries an owner scope in its own query
    for (const table of ['track_versions', 'project_comments', 'beat_sends']) {
      const reads = seen.filter((r) => r.table === table);
      expect(reads.length, table).toBeGreaterThan(0);
      for (const r of reads) expect(r.filters.some((f) => f.startsWith('in:')), `${table} unscoped`).toBe(true);
    }
    for (const table of ['notifications', 'contact_activity']) {
      for (const r of seen.filter((x) => x.table === table)) expect(r.filters.some((f) => f.startsWith('eq:["user_id"')), `${table} unscoped`).toBe(true);
    }
  });

  it('shows sales, artist and sharing rows with names, groups and links; leaves out the duplicates and the noise', async () => {
    const { GET } = await import('./route');
    const { activity } = (await (await GET(get())).json()) as { activity: { id: string; title: string; group: string; href: string | null; kind: string; subject_kind?: string }[] };
    const byId = Object.fromEntries(activity.map((a) => [a.id, a]));
    expect(byId['notif-n1']).toMatchObject({ group: 'sales', title: 'New sale — My beat ($29.00)', href: '/sales' });
    expect(byId['ca-a1']).toMatchObject({ group: 'artists', title: 'Nova is interested in “My beat”' });
    expect(byId['send-s-mine']).toMatchObject({ group: 'sharing', title: 'Sent “My beat” to Nova', href: '/contacts/c-mine' });
    expect(byId['opened-s-mine']).toMatchObject({ group: 'sharing', title: 'Nova opened your send' });
    expect(byId['version-v-mine'].title).toBe('New version v2 of “My beat”');
    expect(activity.map((a) => a.title).join('|')).not.toMatch(/DUP-COMMENT|status|buyer@example/);
    expect(activity.some((a) => a.id === 'ca-a2')).toBe(false);
    // the old fields survive
    expect(byId['send-s-mine']).toMatchObject({ kind: 'send', subject_kind: 'contact' });
  });

  it('missing optional tables (notifications, contact_activity) read as empty, not a 500', async () => {
    db.missingTables = ['notifications', 'contact_activity'];
    const { GET } = await import('./route');
    const res = await GET(get());
    expect(res.status).toBe(200);
    const { activity } = (await res.json()) as { activity: { title: string }[] };
    expect(activity.map((a) => a.title).join('|')).toContain('Nice drums');
  });

  it('notifications fall back when org_id does not exist yet, but still only this producer’s', async () => {
    const real = mem.client.from.bind(mem.client);
    mem.client.from = ((table: string) => {
      const b = real(table);
      if (table !== 'notifications') return b;
      let touched = false;
      const is = b.is.bind(b);
      b.is = ((col: string, v: null) => { if (col === 'org_id') touched = true; return is(col, v); }) as typeof b.is;
      const then = b.then.bind(b);
      b.then = ((resolve: (r: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) =>
        touched ? Promise.resolve({ data: null, error: { code: '42703', message: 'column org_id does not exist' } }).then(resolve, reject) : then(resolve, reject)) as typeof b.then;
      return b;
    }) as typeof mem.client.from;
    const { GET } = await import('./route');
    const { activity } = (await (await GET(get())).json()) as { activity: { title: string }[] };
    const titles = activity.map((a) => a.title).join('|');
    expect(titles).toContain('New sale');
    expect(titles).not.toContain('THEIR-SALE');
  });
});
