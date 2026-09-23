/**
 * Route tests for /api/share/[token]/checkout.
 *
 * Contract: a share link must refuse what /api/store/checkout refuses —
 * exclusive rights that already sold, and exclusive tiers on a beat with no
 * WAV and no ready stems. Before this the share route checked neither, so a
 * buyer could pay for files that did not exist and nothing flagged the sale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

const mockSessionsCreate = vi.fn();
const mockTracks: Array<Record<string, unknown>> = [];

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ checkout: { sessions: { create: mockSessionsCreate } } }),
  isStripeConfigured: () => true,
}));

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimitDurable: () => Promise.resolve(true),
  clientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://example.test' }));

/** Rows each table returns. Tests overwrite these before importing the route. */
const db: Record<string, unknown> = {};

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const rows = () => db[table];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: () => Promise.resolve({ data: Array.isArray(rows()) ? (rows() as unknown[])[0] ?? null : rows() ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: table === 'tracks' ? mockTracks : rows() ?? [], error: null }).then(res, rej),
      };
      return q;
    },
  }),
}));

function openProjectShare(overrides: Record<string, unknown> = {}) {
  db.project_shares = {
    token: 'tok', content_type: 'project', project_id: 'p1', sales_enabled: true,
    revoked_at: null, expires_at: null, password_hash: null, ...overrides,
  };
  db.projects = { user_id: 'seller-1', name: 'Tape' };
  db.project_tracks = [{ track_id: 'track-1' }];
  db.creator_profiles = { license_lease_price_usd: 30, license_exclusive_price_usd: 250 };
}

function post(licenseId: string, opts: { trackId?: string; password?: string } = {}) {
  const req = new NextRequest('http://localhost/api/share/tok/checkout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.password ? { 'x-share-password': opts.password } : {}),
    },
    body: JSON.stringify({
      buyer_email: 'buyer@example.test',
      cart_items: [{ track_id: opts.trackId ?? 'track-1', license_id: licenseId }],
    }),
  });
  return { req, ctx: { params: Promise.resolve({ token: 'tok' }) } };
}

function track(overrides: Record<string, unknown>) {
  mockTracks.push({
    id: 'track-1', title: 'Beat', lease_price_usd: 30, exclusive_price_usd: 250,
    exclusive_sold: false, wav_url: null, stems_status: null, ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTracks.length = 0;
  for (const k of Object.keys(db)) delete db[k];
  openProjectShare();
  mockSessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/cs_1' });
});

describe('share checkout exclusive gate', () => {
  it('rejects exclusive rights on a beat with no WAV and no ready stems', async () => {
    track({});
    const { POST } = await import('./route');
    const { req, ctx } = post('exclusive-rights');
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('rejects any license once exclusive rights have sold', async () => {
    track({ exclusive_sold: true, wav_url: 'r2://private/beat.wav' });
    const { POST } = await import('./route');
    const { req, ctx } = post('lease');
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('sells exclusive rights when a WAV exists', async () => {
    track({ wav_url: 'r2://private/beat.wav' });
    const { POST } = await import('./route');
    const { req, ctx } = post('exclusive-rights');
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('still sells a lease on a beat with no WAV', async () => {
    track({});
    const { POST } = await import('./route');
    const { req, ctx } = post('lease');
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
  });
});

describe('share checkout enforces the share settings', () => {
  beforeEach(() => track({}));

  it('refuses a share with purchases disabled', async () => {
    openProjectShare({ sales_enabled: false });
    const { POST } = await import('./route');
    const { req, ctx } = post('lease');
    expect((await POST(req, ctx)).status).toBe(403);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('refuses a revoked share', async () => {
    openProjectShare({ revoked_at: '2026-01-01T00:00:00Z' });
    const { POST } = await import('./route');
    const { req, ctx } = post('lease');
    expect((await POST(req, ctx)).status).toBe(410);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('refuses an expired share', async () => {
    openProjectShare({ expires_at: '2020-01-01T00:00:00Z' });
    const { POST } = await import('./route');
    const { req, ctx } = post('lease');
    expect((await POST(req, ctx)).status).toBe(410);
  });

  it('refuses a beat that is not part of the share', async () => {
    mockTracks.push({ id: 'track-9', title: 'Other', lease_price_usd: 30, exclusive_sold: false });
    const { POST } = await import('./route');
    const { req, ctx } = post('lease', { trackId: 'track-9' });
    expect((await POST(req, ctx)).status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('requires the password on a locked share, and accepts the right one', async () => {
    openProjectShare({ password_hash: bcrypt.hashSync('open sesame', 4) });
    const { POST } = await import('./route');

    const missing = post('lease');
    expect((await POST(missing.req, missing.ctx)).status).toBe(401);
    const wrong = post('lease', { password: 'nope' });
    expect((await POST(wrong.req, wrong.ctx)).status).toBe(401);
    expect(mockSessionsCreate).not.toHaveBeenCalled();

    const right = post('lease', { password: 'open sesame' });
    expect((await POST(right.req, right.ctx)).status).toBe(200);
  });

  it('sells from a playlist share, taking the seller from the playlist owner', async () => {
    delete db.projects;
    db.project_shares = { token: 'tok', content_type: 'playlist', playlist_id: 'pl1', sales_enabled: true };
    db.playlists = { user_id: 'seller-1', name: 'Mix' };
    db.playlist_tracks = [{ track_id: 'track-1' }];
    const { POST } = await import('./route');
    const { req, ctx } = post('lease');
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockSessionsCreate.mock.calls[0][0].metadata.seller_user_id).toBe('seller-1');
  });

  it('sells from a legacy share link limited to its track_ids', async () => {
    delete db.project_shares;
    db.share_links = { token: 'tok', user_id: 'seller-1', title: 'Pack', track_ids: ['track-1'], sales_enabled: true };
    const { POST } = await import('./route');
    const ok = post('lease');
    expect((await POST(ok.req, ok.ctx)).status).toBe(200);
    expect(mockSessionsCreate.mock.calls[0][0].metadata.is_project_share).toBe('false');
  });
});
