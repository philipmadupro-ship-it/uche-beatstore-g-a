import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { signedSharePeaksUrl } from '@/lib/share-media-token';

const mockIsSupabaseConfigured = vi.fn();
const mockFromQueue: Array<(table: string) => unknown> = [];
const mockStreamAudioPreviewSource = vi.fn();

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

vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: (...args: unknown[]) => mockStreamAudioPreviewSource(...args),
}));

function req(path = signedSharePeaksUrl('share-token', 'track-1')): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function maybeSingle(data: unknown) {
  return () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data, error: null }),
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error: null }),
        }),
      }),
    }),
  });
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromQueue.length = 0;
  mockIsSupabaseConfigured.mockReturnValue(true);
  vi.stubEnv('SHARE_MEDIA_TOKEN_SECRET', 'test-share-secret');
  mockStreamAudioPreviewSource.mockResolvedValue(new NextResponse('{"peaks":[0.1,0.8]}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
});

describe('GET /api/share/[token]/peaks/[trackId]', () => {
  it('rejects requests without a valid media grant', async () => {
    const mod = await loadRoute();
    const res = await mod.GET(req('/api/share/share-token/peaks/track-1'), {
      params: Promise.resolve({ token: 'share-token', trackId: 'track-1' }),
    });

    expect(res.status).toBe(403);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('streams peaks for a track included in a flat share link', async () => {
    mockFromQueue.push(
      maybeSingle(null), // project_shares
      maybeSingle({ revoked_at: null, expires_at: null, track_ids: ['track-1'] }),
      maybeSingle({ peaks_url: 'https://pub.r2.dev/peaks/track-1.json' }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req(), {
      params: Promise.resolve({ token: 'share-token', trackId: 'track-1' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    expect(mockStreamAudioPreviewSource).toHaveBeenCalledWith(expect.any(NextRequest), 'https://pub.r2.dev/peaks/track-1.json');
  });

  it('returns 404 when the included track has no peaks sidecar', async () => {
    mockFromQueue.push(
      maybeSingle(null), // project_shares
      maybeSingle({ revoked_at: null, expires_at: null, track_ids: ['track-1'] }),
      maybeSingle({ peaks_url: null }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req(), {
      params: Promise.resolve({ token: 'share-token', trackId: 'track-1' }),
    });

    expect(res.status).toBe(404);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('returns 404 when the share does not include the track', async () => {
    mockFromQueue.push(
      maybeSingle(null), // project_shares
      maybeSingle({ revoked_at: null, expires_at: null, track_ids: ['track-2'] }),
      maybeSingle(null), // project_access_links
    );

    const mod = await loadRoute();
    const res = await mod.GET(req(), {
      params: Promise.resolve({ token: 'share-token', trackId: 'track-1' }),
    });

    expect(res.status).toBe(404);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });
});
