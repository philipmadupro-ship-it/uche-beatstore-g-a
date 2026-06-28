import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockQuery = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => false,
  requireUser: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function req(body: unknown) {
  return new NextRequest('http://localhost/api/tracks/reorder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/tracks/reorder', () => {
  it('updates store_sort_order for existing local tracks', async () => {
    mockQuery.mockReturnValue([{ id: 'track-1' }, { id: 'track-2' }]);
    const mod = await import('./route');

    const res = await mod.PATCH(req({
      items: [
        { id: 'track-1', store_sort_order: 0 },
        { id: 'track-2', store_sort_order: 1 },
      ],
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    expect(mockUpdate).toHaveBeenCalledWith('tracks', 'track-1', { store_sort_order: 0 });
    expect(mockUpdate).toHaveBeenCalledWith('tracks', 'track-2', { store_sort_order: 1 });
  });

  it('rejects duplicate ids', async () => {
    const mod = await import('./route');

    const res = await mod.PATCH(req({
      items: [
        { id: 'track-1', store_sort_order: 0 },
        { id: 'track-1', store_sort_order: 1 },
      ],
    }));

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
