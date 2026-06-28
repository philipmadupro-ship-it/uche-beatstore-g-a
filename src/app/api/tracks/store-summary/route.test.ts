import { describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => false,
  requireUser: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
}));

describe('GET /api/tracks/store-summary', () => {
  it('returns listing counts, producer picks, and issue counts', async () => {
    mockQuery.mockImplementation((table: string) => {
      if (table === 'tracks') {
        return [
          { id: 'a', title: 'A', store_listed: true, store_featured: true, cover_url: 'cover.jpg', lease_price_usd: 25, bpm: 120 },
          { id: 'b', title: 'B', store_listed: true, store_featured: false, cover_url: null, lease_price_usd: null, exclusive_price_usd: null },
          { id: 'c', title: 'C', store_listed: false, store_featured: true, cover_url: null },
        ];
      }
      if (table === 'creator_profiles') {
        return [{ license_lease_price_usd: null, license_exclusive_price_usd: null }];
      }
      if (table === 'licenses') return [];
      if (table === 'track_licenses') return [];
      return [];
    });
    const mod = await import('./route');

    const res = await mod.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.listed).toBe(2);
    expect(body.producerPicks.map((track: { id: string }) => track.id)).toEqual(['a']);
    expect(body.issues).toEqual({
      noCover: { count: 1, firstId: 'b' },
      noPrice: { count: 1, firstId: 'b' },
      noBpmKey: { count: 1, firstId: 'b' },
    });
  });

  it('does not flag missing price when global license tiers make a beat sellable', async () => {
    vi.resetModules();
    mockQuery.mockImplementation((table: string) => {
      if (table === 'tracks') {
        return [
          { id: 'a', title: 'A', store_listed: true, store_featured: false, cover_url: 'cover.jpg', lease_price_usd: null, exclusive_price_usd: null, bpm: 120 },
        ];
      }
      if (table === 'creator_profiles') {
        return [{ license_lease_price_usd: null, license_exclusive_price_usd: null }];
      }
      if (table === 'licenses') return [{ id: 'lease', price_usd: 30, is_free: false }];
      if (table === 'track_licenses') return [];
      return [];
    });
    const mod = await import('./route');

    const res = await mod.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.issues.noPrice).toEqual({ count: 0, firstId: null });
  });
});
