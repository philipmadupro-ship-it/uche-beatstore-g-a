/**
 * /api/store/me/preview/[id] — audio for a beat played from the buyer's account.
 *
 * Contract:
 * - no token and no session → 400, nothing read
 * - a beat the buyer owns plays even when it is delisted (an exclusive sale
 *   delists it); a license or an active bundle both count
 * - a beat the buyer does NOT own and the store does not show is a 404, so a
 *   buyer cannot stream another producer's / an unlisted track by id
 * - a refunded license, an expired bundle, or someone else's purchase grants nothing
 * - what streams is the preview clip, never a private r2:// master
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const TRACK = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const ctx = { params: Promise.resolve({ id: TRACK }) };

type Filter = [string, unknown];
const queries: Array<{ table: string; filters: Filter[] }> = [];
const lists: Record<string, unknown[]> = {};
const singles: Record<string, unknown> = {};

function builder(table: string) {
  const rec = { table, filters: [] as Filter[] };
  queries.push(rec);
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return q; },
    contains: (c: string, v: unknown) => { rec.filters.push([c, v]); return q; },
    in: (c: string, v: unknown) => { rec.filters.push([c, v]); return q; },
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: singles[table] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: lists[table] ?? [], error: null }).then(res, rej),
  };
  return q;
}

const session: { userId: string | null; email: string | null } = { userId: null, email: null };
const streamed: string[] = [];
const publicly = { ok: false };

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/buyer-tokens', () => ({ verifyBuyerToken: () => null }));
vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => Promise.resolve(session.userId ? { ok: true, userId: session.userId } : { ok: false }),
  createServiceClient: () => ({
    from: (t: string) => builder(t),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: session.email } } }) } },
  }),
}));
vi.mock('@/lib/store/public-preview-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/store/public-preview-access')>()),
  canStreamPublicly: () => Promise.resolve(publicly.ok),
}));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: (_req: unknown, src: string) => {
    streamed.push(src);
    return Promise.resolve(new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
  },
}));

import { GET } from './route';

const req = (q = '?session=1') =>
  new NextRequest(`http://localhost/api/store/me/preview/${TRACK}${q}`);

const track = (over: Record<string, unknown> = {}) => ({
  preview_url: 'https://cdn.example/preview.mp3',
  audio_url: 'r2://private/master.wav',
  store_listed: false,
  user_id: 'producer',
  ...over,
});

beforeEach(() => {
  queries.length = 0;
  streamed.length = 0;
  for (const k of Object.keys(lists)) delete lists[k];
  for (const k of Object.keys(singles)) delete singles[k];
  session.userId = 'buyer-user';
  session.email = 'Buyer@Example.com';
  publicly.ok = false;
  singles.tracks = track();
});

describe('GET /api/store/me/preview/[id]', () => {
  it('400s without a buyer identity and reads nothing', async () => {
    session.userId = null;
    const res = await GET(req(), ctx);
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('404s a malformed id before touching the database', async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(404);
    expect(queries).toEqual([]);
  });

  it('streams a delisted beat the buyer licensed — the preview clip, never the master', async () => {
    lists.license_purchases = [{ download_unlocked: true }];
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(streamed).toEqual(['https://cdn.example/preview.mp3']);
    expect(res.headers.get('cache-control')).toMatch(/^private/);
  });

  it('keys the ownership lookup on the canonical email and this track', async () => {
    lists.license_purchases = [{ download_unlocked: true }];
    await GET(req(), ctx);
    const q = queries.find((x) => x.table === 'license_purchases')!;
    expect(q.filters).toContainEqual(['buyer_email', 'buyer@example.com']);
    expect(q.filters).toContainEqual(['track_ids', [TRACK]]);
  });

  it('streams a beat inside a bundle the buyer bought', async () => {
    lists.project_access_links = [{ project_id: PROJECT, expires_at: null }];
    lists.project_tracks = [{ track_id: TRACK }];
    expect((await GET(req(), ctx)).status).toBe(200);
  });

  it('404s a beat the buyer does not own and the store does not show', async () => {
    const res = await GET(req(), ctx);
    expect(res.status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('404s once the license is refunded or disputed (download_unlocked false)', async () => {
    lists.license_purchases = [{ download_unlocked: false }];
    expect((await GET(req(), ctx)).status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('404s a bundle whose access has expired', async () => {
    lists.project_access_links = [{ project_id: PROJECT, expires_at: '2000-01-01T00:00:00Z' }];
    lists.project_tracks = [{ track_id: TRACK }];
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('still plays a listed beat the buyer has not bought', async () => {
    publicly.ok = true;
    singles.tracks = track({ store_listed: true });
    expect((await GET(req(), ctx)).status).toBe(200);
  });

  it('never streams a private master: an owned beat with no preview 404s', async () => {
    lists.license_purchases = [{ download_unlocked: true }];
    singles.tracks = track({ preview_url: null });
    expect((await GET(req(), ctx)).status).toBe(404);
    expect(streamed).toEqual([]);
  });

  it('404s a track that does not exist', async () => {
    delete singles.tracks;
    lists.license_purchases = [{ download_unlocked: true }];
    expect((await GET(req(), ctx)).status).toBe(404);
  });
});
