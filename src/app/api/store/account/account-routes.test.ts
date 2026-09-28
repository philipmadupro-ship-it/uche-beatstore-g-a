/**
 * Order history ↔ buyer account (BUYER-03).
 *
 * A buyer checks out as a guest; the webhook stores `buyer_email` lowercased.
 * Later they open their account, either signed in (/api/store/account/me,
 * identity = auth.users.email) or through the 24h link
 * (/api/store/account/[token], identity = the signed email). Both must land on
 * the same orders.
 *
 * Contract:
 * - the session identity is canonicalised: an auth email with capitals still
 *   finds orders stored under the lowercased address (the original failure)
 * - session and token return the same payload for the same human
 * - one buyer never sees another buyer's rows
 * - no session → the route's own 401, no DB read; bad/expired token → 400
 * - a failed purchase query is a 500, never an empty "No purchases yet"
 * - /api/store/me?session=1 keys the buyer library on the same email
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const TRACK_A = '11111111-1111-4111-8111-111111111111';
const TRACK_B = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
const failing = new Set<string>();

/** Minimal PostgREST stand-in that really filters on `eq` / `in`. */
function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  reads.push({ table, filters });
  const run = () => {
    if (failing.has(table)) return Promise.resolve({ data: null, error: new Error(`${table} down`) });
    const rows = (tables[table] ?? []).filter(
      (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
    );
    return Promise.resolve({ data: rows, error: null });
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
    in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
    order: () => q,
    limit: () => q,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  };
  return q;
}

let sessionUser: { id: string; email: string | null } | null = null;
const mockVerify = vi.fn();

vi.mock('@/lib/buyer-tokens', () => ({ verifyBuyerToken: (t: string) => mockVerify(t) }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () =>
    Promise.resolve(
      sessionUser
        ? { ok: true, userId: sessionUser.id }
        : { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
    ),
  createServiceClient: () => ({
    from,
    auth: {
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({
            data: { user: sessionUser && sessionUser.id === id ? { id, email: sessionUser.email } : null },
          }),
      },
    },
  }),
}));

const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const tokenReq = (token: string) => new NextRequest(`http://localhost/api/store/account/${token}`);

beforeEach(() => {
  vi.clearAllMocks();
  reads.length = 0;
  failing.clear();
  sessionUser = null;
  // What the webhook writes: buyer_email already normalised (route.ts:794).
  tables.license_purchases = [
    {
      id: 'lp-mine',
      buyer_email: 'buyer@example.test',
      amount_usd: '29.99',
      line_items: [{ track_id: TRACK_A, license_id: 'lease', license_type: 'lease' }],
      stripe_session_id: 'cs_mine',
      created_at: '2026-09-20T10:00:00Z',
      status: 'paid',
    },
    {
      id: 'lp-other',
      buyer_email: 'someone-else@example.test',
      amount_usd: 500,
      line_items: [{ track_id: TRACK_B, license_id: 'excl', license_type: 'exclusive' }],
      stripe_session_id: 'cs_other',
      created_at: '2026-09-21T10:00:00Z',
      status: 'paid',
    },
  ];
  tables.project_access_links = [
    {
      id: 'pa-mine',
      buyer_email: 'buyer@example.test',
      project_id: PROJECT,
      token: 'access-token-mine',
      amount_usd: 80,
      stripe_session_id: 'cs_bundle',
      created_at: '2026-09-22T10:00:00Z',
    },
  ];
  tables.tracks = [
    { id: TRACK_A, title: 'Night Shift' },
    { id: TRACK_B, title: 'Cold Front' },
  ];
  tables.projects = [{ id: PROJECT, name: 'Winter Tape', cover_url: null }];
  tables.buyer_listening_history = [];
  tables.buyer_favorites = [];
  tables.buyer_playlists = [];
  mockVerify.mockImplementation((t: string) =>
    t === 'good' ? { email: 'buyer@example.test', exp: 9_999_999_999 } : null,
  );
});

describe('GET /api/store/account/me — signed-in buyer', () => {
  it('finds guest-checkout orders when the auth email carries capitals', async () => {
    sessionUser = { id: 'u1', email: 'Buyer@Example.TEST' };
    const { GET } = await import('./me/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('buyer@example.test');
    expect(body.track_licenses.map((r: { id: string }) => r.id)).toEqual(['lp-mine']);
    expect(body.track_licenses[0].items[0].title).toBe('Night Shift');
    expect(body.track_licenses[0].download_url).toBe('/store/download?session_id=cs_mine');
    expect(body.project_bundles.map((r: { id: string }) => r.id)).toEqual(['pa-mine']);
    expect(body.project_bundles[0].download_url).toBe('/store/projects/access/access-token-mine');
  });

  it('never returns another buyer’s purchases', async () => {
    sessionUser = { id: 'u1', email: 'buyer@example.test' };
    const { GET } = await import('./me/route');
    const body = await (await GET()).json();
    const ids = body.track_licenses.map((r: { id: string }) => r.id);
    expect(ids).not.toContain('lp-other');
    for (const read of reads.filter((r) => r.table === 'license_purchases' || r.table === 'project_access_links')) {
      expect(read.filters).toContainEqual(['buyer_email', 'buyer@example.test']);
    }
  });

  it('401s without a session and reads nothing', async () => {
    const { GET } = await import('./me/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(reads).toHaveLength(0);
  });

  it('400s for an account with no email', async () => {
    sessionUser = { id: 'u1', email: null };
    const { GET } = await import('./me/route');
    const res = await GET();
    expect(res.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('500s when the purchase query fails instead of showing an empty history', async () => {
    sessionUser = { id: 'u1', email: 'buyer@example.test' };
    failing.add('license_purchases');
    const { GET } = await import('./me/route');
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.track_licenses).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('license_purchases');
  });
});

describe('GET /api/store/account/[token] — 24h link', () => {
  it('returns exactly what the signed-in account returns for the same buyer', async () => {
    sessionUser = { id: 'u1', email: 'Buyer@Example.test' };
    const me = await import('./me/route');
    const tok = await import('./[token]/route');
    const viaSession = await (await me.GET()).json();
    const viaToken = await (await tok.GET(tokenReq('good'), tokenCtx('good'))).json();
    expect(viaToken).toEqual(viaSession);
    expect(viaToken.track_licenses).toHaveLength(1);
  });

  it('400s on a forged or expired token and reads nothing', async () => {
    const { GET } = await import('./[token]/route');
    const res = await GET(tokenReq('forged'), tokenCtx('forged'));
    expect(res.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('500s when the bundle query fails', async () => {
    failing.add('project_access_links');
    const { GET } = await import('./[token]/route');
    const res = await GET(tokenReq('good'), tokenCtx('good'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/store/me?session=1 — buyer library', () => {
  it('keys favourites/history/playlists on the canonical session email', async () => {
    sessionUser = { id: 'u1', email: 'Buyer@Example.TEST' };
    const { GET } = await import('../me/route');
    const res = await GET(new NextRequest('http://localhost/api/store/me?session=1'));
    expect(res.status).toBe(200);
    const libraryReads = reads.filter((r) => r.table.startsWith('buyer_'));
    expect(libraryReads.length).toBeGreaterThan(0);
    for (const read of libraryReads) {
      expect(read.filters).toContainEqual(['email', 'buyer@example.test']);
    }
  });
});
