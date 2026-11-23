/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireUser = vi.fn();
const mockConfigured = vi.fn();
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockConfigured(),
  requireUser: () => mockRequireUser(),
}));

const OWNER = 'owner-1';
const L1 = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

type Rows = Record<string, any[]>;
const filters: Array<{ table: string; col: string; val: unknown }> = [];

function admin(rows: Rows, opts: { eventsError?: any } = {}) {
  return {
    from(table: string) {
      let data = rows[table] ?? [];
      const q: any = {
        select: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          data = data.slice(a, b + 1);
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ table, col, val });
          data = data.filter((r) => r[col] === val);
          return q;
        },
        in: (col: string, vals: unknown[]) => {
          data = data.filter((r) => vals.includes(r[col]));
          return q;
        },
        then: (res: (v: unknown) => void) =>
          res(table === 'share_events' && opts.eventsError ? { data: null, error: opts.eventsError } : { data, error: null }),
      };
      return q;
    },
  };
}

const req = (links: string) => new NextRequest(`http://x/api/links/activity?links=${encodeURIComponent(links)}`);
const load = () => import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  mockConfigured.mockReturnValue(true);
});

describe('GET /api/links/activity', () => {
  it('401s without a session', async () => {
    mockRequireUser.mockResolvedValue({ ok: false, res: new Response('no', { status: 401 }) });
    const res = await (await load()).GET(req(`share_links:${L1}`));
    expect(res.status).toBe(401);
  });

  it('summarises owned links only, resolving the token to sends server-side', async () => {
    const rows: Rows = {
      share_links: [
        { id: L1, user_id: OWNER, token: 'tokL', plays: 9, created_at: '2026-10-01T00:00:00Z' },
        { id: OTHER, user_id: 'someone-else', token: 'tokO', plays: 1, created_at: '2026-10-01T00:00:00Z' },
      ],
      project_shares: [{ id: P1, user_id: OWNER, token: 'tokP', plays: 2, created_at: '2026-11-01T00:00:00Z' }],
      share_events: [
        { owner_user_id: OWNER, share_source: 'share_links', share_id: L1, kind: 'open', ip_hash: 'a', created_at: '2026-11-20T00:00:00Z' },
        { owner_user_id: OWNER, share_source: 'share_links', share_id: L1, kind: 'download', ip_hash: 'b', created_at: '2026-11-21T00:00:00Z' },
        { owner_user_id: 'someone-else', share_source: 'share_links', share_id: L1, kind: 'play', ip_hash: 'z', created_at: '2026-11-21T00:00:00Z' },
      ],
      beat_sends: [
        { contact_id: 'c1', share_token: 'tokL', sent_at: '2026-10-02T00:00:00Z' },
        { contact_id: 'foreign', share_token: 'tokL', sent_at: '2026-10-02T00:00:00Z' },
      ],
      contacts: [{ id: 'c1', user_id: OWNER }, { id: 'foreign', user_id: 'someone-else' }],
    };
    mockRequireUser.mockResolvedValue({ ok: true, userId: OWNER, admin: admin(rows) });
    const res = await (await load()).GET(req(`share_links:${L1},share_links:${OTHER},project_shares:${P1},bogus:1`));
    const body = await res.json();
    expect(body.schemaReady).toBe(true);
    expect(Object.keys(body.activity).sort()).toEqual([`project_shares:${P1}`, `share_links:${L1}`].sort());
    expect(body.activity[`share_links:${L1}`]).toMatchObject({ sends: 1, opens: 9, people: 2, plays: 0, downloads: 1, since: '2026-11-20T00:00:00.000Z' });
    expect(JSON.stringify(body)).not.toContain('tokL');
    expect(filters.some((f) => f.table === 'share_events' && f.col === 'owner_user_id' && f.val === OWNER)).toBe(true);
  });

  it('answers schemaReady:false when migration 203 is missing', async () => {
    const rows: Rows = { share_links: [{ id: L1, user_id: OWNER, token: 't', plays: 0, created_at: 'x' }] };
    mockRequireUser.mockResolvedValue({ ok: true, userId: OWNER, admin: admin(rows, { eventsError: { code: '42P01', message: 'relation "share_events" does not exist' } }) });
    const res = await (await load()).GET(req(`share_links:${L1}`));
    expect(await res.json()).toEqual({ schemaReady: false, activity: {} });
  });
});
