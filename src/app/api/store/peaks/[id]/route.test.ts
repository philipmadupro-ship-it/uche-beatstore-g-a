import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockGetById = vi.fn();
const mockFrom = vi.fn();
const mockStreamAudioPreviewSource = vi.fn();

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getById: (...args: unknown[]) => mockGetById(...args),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: (...args: unknown[]) => mockStreamAudioPreviewSource(...args),
}));

function req(): NextRequest {
  return new NextRequest('http://localhost/api/store/peaks/track-1');
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(false);
  mockStreamAudioPreviewSource.mockResolvedValue(new NextResponse('{"peaks":[0.1,0.8]}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
});

describe('GET /api/store/peaks/[id]', () => {
  it('streams peaks for a local store-listed track', async () => {
    mockGetById.mockReturnValue({
      id: 'track-1',
      store_listed: true,
      peaks_url: 'https://pub.r2.dev/peaks/a.json',
    });

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: 'track-1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600');
    expect(mockStreamAudioPreviewSource).toHaveBeenCalledWith(expect.any(NextRequest), 'https://pub.r2.dev/peaks/a.json');
  });

  it('returns 404 when the track is not store-listed', async () => {
    mockGetById.mockReturnValue({
      id: 'track-1',
      store_listed: false,
      peaks_url: 'https://pub.r2.dev/peaks/a.json',
    });

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: 'track-1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Peaks not found');
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('returns 404 when a listed track has no sidecar', async () => {
    mockGetById.mockReturnValue({
      id: 'track-1',
      store_listed: true,
      peaks_url: null,
    });

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: 'track-1' }) });

    expect(res.status).toBe(404);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('queries Supabase and serves a listed producer track', async () => {
    // The gate is the shared public-preview rule now (listed or in a featured
    // bundle, owner must be the producer), so the query no longer filters
    // store_listed itself and the owner is looked up in creator_profiles.
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockFrom.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(table === 'tracks'
            ? {
              data: {
                id: 'track-1',
                user_id: 'producer-1',
                store_listed: true,
                peaks_url: 'https://pub.r2.dev/peaks/a.json',
              },
              error: null,
            }
            : { data: { user_id: 'producer-1' }, error: null }),
        }),
      }),
    }));

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ id: 'track-1' }) });

    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith('tracks');
    expect(mockFrom).toHaveBeenCalledWith('creator_profiles');
    expect(mockStreamAudioPreviewSource).toHaveBeenCalledWith(expect.any(NextRequest), 'https://pub.r2.dev/peaks/a.json');
  });
});
