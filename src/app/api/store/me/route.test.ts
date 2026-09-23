/**
 * Route tests for /api/store/me — the only write path into buyer_* tables
 * (RLS blocks direct PostgREST, mig 060).
 *
 * Contract:
 * - no valid token and no session → 400, nothing read or written
 * - every write is keyed on the email the token proves, never on the body
 * - playlist edits on a playlist this email does not own → 404, nothing written
 * - delete_playlist is scoped by email, so it cannot delete someone else's
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PL = '22222222-2222-4222-8222-222222222222';
const TRACK = '33333333-3333-4333-8333-333333333333';

type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };
const ops: Op[] = [];
/** Rows a `select … maybeSingle()` returns, keyed by table. */
const singles: Record<string, unknown> = {};

function builder(table: string) {
  const make = (op: string, payload?: unknown) => {
    const rec: Op = { table, op, payload, filters: [] };
    ops.push(rec);
    const result = () => Promise.resolve({ data: op === 'select' ? [] : null, error: null });
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return q; },
      in: () => q,
      order: () => q,
      limit: () => q,
      select: () => q,
      maybeSingle: () => Promise.resolve({ data: singles[table] ?? null, error: null }),
      single: () => Promise.resolve({ data: { id: PL, name: 'Mine' }, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej),
    };
    return q;
  };
  return {
    select: () => make('select'),
    insert: (p: unknown) => make('insert', p),
    upsert: (p: unknown) => make('upsert', p),
    update: (p: unknown) => make('update', p),
    delete: () => make('delete'),
  };
}

const mockVerify = vi.fn();
vi.mock('@/lib/buyer-tokens', () => ({ verifyBuyerToken: (t: string) => mockVerify(t) }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve({ ok: false }),
  createServiceClient: () => ({ from: (t: string) => builder(t) }),
}));

function post(body: unknown, query = '?token=good') {
  return new NextRequest(`http://localhost/api/store/me${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const writes = () => ops.filter((o) => o.op !== 'select');

beforeEach(() => {
  vi.clearAllMocks();
  ops.length = 0;
  for (const k of Object.keys(singles)) delete singles[k];
  mockVerify.mockImplementation((t: string) => (t === 'good' ? { email: 'buyer@example.test' } : null));
});

describe('POST /api/store/me', () => {
  it('400s without a token or session and touches nothing', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'create_playlist', name: 'x' }, ''));
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('400s on an invalid token', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'create_playlist', name: 'x' }, '?token=forged'));
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('keys writes on the token email, ignoring any email in the body', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'log_play', track_id: TRACK, email: 'victim@example.test' }));
    expect(res.status).toBe(200);
    expect(writes()).toEqual([
      { table: 'buyer_listening_history', op: 'insert', payload: { email: 'buyer@example.test', track_id: TRACK }, filters: [] },
    ]);
  });

  it.each(['add_to_playlist', 'remove_from_playlist'])(
    "404s on %s for a playlist this email doesn't own, writing nothing",
    async (action) => {
      const { POST } = await import('./route');
      const res = await POST(post({ action, playlist_id: PL, track_id: TRACK }));
      expect(res.status).toBe(404);
      expect(writes()).toHaveLength(0);
      const check = ops.find((o) => o.table === 'buyer_playlists')!;
      expect(check.filters).toEqual([['id', PL], ['email', 'buyer@example.test']]);
    },
  );

  it('adds to an owned playlist', async () => {
    singles.buyer_playlists = { id: PL };
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'add_to_playlist', playlist_id: PL, track_id: TRACK }));
    expect(res.status).toBe(200);
    expect(writes().map((w) => `${w.table}:${w.op}`)).toEqual([
      'buyer_playlist_tracks:upsert',
      'buyer_playlists:update',
    ]);
  });

  it('scopes delete_playlist by email', async () => {
    const { POST } = await import('./route');
    await POST(post({ action: 'delete_playlist', playlist_id: PL }));
    expect(writes()).toEqual([
      { table: 'buyer_playlists', op: 'delete', payload: undefined, filters: [['id', PL], ['email', 'buyer@example.test']] },
    ]);
  });

  it('rejects an unknown action', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'drop_tables' }));
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});
