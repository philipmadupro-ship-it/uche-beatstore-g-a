/**
 * Route tests for /api/store/orders.
 *
 * Security contract:
 * - email-only lookup must not disclose Stripe session IDs or project tokens.
 * - a signed buyer recovery token for the same email is required before the
 *   legacy order payload can include delivery credentials.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signBuyerToken } from '@/lib/buyer-tokens';

const mockIsSupabaseConfigured = vi.fn();
const mockFrom = vi.fn();
const mockCreateServiceClient = vi.fn(() => ({ from: (table: string) => mockFrom(table) }));

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

const ORIGINAL_KEY = process.env.STRIPE_WEBHOOK_SECRET;

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/store/orders?${query}`);
}

function tableForOrders(table: string) {
  if (table === 'license_purchases') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({
              data: [{
                id: 'purchase-1',
                track_ids: ['track-1'],
                line_items: [{ track_id: 'track-1', license_type: 'lease' }],
                amount_usd: 29,
                created_at: '2026-01-02T00:00:00Z',
                stripe_session_id: 'cs_test_track',
                license_type: 'lease',
                status: 'paid',
              }],
              error: null,
            }),
          }),
        }),
      }),
    };
  }
  if (table === 'tracks') {
    return {
      select: () => ({
        in: () => Promise.resolve({
          data: [{ id: 'track-1', title: 'Orbit', cover_url: 'https://cdn.example.test/orbit.jpg' }],
          error: null,
        }),
      }),
    };
  }
  if (table === 'project_access_links') {
    return {
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({
            data: [{
              id: 'access-1',
              project_id: 'project-1',
              token: 'project_access_secret',
              amount_usd: 99,
              created_at: '2026-01-03T00:00:00Z',
              expires_at: null,
              stripe_session_id: 'cs_test_project',
            }],
            error: null,
          }),
        }),
      }),
    };
  }
  if (table === 'projects') {
    return {
      select: () => ({
        in: () => Promise.resolve({
          data: [{ id: 'project-1', name: 'Cosmos Kit', cover_url: null }],
          error: null,
        }),
      }),
    };
  }
  throw new Error(`Unexpected table ${table}`);
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = 'test-secret-key-do-not-use-in-prod';
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockFrom.mockImplementation((table: string) => tableForOrders(table));
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_KEY;
});

describe('GET /api/store/orders', () => {
  it('rejects email-only recovery without querying orders', async () => {
    const mod = await loadRoute();
    const res = await mod.GET(req('email=buyer%40example.test'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Recovery token required' });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects invalid recovery tokens without querying orders', async () => {
    const mod = await loadRoute();
    const res = await mod.GET(req('email=buyer%40example.test&token=not-a-real-token'));

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'Invalid or expired recovery token' });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects a valid token minted for a different email', async () => {
    const token = signBuyerToken('other@example.test');
    const mod = await loadRoute();
    const res = await mod.GET(req(`email=buyer%40example.test&token=${encodeURIComponent(token)}`));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Recovery token does not match email' });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns order delivery credentials for a matching signed recovery token', async () => {
    const token = signBuyerToken('Buyer@Example.test');
    const mod = await loadRoute();
    const res = await mod.GET(req(`email=buyer%40example.test&token=${encodeURIComponent(token)}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toEqual([
      {
        id: 'access-1',
        kind: 'project_bundle',
        project: { id: 'project-1', name: 'Cosmos Kit', cover_url: null },
        amount_usd: 99,
        created_at: '2026-01-03T00:00:00Z',
        token: 'project_access_secret',
        expires_at: null,
      },
      {
        id: 'purchase-1',
        kind: 'track_license',
        tracks: [{ id: 'track-1', title: 'Orbit', cover_url: 'https://cdn.example.test/orbit.jpg' }],
        license_type: 'lease',
        amount_usd: 29,
        created_at: '2026-01-02T00:00:00Z',
        stripe_session_id: 'cs_test_track',
      },
    ]);
  });
});
