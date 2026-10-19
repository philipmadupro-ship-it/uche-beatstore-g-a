/**
 * BUYER-02: the buyer who owns a beat can stream its PUBLIC preview after the
 * storefront stopped listing it (an exclusive sale delists the beat it sells).
 *
 * Runs against an in-memory PostgREST stand-in that really filters, so "another
 * buyer's exclusive" and "refunded" test the ownership query, not a canned
 * answer.
 *
 * Contract:
 * - listed / bundle-featured, anonymous: unchanged, public cache headers
 * - delisted + owned (signed in): streams the public preview, never
 *   cacheable by a shared cache
 * - delisted and anonymous / not owned / refunded / revoked bundle / owned by
 *   someone else: 404, nothing streamed
 * - the source handed to the stream is only ever the public derivative
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PRODUCER = 'producer-1';
const ME = 'rapper@example.test';
const OTHER = 'someone@example.test';
const LISTED = '11111111-1111-4111-8111-111111111111';
const EXCL_MINE = '22222222-2222-4222-8222-222222222222'; // delisted, I bought it
const EXCL_THEIRS = '33333333-3333-4333-8333-333333333333'; // delisted, someone else bought it
const EXCL_REFUNDED = '44444444-4444-4444-8444-444444444444'; // delisted, my purchase was refunded
const BUNDLE_TRACK = '55555555-5555-4555-8555-555555555555'; // delisted, in a bundle I bought
const BUNDLE_EXPIRED = '66666666-6666-4666-8666-666666666666'; // delisted, in a bundle whose access ended
const NO_PREVIEW = '77777777-7777-4777-8777-777777777777'; // delisted, I own it, only a private master
const FOREIGN = '88888888-8888-4888-8888-888888888888'; // delisted, owned, but not the producer's row

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
const streamed: string[] = [];

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve(session.userId ? { ok: true, userId: session.userId } : { ok: false }),
  createServiceClient: () => ({
    from,
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: session.email } } }) } },
  }),
}));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: (_req: unknown, source: string) => {
    streamed.push(source);
    return Promise.resolve(new Response('audio-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000' },
    }));
  },
}));

const PREVIEW = 'https://pub.r2.dev/previews/a.mp3';
const track = (id: string, over: Row = {}): Row => ({
  id, user_id: PRODUCER, store_listed: false, preview_url: PREVIEW,
  // would be a leak if either were ever streamed or echoed
  audio_url: 'r2://private/master.wav', wav_url: 'r2://private/master.wav', ...over,
});
const purchase = (id: string, email: string, trackId: string, over: Row = {}): Row => ({
  id, buyer_email: email, amount_usd: 900, status: 'paid', stripe_session_id: `cs_${id}`,
  created_at: '2026-09-11T00:00:00Z', download_unlocked: true,
  line_items: [{ track_id: trackId, license_id: 'l', license_type: 'exclusive' }], ...over,
});

const call = async (id: string) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost/api/store/preview/${id}`), { params: Promise.resolve({ id }) });
};

beforeEach(() => {
  streamed.length = 0;
  session.userId = 'buyer-1';
  session.email = 'Rapper@Example.test'; // mixed case on purpose
  tables = {
    creator_profiles: [{ user_id: PRODUCER }],
    tracks: [
      track(LISTED, { store_listed: true }),
      track(EXCL_MINE), track(EXCL_THEIRS), track(EXCL_REFUNDED), track(BUNDLE_TRACK), track(BUNDLE_EXPIRED),
      track(NO_PREVIEW, { preview_url: null }),
      track(FOREIGN, { user_id: 'some-buyer' }),
    ],
    license_purchases: [
      purchase('1', ME, EXCL_MINE),
      purchase('2', OTHER, EXCL_THEIRS),
      purchase('3', ME, EXCL_REFUNDED, { status: 'refunded', download_unlocked: false }),
      purchase('4', ME, NO_PREVIEW),
      purchase('5', ME, FOREIGN),
    ],
    project_access_links: [
      { id: 'pa1', project_id: 'proj1', buyer_email: ME, token: 't1', amount_usd: 50, stripe_session_id: 'cs_pa1', created_at: '2026-09-01T00:00:00Z', expires_at: null },
      { id: 'pa2', project_id: 'proj2', buyer_email: ME, token: 't2', amount_usd: 50, stripe_session_id: 'cs_pa2', created_at: '2026-09-01T00:00:00Z', expires_at: '2020-01-01T00:00:00Z' },
    ],
    project_tracks: [
      { project_id: 'proj1', track_id: BUNDLE_TRACK },
      { project_id: 'proj2', track_id: BUNDLE_EXPIRED },
    ],
    projects: [
      { id: 'proj1', name: 'P1', cover_url: null, user_id: PRODUCER, store_featured: false },
      { id: 'proj2', name: 'P2', cover_url: null, user_id: PRODUCER, store_featured: false },
    ],
  };
});

describe('GET /api/store/preview/[id]', () => {
  it('a listed beat streams to an anonymous caller with the public cache headers, unchanged', async () => {
    session.userId = null;
    const res = await call(LISTED);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300, stale-while-revalidate=300');
    expect(streamed).toEqual([PREVIEW]);
  });

  it('a delisted beat the signed-in buyer owns streams the public preview', async () => {
    const res = await call(EXCL_MINE);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('audio-bytes');
    expect(streamed).toEqual([PREVIEW]);
  });

  it('the owned response is private: no shared cache may keep it', async () => {
    const res = await call(EXCL_MINE);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vary')).toMatch(/cookie/i);
  });

  it('streams only the public derivative — never the private master — and echoes no private url', async () => {
    const res = await call(EXCL_MINE);
    const everything = JSON.stringify([streamed, Object.fromEntries(res.headers), await res.text()]);
    expect(everything).not.toContain('r2://');
    expect(everything).not.toContain('master.wav');
  });

  it('a delisted beat in an active bundle the buyer bought streams', async () => {
    const res = await call(BUNDLE_TRACK);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('an anonymous caller gets 404 for a delisted beat', async () => {
    session.userId = null;
    const res = await call(EXCL_MINE);
    expect(res.status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it("another buyer's exclusive is a 404", async () => {
    const res = await call(EXCL_THEIRS);
    expect(res.status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('the same beat 404s for a different signed-in buyer than the one who bought it', async () => {
    session.userId = 'buyer-2';
    session.email = OTHER;
    expect((await call(EXCL_MINE)).status).toBe(404);
    expect((await call(EXCL_THEIRS)).status).toBe(200);
  });

  it('a refunded purchase owns nothing', async () => {
    const res = await call(EXCL_REFUNDED);
    expect(res.status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('a bundle whose access ended owns nothing', async () => {
    expect((await call(BUNDLE_EXPIRED)).status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('a signed-in account with no email owns nothing', async () => {
    session.email = null;
    expect((await call(EXCL_MINE)).status).toBe(404);
  });

  it('an owned beat with only a private master has no source, so 404 — the master is never the fallback', async () => {
    const res = await call(NO_PREVIEW);
    expect(res.status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it("a row that is not the producer's is never streamed, owned or not", async () => {
    const res = await call(FOREIGN);
    expect(res.status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('an unknown id is a 404', async () => {
    expect((await call('99999999-9999-4999-8999-999999999999')).status).toBe(404);
  });
});
