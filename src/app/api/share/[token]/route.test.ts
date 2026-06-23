/**
 * Route tests for /api/share/[token].
 *
 * Legacy share links are public, but revoked links should stop resolving
 * just like expired links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockFromQueue: Array<(table: string) => any> = [];

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  createServiceClient: () => ({
    from: (table: string) => {
      const handler = mockFromQueue.shift();
      if (!handler) throw new Error(`No mock for from('${table}') - queue empty`);
      return handler(table);
    },
  }),
  getAll: vi.fn(),
  update: vi.fn(),
  deleteRow: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

function maybeSingleResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data, error }),
      }),
    }),
  });
}

function req(): NextRequest {
  return new NextRequest('http://localhost/api/share/share-token');
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromQueue.length = 0;
  mockIsSupabaseConfigured.mockReturnValue(true);
});

describe('GET /api/share/[token]', () => {
  it('returns 410 for revoked legacy share links', async () => {
    mockFromQueue.push(maybeSingleResult({
      token: 'share-token',
      track_ids: ['track-1'],
      revoked_at: new Date().toISOString(),
      expires_at: null,
      password_hash: null,
    }));

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: 'share-token' }) });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/revoked/i);
    expect(mockFromQueue).toHaveLength(0);
  });
});
