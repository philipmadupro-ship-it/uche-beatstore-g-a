/**
 * Track-mode route tests for /api/store/checkout.
 *
 * Reliability contract:
 * - exclusive checkout is rejected when delivery files are not ready
 * - exclusive checkout is allowed when either ready stems or a WAV exists
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSessionsCreate = vi.fn();
const mockIsStripeConfigured = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockTracks: Array<Record<string, unknown>> = [];
const mockProfile = {
  license_lease_price_usd: 30,
  license_exclusive_price_usd: 250,
  bundle_discount_threshold: 0,
  bundle_discount_percent: 0,
};

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ checkout: { sessions: { create: mockSessionsCreate } } }),
  isStripeConfigured: () => mockIsStripeConfigured(),
}));

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'tracks') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: mockTracks, error: null }),
          }),
        };
      }
      if (table === 'creator_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockProfile, error: null }),
            }),
          }),
        };
      }
      if (table === 'abandoned_carts') {
        return { insert: vi.fn(() => Promise.resolve({ error: null })) };
      }
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          ilike: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
    },
    rpc: vi.fn(() => Promise.resolve({ error: null })),
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppUrl: () => 'https://example.test',
}));

function postBody(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/store/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function exclusiveBody() {
  return {
    buyer_email: 'buyer@example.test',
    items: [{ track_id: 'track-1', license_type: 'exclusive' }],
  };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTracks.length = 0;
  mockIsStripeConfigured.mockReturnValue(true);
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockSessionsCreate.mockResolvedValue({ id: 'cs_test_123', client_secret: 'secret_123' });
});

describe('POST /api/store/checkout — track mode exclusive delivery gate', () => {
  it('rejects exclusive checkout when neither WAV nor ready stems exist', async () => {
    mockTracks.push({
      id: 'track-1',
      user_id: 'seller-1',
      title: 'No Files Beat',
      store_listed: true,
      exclusive_sold: false,
      exclusive_price_usd: 250,
      lease_price_usd: 30,
      wav_url: null,
      stems_status: 'none',
    });

    const mod = await loadRoute();
    const res = await mod.POST(postBody(exclusiveBody()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Exclusive delivery not ready for: No Files Beat' });
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('allows exclusive checkout when stems are ready', async () => {
    mockTracks.push({
      id: 'track-1',
      user_id: 'seller-1',
      title: 'Stem Ready Beat',
      store_listed: true,
      exclusive_sold: false,
      exclusive_price_usd: 250,
      lease_price_usd: 30,
      wav_url: null,
      stems_status: 'done',
    });

    const mod = await loadRoute();
    const res = await mod.POST(postBody(exclusiveBody()));

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(25000);
    expect(args.metadata.license_type).toBe('exclusive');
    expect(args.metadata.stems_pending_track_ids).toBe('');
  });

  it('allows exclusive checkout when a WAV exists even if stems are not ready', async () => {
    mockTracks.push({
      id: 'track-1',
      user_id: 'seller-1',
      title: 'Wav Ready Beat',
      store_listed: true,
      exclusive_sold: false,
      exclusive_price_usd: 250,
      lease_price_usd: 30,
      wav_url: 'https://cdn.example.test/beat.wav',
      stems_status: 'none',
    });

    const mod = await loadRoute();
    const res = await mod.POST(postBody(exclusiveBody()));

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });
});
