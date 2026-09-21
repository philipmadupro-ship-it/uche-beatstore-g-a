/**
 * Route tests for /api/notifications.
 *
 * The bell has two failure modes that are invisible from the outside, and both
 * have already happened here:
 *
 *  - the unread badge was derived from the same 20 rows the panel renders, so
 *    past 20 it undercounted, and "Mark all read" — unbounded server-side —
 *    then cleared rows the producer had never been shown;
 *  - opening the panel fired `read_all`, so glancing at one sale silently read
 *    every other notification.
 *
 * Neither shows up in a screenshot, so the contract is pinned here: the count
 * comes from its own query, reading is scoped to the ids passed, and every
 * write is filtered on `user_id` as well.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

type Call = {
  table: string;
  action: 'select' | 'update';
  patch?: unknown;
  options?: unknown;
  filters: Array<[string, string, unknown]>;
};

const calls: Call[] = [];
const mockRequireUser = vi.fn();

/** Per-table results the test arranges before invoking the route. */
let pageRows: Array<Record<string, unknown>> = [];
let pageError: unknown = null;
let countValue: number | null = 0;
let countError: unknown = null;
let writeError: unknown = null;

function fakeAdmin() {
  return {
    from: (table: string) => ({
      select: (_cols: string, options?: unknown) => {
        const call: Call = { table, action: 'select', options, filters: [] };
        calls.push(call);
        const isCount = Boolean((options as { head?: boolean } | undefined)?.head);
        const q: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return q; },
          order: () => q,
          limit: () => q,
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(
              isCount
                ? { count: countValue, error: countError }
                : { data: pageRows, error: pageError },
            ).then(res, rej),
        };
        return q;
      },
      update: (patch: unknown) => {
        const call: Call = { table, action: 'update', patch, filters: [] };
        calls.push(call);
        const q: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return q; },
          in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return q; },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve({ error: writeError }).then(res, rej),
        };
        return q;
      },
    }),
  };
}

vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => mockRequireUser(),
  createServiceClient: () => fakeAdmin(),
}));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));

function patch(url: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/notifications${url}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function rows(n: number, read = false) {
  return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: 'purchase', read }));
}

beforeEach(() => {
  calls.length = 0;
  pageRows = [];
  pageError = null;
  countValue = 0;
  countError = null;
  writeError = null;
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ ok: true, userId: 'producer-1' });
});

describe('GET /api/notifications', () => {
  it('refuses a signed-out caller and reads nothing', async () => {
    mockRequireUser.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'no' }, { status: 401 }) });
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('counts unread with its own query, not from the rendered page', async () => {
    pageRows = rows(20, true);   // every row on this page is already read…
    countValue = 137;            // …while the table holds far more unread
    const { GET } = await import('./route');
    const body = await (await GET()).json();

    expect(body.unread).toBe(137);
    const count = calls.find((c) => (c.options as { head?: boolean })?.head);
    expect(count?.filters).toContainEqual(['eq', 'read', false]);
    expect(count?.filters).toContainEqual(['eq', 'user_id', 'producer-1']);
  });

  it('says the list is only a page when it is full', async () => {
    pageRows = rows(20);
    const { GET } = await import('./route');
    expect((await (await GET()).json()).hasMore).toBe(true);

    pageRows = rows(19);
    expect((await (await GET()).json()).hasMore).toBe(false);
  });

  it('falls back to counting the page when only the count query fails', async () => {
    pageRows = [...rows(3, false), ...rows(2, true)];
    countError = { message: 'count blew up' };
    const { GET } = await import('./route');
    const res = await GET();
    // A low badge beats no panel: the rows still render.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unread).toBe(3);
    expect(body.notifications).toHaveLength(5);
  });

  it('fails loudly when the page query itself fails', async () => {
    pageError = { message: 'boom' };
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(500);
  });
});

describe('PATCH /api/notifications', () => {
  it('rejects an unknown action', async () => {
    const { PATCH } = await import('./route');
    expect((await PATCH(patch('?action=delete_everything'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('authenticates before it looks at the body', async () => {
    mockRequireUser.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'no' }, { status: 401 }) });
    const { PATCH } = await import('./route');
    // A signed-out caller with a junk body gets 401, not a 400 about their
    // payload — the answer is "you are not signed in", not "that was malformed".
    const res = await PATCH(patch('?action=read', { ids: 'not-an-array' }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('rejects a read with no valid ids', async () => {
    const { PATCH } = await import('./route');
    expect((await PATCH(patch('?action=read', { ids: 'nope' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('reads only the ids passed, scoped to the producer', async () => {
    const { PATCH } = await import('./route');
    expect((await PATCH(patch('?action=read', { ids: ['n1', 'n2'] }))).status).toBe(200);

    const write = calls.find((c) => c.action === 'update')!;
    expect(write.patch).toEqual({ read: true });
    expect(write.filters).toContainEqual(['eq', 'user_id', 'producer-1']);
    expect(write.filters).toContainEqual(['in', 'id', ['n1', 'n2']]);
  });

  it('clears everything only on the explicit read_all', async () => {
    const { PATCH } = await import('./route');
    expect((await PATCH(patch('?action=read_all'))).status).toBe(200);

    const write = calls.find((c) => c.action === 'update')!;
    expect(write.filters).toContainEqual(['eq', 'user_id', 'producer-1']);
    // No id filter — that is what makes it "all", and why it must never be
    // reachable from simply opening the panel.
    expect(write.filters.some(([op]) => op === 'in')).toBe(false);
  });

  it('reports a failed write instead of claiming success', async () => {
    writeError = { message: 'nope' };
    const { PATCH } = await import('./route');
    expect((await PATCH(patch('?action=read_all'))).status).toBe(500);
  });
});
