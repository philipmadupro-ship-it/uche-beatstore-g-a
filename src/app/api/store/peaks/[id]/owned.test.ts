/**
 * The waveform follows the preview (see preview/[id]/route.test.ts): the buyer
 * who owns a delisted beat gets its peaks, nobody else does, and the owned
 * response is not publicly cacheable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PRODUCER = 'producer-1';
const MINE = '22222222-2222-4222-8222-222222222222';
const THEIRS = '33333333-3333-4333-8333-333333333333';
const LISTED = '11111111-1111-4111-8111-111111111111';
const PEAKS = 'https://pub.r2.dev/peaks/a.json';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  const match = () => (tables[table] ?? []).filter(
    (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
  );
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
    in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
    order: () => q,
    maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: match(), error: null }).then(res, rej),
  };
  return q;
}

const session: { userId: string | null; email: string | null } = { userId: null, email: null };
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true, getById: () => null }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve(session.userId ? { ok: true, userId: session.userId } : { ok: false }),
  createServiceClient: () => ({
    from,
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: session.email } } }) } },
  }),
}));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: () => Promise.resolve(new Response('{"peaks":[0.1]}', { status: 200 })),
}));

const track = (id: string, over: Row = {}): Row => ({ id, user_id: PRODUCER, store_listed: false, peaks_url: PEAKS, ...over });
const call = async (id: string) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost/api/store/peaks/${id}`), { params: Promise.resolve({ id }) });
};

beforeEach(() => {
  session.userId = 'buyer-1';
  session.email = 'rapper@example.test';
  tables = {
    creator_profiles: [{ user_id: PRODUCER }],
    tracks: [track(LISTED, { store_listed: true }), track(MINE), track(THEIRS)],
    license_purchases: [
      { id: '1', buyer_email: 'rapper@example.test', amount_usd: 900, status: 'paid', stripe_session_id: 'cs_1', created_at: '2026-09-11T00:00:00Z', download_unlocked: true, line_items: [{ track_id: MINE, license_id: 'l', license_type: 'exclusive' }] },
      { id: '2', buyer_email: 'someone@example.test', amount_usd: 900, status: 'paid', stripe_session_id: 'cs_2', created_at: '2026-09-11T00:00:00Z', download_unlocked: true, line_items: [{ track_id: THEIRS, license_id: 'l', license_type: 'exclusive' }] },
    ],
    project_access_links: [], project_tracks: [], projects: [],
  };
});

describe('GET /api/store/peaks/[id] for a delisted beat', () => {
  it('the owner gets the peaks, privately cached', async () => {
    const res = await call(MINE);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('anonymous, and a buyer who did not buy it, get a 404', async () => {
    expect((await call(THEIRS)).status).toBe(404);
    session.userId = null;
    expect((await call(MINE)).status).toBe(404);
  });

  it('a listed beat keeps the public cache headers for everyone', async () => {
    session.userId = null;
    const res = await call(LISTED);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600');
  });
});
