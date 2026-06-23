/**
 * Route tests for /api/share.
 *
 * Regression coverage for the legacy share-link creation path:
 * Supabase mode must require an authenticated producer and must not let
 * that producer mint share links for tracks they do not own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockRequireUser = vi.fn();
const mockTracksIn = vi.fn();
const mockShareInsert = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  requireUser: () => mockRequireUser(),
  createServiceClient: vi.fn(),
  getAll: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  getAppUrl: () => 'https://example.test',
}));

vi.mock('nanoid', () => ({
  nanoid: () => 'share-token',
}));

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function adminClient() {
  return {
    from: (table: string) => {
      if (table === 'tracks') {
        return {
          select: () => ({
            eq: () => ({
              in: mockTracksIn,
            }),
          }),
        };
      }
      if (table === 'share_links') {
        return {
          insert: mockShareInsert,
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockShareInsert.mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'link-1', token: 'share-token' }, error: null }),
    }),
  });
});

describe('POST /api/share', () => {
  it('requires an authenticated producer in Supabase mode', async () => {
    mockRequireUser.mockResolvedValueOnce({
      ok: false,
      res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const mod = await loadRoute();
    const res = await mod.POST(post({ track_ids: ['track-1'] }));

    expect(res.status).toBe(401);
    expect(mockTracksIn).not.toHaveBeenCalled();
    expect(mockShareInsert).not.toHaveBeenCalled();
  });

  it('rejects share creation when any requested track is not owned by the caller', async () => {
    mockRequireUser.mockResolvedValueOnce({ ok: true, userId: 'user-1', admin: adminClient() });
    mockTracksIn.mockResolvedValueOnce({ data: [{ id: 'track-1' }], error: null });

    const mod = await loadRoute();
    const res = await mod.POST(post({ track_ids: ['track-1', 'track-2'] }));

    expect(res.status).toBe(403);
    expect(mockTracksIn).toHaveBeenCalledWith('id', ['track-1', 'track-2']);
    expect(mockShareInsert).not.toHaveBeenCalled();
  });

  it('writes the authenticated owner id onto new share links', async () => {
    mockRequireUser.mockResolvedValueOnce({ ok: true, userId: 'user-1', admin: adminClient() });
    mockTracksIn.mockResolvedValueOnce({ data: [{ id: 'track-1' }, { id: 'track-2' }], error: null });

    const mod = await loadRoute();
    const res = await mod.POST(post({ track_ids: ['track-1', 'track-2'], allow_downloads: true }));

    expect(res.status).toBe(200);
    expect(mockShareInsert).toHaveBeenCalledWith(expect.objectContaining({
      token: 'share-token',
      user_id: 'user-1',
      track_ids: ['track-1', 'track-2'],
    }));
  });
});
