import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockQuery = vi.fn();
const mockScopedList = vi.fn();

vi.mock('@/lib/db', () => ({
  scopedList: (...args: unknown[]) => mockScopedList(...args),
  isErrorResponse: () => false,
  isSupabaseConfigured: () => false,
  createServiceClient: vi.fn(),
  requireUser: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock('@/lib/auth/ownership', () => ({
  safeSellerId: (id?: string) => id ?? '',
}));

function req(path = '/api/tracks') {
  return new NextRequest(`http://localhost${path}`);
}

function seedTracks() {
  const tracks = [
    { id: 'track-1', title: 'Dark Trap', type: 'beat', bpm: 140, key: 'C', store_listed: true, created_at: '2026-01-05T00:00:00Z' },
    { id: 'track-2', title: 'Soft Keys', type: 'song', bpm: 95, key: 'F', store_listed: false, created_at: '2026-01-04T00:00:00Z' },
    { id: 'track-3', title: 'Trap Bounce', type: 'beat', bpm: 150, key: 'G', store_listed: true, created_at: '2026-01-03T00:00:00Z' },
  ];
  mockQuery.mockImplementation((table: string, predicate: (row: any) => boolean) => {
    if (table === 'tracks') return tracks.filter(predicate);
    return [];
  });
  mockScopedList.mockResolvedValue(tracks);
}

describe('GET /api/tracks', () => {
  it('keeps the legacy full-array response without bounded params', async () => {
    seedTracks();
    const mod = await import('./route');

    const res = await mod.GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    expect(mockScopedList).toHaveBeenCalled();
  });

  it('returns a paged object when requested', async () => {
    seedTracks();
    const mod = await import('./route');

    const res = await mod.GET(req('/api/tracks?paged=1&limit=2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks.map((track: { id: string }) => track.id)).toEqual(['track-1', 'track-2']);
    expect(body.pageInfo).toEqual({ hasMore: true, nextCursor: '2' });
  });

  it('searches before slicing bounded results', async () => {
    seedTracks();
    const mod = await import('./route');

    const res = await mod.GET(req('/api/tracks?paged=1&q=trap&limit=1&cursor=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks.map((track: { id: string }) => track.id)).toEqual(['track-3']);
    expect(body.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });

  it('filters store-listed tracks before pagination', async () => {
    seedTracks();
    const mod = await import('./route');

    const res = await mod.GET(req('/api/tracks?paged=1&store_listed=1&limit=1&cursor=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks.map((track: { id: string }) => track.id)).toEqual(['track-3']);
    expect(body.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });

  it('keeps a 600-track catalogue bounded to the requested page', async () => {
    const tracks = Array.from({ length: 600 }, (_, index) => ({
      id: `track-${index + 1}`,
      title: `Beat ${String(index + 1).padStart(3, '0')}`,
      type: 'beat',
      store_listed: true,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 600 - index)).toISOString(),
    }));
    mockQuery.mockImplementation((table: string, predicate: (row: any) => boolean) => {
      if (table === 'tracks') return tracks.filter(predicate);
      return [];
    });
    const mod = await import('./route');

    const res = await mod.GET(req('/api/tracks?paged=1&lean=1&limit=100&cursor=500'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tracks).toHaveLength(100);
    expect(body.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });
});
