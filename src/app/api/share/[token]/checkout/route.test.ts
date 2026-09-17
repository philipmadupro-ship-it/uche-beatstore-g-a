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

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'tracks') {
        return { select: () => ({ in: () => Promise.resolve({ data: mockTracks, error: null }) }) };
      }
      const single = (data: unknown) => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) }),
      });
      if (table === 'project_shares') {
        return single({ project_id: 'p1', lease_price_usd: null, exclusive_price_usd: null, discount_percent: null, projects: { user_id: 'seller-1', name: 'Tape' } });
      }
      if (table === 'creator_profiles') {
        return single({ license_lease_price_usd: 30, license_exclusive_price_usd: 250 });
      }
      return single(null);
    },
  }),
}));

function post(licenseId: string) {
  const req = new NextRequest('http://localhost/api/share/tok/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      buyer_email: 'buyer@example.test',
      cart_items: [{ track_id: 'track-1', license_id: licenseId }],
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
