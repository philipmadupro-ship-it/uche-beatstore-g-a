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
      track_versions: [],
      beat_sends: [],
      rating_history: [],
      contacts: [],
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
});
