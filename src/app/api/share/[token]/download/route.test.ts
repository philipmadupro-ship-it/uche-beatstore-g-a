/**
 * Route tests for /api/share/[token]/download.
 *
 * The download gate must prove the requested track belongs to the resolved
 * token before allowing free or paid downloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockCompare = vi.fn();
const mockFromQueue: Array<(table: string) => any> = [];

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const handler = mockFromQueue.shift();
      if (!handler) throw new Error(`No mock for from('${table}') - queue empty`);
      return handler(table);
    },
  }),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
}));

function maybeSingleResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => eqChain(Promise.resolve({ data, error })),
  });
}

function eqChain(result: Promise<{ data: unknown; error: unknown }>): any {
  return {
    eq: () => eqChain(result),
    maybeSingle: () => result,
  };
}

function req(trackId = 'track-b', password?: string): NextRequest {
  return new NextRequest(`http://localhost/api/share/share-token/download?track_id=${trackId}`, {
    headers: password ? { 'x-share-password': password } : undefined,
  });
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromQueue.length = 0;
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockCompare.mockReset();
});

describe('GET /api/share/[token]/download', () => {
  it('rejects a legacy share-link download for a track outside track_ids', async () => {
    mockFromQueue.push(
      maybeSingleResult(null),
      maybeSingleResult({
        allow_downloads: true,
        revoked_at: null,
        expires_at: null,
        track_ids: ['track-a'],
      }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req('track-b'), { params: Promise.resolve({ token: 'share-token' }) });

    expect(res.status).toBe(403);
    expect(mockFromQueue).toHaveLength(0);
  });

  it('rejects a project-share download when the track is not in the shared project', async () => {
    mockFromQueue.push(
      maybeSingleResult({
        allow_downloads: true,
        revoked_at: null,
        expires_at: null,
        content_type: 'project',
        project_id: 'project-1',
        playlist_id: null,
        track_id: null,
      }),
      maybeSingleResult(null),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req('track-b'), { params: Promise.resolve({ token: 'share-token' }) });

    expect(res.status).toBe(403);
    expect(mockFromQueue).toHaveLength(0);
  });

  it('honors expiry on paid project access tokens', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    mockFromQueue.push(
      maybeSingleResult(null),
      maybeSingleResult(null),
      maybeSingleResult({ project_id: 'project-1', expires_at: past }),
      maybeSingleResult({ track_id: 'track-a' }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req('track-a'), { params: Promise.resolve({ token: 'share-token' }) });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/expired/i);
    expect(mockFromQueue).toHaveLength(0);
  });

  it('requires the password before a protected share download', async () => {
    mockFromQueue.push(
      maybeSingleResult(null),
      maybeSingleResult({
        allow_downloads: true,
        revoked_at: null,
        expires_at: null,
        password_hash: 'hashed-password',
        track_ids: ['track-a'],
      }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req('track-a'), { params: Promise.resolve({ token: 'share-token' }) });

    expect(res.status).toBe(401);
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockFromQueue).toHaveLength(0);
  });
});
