/**
 * Track-mode route tests for /api/store/checkout.
 *
 * Reliability contract:
 * - exclusive checkout writes stems_pending_track_ids when delivery files are not ready
 * - exclusive checkout leaves stems_pending_track_ids empty when either ready stems or a WAV exists
 * - promo usage is not incremented until the paid webhook completion path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSessionsCreate = vi.fn();
const mockIsStripeConfigured = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockRpc = vi.fn();
const mockTracks: Array<Record<string, unknown>> = [];
const mockLicenses: Array<Record<string, unknown>> = [];
const mockTrackLicenses: Array<Record<string, unknown>> = [];
let mockPromo: Record<string, unknown> | null = null;
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
      if (table === 'licenses') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: mockLicenses, error: null }),
          }),
        };
      }
      if (table === 'track_licenses') {
        return {
          select: () => ({
            in: () => ({
              in: () => Promise.resolve({ data: mockTrackLicenses, error: null }),
            }),
          }),
        };
      }
      if (table === 'abandoned_carts') {
        return { insert: vi.fn(() => Promise.resolve({ error: null })) };
      }
      if (table === 'promo_codes') {
        return {
          select: () => ({
            ilike: () => ({
              maybeSingle: () => Promise.resolve({ data: mockPromo, error: null }),
            }),
          }),
        };
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
    rpc: mockRpc,
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
  mockLicenses.length = 0;
  mockTrackLicenses.length = 0;
  mockPromo = null;
  mockIsStripeConfigured.mockReturnValue(true);
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockSessionsCreate.mockResolvedValue({ id: 'cs_test_123', client_secret: 'secret_123' });
  mockRpc.mockResolvedValue({ error: null });
});

describe('POST /api/store/checkout — track mode exclusive delivery metadata', () => {
  it('uses an enabled custom tier base price when its track override is null', async () => {
    const licenseId = '11111111-1111-4111-8111-111111111111';
    mockTracks.push({
      id: 'track-1',
      user_id: 'seller-1',
      title: 'Custom Tier Beat',
      store_listed: true,
      exclusive_sold: false,
      lease_price_usd: 30,
      exclusive_price_usd: 250,
      wav_url: 'https://cdn.example.test/beat.wav',
      stems_status: 'none',
    });
    mockLicenses.push({
      id: licenseId,
      user_id: 'seller-1',
      name: 'WAV Lease',
      price_usd: 75,
      is_exclusive: false,
      is_free: false,
      file_types: ['MP3', 'WAV'],
      stems_included: false,
    });
    mockTrackLicenses.push({
      track_id: 'track-1',
      license_id: licenseId,
      price_override_usd: null,
      enabled: true,
    });

    const mod = await loadRoute();
    const res = await mod.POST(postBody({
      buyer_email: 'buyer@example.test',
      items: [{ track_id: 'track-1', license_id: licenseId, license_type: 'lease' }],
    }));

    expect(res.status).toBe(200);
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(7500);
    expect(JSON.parse(args.metadata.cart_items)).toEqual([{
      track_id: 'track-1',
      license_id: licenseId,
      license_type: 'lease',
    }]);
  });

  it('rejects a custom license that belongs to another seller', async () => {
    const licenseId = '22222222-2222-4222-8222-222222222222';
    mockTracks.push({
      id: 'track-1',
      user_id: 'seller-1',
      title: 'Seller Scoped Beat',
      store_listed: true,
      exclusive_sold: false,
      lease_price_usd: 30,
      exclusive_price_usd: 250,
    });
    mockLicenses.push({
      id: licenseId,
      user_id: 'seller-2',
      name: 'Other Seller Tier',
      price_usd: 1,
      is_exclusive: true,
      is_free: false,
      file_types: ['MP3', 'WAV', 'STEMS'],
      stems_included: true,
    });

    const mod = await loadRoute();
    const res = await mod.POST(postBody({
      buyer_email: 'buyer@example.test',
      items: [{ track_id: 'track-1', license_id: licenseId, license_type: 'exclusive' }],
    }));

    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('allows exclusive checkout and marks stems pending when neither WAV nor ready stems exist', async () => {
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

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(25000);
    expect(args.metadata.license_type).toBe('exclusive');
    expect(args.metadata.stems_pending_track_ids).toBe('track-1');
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
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.metadata.stems_pending_track_ids).toBe('');
  });

  it('validates promo codes but does not increment usage at session creation', async () => {
    mockTracks.push({
      id: 'track-1',
      user_id: 'seller-1',
      title: 'Promo Beat',
      store_listed: true,
      exclusive_sold: false,
      exclusive_price_usd: 250,
      lease_price_usd: 30,
      wav_url: null,
      stems_status: 'none',
    });
    mockPromo = {
      code: 'SAVE10',
      user_id: 'seller-1',
      active: true,
      discount_percent: 10,
      discount_amount: 0,
      uses_count: 0,
      max_uses: 10,
    };

    const mod = await loadRoute();
    const res = await mod.POST(postBody({ ...exclusiveBody(), promo_code: 'SAVE10' }));

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(22500);
    expect(args.metadata.promo_code).toBe('SAVE10');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
