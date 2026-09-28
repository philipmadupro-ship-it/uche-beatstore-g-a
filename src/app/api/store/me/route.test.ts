/**
 * Route tests for /api/store/me — the only write path into buyer_* tables
 * (RLS blocks direct PostgREST, mig 060).
 *
 * Contract:
 * - no valid token and no session → 400, nothing read or written
 * - every write is keyed on the email the token proves, never on the body
 * - playlist edits on a playlist this email does not own → 404, nothing written
 * - delete_playlist is scoped by email, so it cannot delete someone else's
 * - a track enters a buyer's library only if the storefront lists it, so GET
 *   can never read an unlisted beat's metadata back out
 * - set_favorite writes the requested state; it never flips what is stored
 * - token and session identities are keyed on the same canonical email
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PL = '22222222-2222-4222-8222-222222222222';
const TRACK = '33333333-3333-4333-8333-333333333333';

type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };
const ops: Op[] = [];
/** Rows a `select … maybeSingle()` returns, keyed by table. */
const singles: Record<string, unknown> = {};
/** Rows a list `select` resolves with, keyed by table. */
const lists: Record<string, unknown[]> = {};

function builder(table: string) {
  const make = (op: string, payload?: unknown) => {
    const rec: Op = { table, op, payload, filters: [] };
    ops.push(rec);
    const result = () => Promise.resolve({ data: op === 'select' ? (lists[table] ?? []) : null, error: null });
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
const session: { userId: string | null; email: string | null } = { userId: null, email: null };
vi.mock('@/lib/buyer-tokens', () => ({ verifyBuyerToken: (t: string) => mockVerify(t) }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve(session.userId ? { ok: true, userId: session.userId } : { ok: false }),
  createServiceClient: () => ({
    from: (t: string) => builder(t),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: session.email } } }) } },
  }),
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
  for (const k of Object.keys(lists)) delete lists[k];
  session.userId = null;
  session.email = null;
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
    singles.tracks = { id: TRACK };
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
    singles.tracks = { id: TRACK };
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

  it.each([
    ['log_play', { track_id: TRACK }],
    ['set_favorite', { track_id: TRACK, favorited: true }],
    ['toggle_favorite', { track_id: TRACK }],
    ['add_to_playlist', { track_id: TRACK, playlist_id: PL }],
  ])('404s %s for a track the storefront does not list, writing nothing', async (action, rest) => {
    singles.buyer_playlists = { id: PL };
    // singles.tracks unset → the store_listed lookup finds nothing
    const { POST } = await import('./route');
    const res = await POST(post({ action, ...rest }));
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
    const lookup = ops.find((o) => o.table === 'tracks')!;
    expect(lookup.filters).toEqual([['id', TRACK], ['store_listed', true]]);
  });

  it('set_favorite(true) upserts, and never deletes a favourite that already exists', async () => {
    singles.tracks = { id: TRACK };
    singles.buyer_favorites = { track_id: TRACK }; // already favourited on another device
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'set_favorite', track_id: TRACK, favorited: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, favorited: true });
    const fav = writes().filter((w) => w.table === 'buyer_favorites');
    expect(fav).toEqual([
      { table: 'buyer_favorites', op: 'upsert', payload: { email: 'buyer@example.test', track_id: TRACK }, filters: [] },
    ]);
  });

  it('set_favorite(false) deletes only this email\'s row, even for a since-delisted beat', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'set_favorite', track_id: TRACK, favorited: false }));
    expect(res.status).toBe(200);
    expect(writes()).toEqual([
      { table: 'buyer_favorites', op: 'delete', payload: undefined, filters: [['email', 'buyer@example.test'], ['track_id', TRACK]] },
    ]);
  });

  it('rejects set_favorite without an explicit state', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'set_favorite', track_id: TRACK }));
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it('keys a signed-in session on the canonical (lowercased) account email', async () => {
    session.userId = 'buyer-user';
    session.email = ' Buyer@Example.TEST ';
    singles.tracks = { id: TRACK };
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'log_play', track_id: TRACK }, '?session=1'));
    expect(res.status).toBe(200);
    expect(writes()).toEqual([
      { table: 'buyer_listening_history', op: 'insert', payload: { email: 'buyer@example.test', track_id: TRACK }, filters: [] },
    ]);
  });

  it('400s ?session=1 when nobody is signed in', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'log_play', track_id: TRACK }, '?session=1'));
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('rejects an unknown action', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ action: 'drop_tables' }));
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe('GET /api/store/me', () => {
  function get(query: string) {
    return new NextRequest(`http://localhost/api/store/me${query}`);
  }

  it('400s without identity and reads nothing', async () => {
    const { GET } = await import('./route');
    const res = await GET(get(''));
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('reads every buyer table scoped to the session email only', async () => {
    session.userId = 'buyer-user';
    session.email = 'Buyer@Example.test';
    const { GET } = await import('./route');
    const res = await GET(get('?session=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('buyer@example.test');
    for (const table of ['buyer_listening_history', 'buyer_favorites', 'buyer_playlists']) {
      const read = ops.find((o) => o.table === table)!;
      expect(read.filters).toEqual([['email', 'buyer@example.test']]);
    }
  });

  it('does not read back metadata for an unlisted beat a pre-gate row names, unless the buyer bought it', async () => {
    session.userId = 'buyer-user';
    session.email = 'buyer@example.test';
    lists.buyer_favorites = [
      { track_id: 'listed', created_at: '2026-01-03' },
      { track_id: 'private', created_at: '2026-01-02' },
      { track_id: 'bought', created_at: '2026-01-01' },
    ];
    lists.tracks = [
      { id: 'listed', title: 'Listed', store_listed: true },
      { id: 'private', title: 'Unreleased demo', store_listed: false },
      { id: 'bought', title: 'Bought exclusive', store_listed: false },
    ];
    lists.license_purchases = [{ track_ids: ['bought'] }];
    const { GET } = await import('./route');
    const body = await (await GET(get('?session=1'))).json();
    expect(body.favorites.map((f: { track: { title: string } | null }) => f.track?.title ?? null))
      .toEqual(['Listed', null, 'Bought exclusive']);
    expect(JSON.stringify(body)).not.toContain('Unreleased demo');
    const purchases = ops.find((o) => o.table === 'license_purchases')!;
    expect(purchases.filters).toEqual([['buyer_email', 'buyer@example.test']]);
  });
});
