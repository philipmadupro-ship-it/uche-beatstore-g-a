import { describe, expect, it, vi } from 'vitest';

const mockGetAll = vi.fn();

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => false,
  getAll: (...args: unknown[]) => mockGetAll(...args),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: vi.fn(),
  safeSellerId: (id?: string) => id ?? '',
}));

function seedLocalStore() {
  mockGetAll.mockImplementation((table: string) => {
    if (table === 'tracks') {
      return [
        { id: 'track-1', store_listed: true, key: 'C', bpm: 120, lease_price_usd: 25 },
        { id: 'track-2', store_listed: true, key: 'F#', bpm: 145, lease_price_usd: 40 },
        { id: 'track-3', store_listed: false, key: 'A', bpm: 90, lease_price_usd: 10 },
      ];
    }
    if (table === 'track_tags') {
      return [
        { track_id: 'track-1', tag: 'Trap', category: 'genre' },
        { track_id: 'track-2', tag: 'Dark', category: 'mood' },
        { track_id: 'track-3', tag: 'Hidden', category: 'genre' },
      ];
    }
    return [];
  });
}

describe('GET /api/store/facets', () => {
  it('returns facets for the public listed catalogue only', async () => {
    seedLocalStore();
    const mod = await import('./route');

    const res = await mod.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      total: 2,
      genres: ['Trap'],
      moods: ['Dark'],
      keys: ['C', 'F#'],
      bpmRange: { min: 120, max: 145 },
      priceRange: { min: 25, max: 40 },
    });
  });
});
