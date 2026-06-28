import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAll = vi.fn();

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => false,
  getAll: (...args: unknown[]) => mockGetAll(...args),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: vi.fn(),
  safeSellerId: (id?: string) => id ?? '',
}));

function req(path = '/api/store') {
  return new NextRequest(`http://localhost${path}`);
}

function seedLocalStore() {
  mockGetAll.mockImplementation((table: string) => {
    if (table === 'tracks') {
      return Array.from({ length: 5 }, (_, index) => ({
        id: `track-${index + 1}`,
        title: `Track ${index + 1}`,
        store_listed: true,
        audio_url: `r2://privatebuckets/tracks/${index + 1}.wav`,
        type: index === 4 ? 'song' : 'beat',
      }));
    }
    if (table === 'track_tags') {
      return [
        { track_id: 'track-1', tag: 'Trap', category: 'genre' },
        { track_id: 'track-2', tag: 'Drill', category: 'genre' },
        { track_id: 'track-3', tag: 'Trap', category: 'genre' },
        { track_id: 'track-3', tag: 'Dark', category: 'mood' },
      ];
    }
    return [];
  });
}

describe('GET /api/store', () => {
  it('keeps the legacy full-catalogue response when no limit is provided', async () => {
    seedLocalStore();
    const mod = await import('./route');

    const res = await mod.GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks).toHaveLength(5);
    expect(body.pageInfo).toBeUndefined();
  });

  it('returns a bounded page and cursor when limit is provided', async () => {
    seedLocalStore();
    const mod = await import('./route');

    const res = await mod.GET(req('/api/store?limit=2&cursor=2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks.map((track: { id: string }) => track.id)).toEqual(['track-3', 'track-4']);
    expect(body.pageInfo).toEqual({ hasMore: true, nextCursor: '4' });
  });

  it('filters before paginating the catalogue', async () => {
    seedLocalStore();
    const mod = await import('./route');

    const res = await mod.GET(req('/api/store?limit=1&genre=Trap&cursor=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks.map((track: { id: string }) => track.id)).toEqual(['track-3']);
    expect(body.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });
});
