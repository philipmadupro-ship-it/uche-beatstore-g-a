/**
 * Route tests for /api/store/delivery.
 *
 * Reliability contract:
 * - revoked track purchases cannot download
 * - project purchases return the frozen project_access_links amount
 * - project purchases expose downloads for every project track
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Purchases must be recent for the delivery-link TTL (14d) to allow access.
const FRESH_ISO = new Date().toISOString();

const mockIsSupabaseConfigured = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppUrl: () => 'https://example.test',
}));

function req(sessionId = 'cs_test_123'): NextRequest {
  return new NextRequest(`http://localhost/api/store/delivery?session_id=${sessionId}`);
}

function tableForProjectDelivery(table: string) {
  if (table === 'license_purchases') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    };
  }
  if (table === 'project_access_links') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: {
              id: 'access-1',
              project_id: 'project-1',
              buyer_email: 'buyer@example.test',
              amount_usd: 49,
              created_at: FRESH_ISO,
              stripe_session_id: 'cs_test_123',
            },
            error: null,
          }),
        }),
      }),
    };
  }
  if (table === 'project_tracks') {
    return {
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [{ track_id: 'track-1' }], error: null }),
        }),
      }),
    };
  }
  if (table === 'tracks') {
    return {
      select: () => ({
        in: () => Promise.resolve({
          data: [{
            id: 'track-1',
            title: 'Bundle Beat',
            type: 'beat',
            audio_url: 'https://cdn.example.test/bundle.mp3',
            wav_url: null,
            stems_status: 'none',
          }],
          error: null,
        }),
      }),
    };
  }
  if (table === 'stems') {
    return {
      select: () => ({
        in: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };
  }
  return {};
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockFrom.mockImplementation((table: string) => tableForProjectDelivery(table));
});

describe('GET /api/store/delivery', () => {
  it('rejects revoked track-license purchases', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'license_purchases') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  id: 'purchase-1',
                  buyer_email: 'buyer@example.test',
                  amount_usd: 30,
                  created_at: FRESH_ISO,
                  status: 'refunded',
                  download_unlocked: false,
                  track_ids: ['track-1'],
                  line_items: [{ track_id: 'track-1', license_type: 'lease' }],
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return tableForProjectDelivery(table);
    });

    const mod = await loadRoute();
    const res = await mod.GET(req());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Download access revoked (refunded or disputed)' });
  });

  it('returns project access amount and downloadable project tracks', async () => {
    const mod = await loadRoute();
    const res = await mod.GET(req());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purchase).toEqual({
      id: 'access-1',
      buyer_email: 'buyer@example.test',
      amount_usd: 49,
      created_at: FRESH_ISO,
      status: 'paid',
    });
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].license_type).toBe('exclusive');
    expect(body.tracks[0].downloads[0]).toEqual({
      format: 'mp3',
      label: 'MP3',
      proxied_url: expect.stringContaining('/api/audio?src='),
    });
  });

  it('410s a session link older than the TTL (downloads then live in the account)', async () => {
    const oldIso = new Date(Date.now() - 60 * 86_400_000).toISOString(); // 60 days ago
    mockFrom.mockImplementation((table: string) => {
      if (table === 'project_access_links') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  id: 'access-1', project_id: 'project-1', buyer_email: 'buyer@example.test',
                  amount_usd: 49, created_at: oldIso, stripe_session_id: 'cs_test_123',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return tableForProjectDelivery(table);
    });

    const mod = await loadRoute();
    const res = await mod.GET(req());
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('link_expired');
  });
});
