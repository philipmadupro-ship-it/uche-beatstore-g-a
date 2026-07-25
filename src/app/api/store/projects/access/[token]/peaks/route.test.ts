import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockIsSupabaseConfigured = vi.fn();
const mockFromQueue: Array<(table: string) => unknown> = [];
const mockStreamAudioPreviewSource = vi.fn();

vi.mock('@/lib/local-store', () => ({
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

const TOKEN = 'a'.repeat(48);

function req(trackId = 'track-a'): NextRequest {
  return new NextRequest(`http://localhost/api/store/projects/access/${TOKEN}/peaks?track_id=${trackId}`);
}

function singleResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data, error }),
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error }),
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
  mockStreamAudioPreviewSource.mockResolvedValue(new NextResponse('{"peaks":[0.1,0.8]}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
});

describe('GET /api/store/projects/access/[token]/peaks', () => {
  it('streams peaks for a valid access token and project track', async () => {
    mockFromQueue.push(
      singleResult({ project_id: 'proj-1', expires_at: null }),
      singleResult({ track_id: 'track-a' }),
      singleResult({ peaks_url: 'https://pub.r2.dev/peaks/a.json' }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    expect(mockStreamAudioPreviewSource).toHaveBeenCalledWith(expect.any(NextRequest), 'https://pub.r2.dev/peaks/a.json');
  });

  it('rejects missing track_id', async () => {
    const mod = await loadRoute();
    const res = await mod.GET(
      new NextRequest(`http://localhost/api/store/projects/access/${TOKEN}/peaks`),
      { params: Promise.resolve({ token: TOKEN }) },
    );

    expect(res.status).toBe(400);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('returns 404 when the access token is expired', async () => {
    mockFromQueue.push(singleResult({
      project_id: 'proj-1',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }));

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });

    expect(res.status).toBe(404);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('returns 404 when the track is outside the purchased project', async () => {
    mockFromQueue.push(
      singleResult({ project_id: 'proj-1', expires_at: null }),
      singleResult(null),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req('track-b'), { params: Promise.resolve({ token: TOKEN }) });

    expect(res.status).toBe(404);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });

  it('returns 404 when the included track has no peaks sidecar', async () => {
    mockFromQueue.push(
      singleResult({ project_id: 'proj-1', expires_at: null }),
      singleResult({ track_id: 'track-a' }),
      singleResult({ peaks_url: null }),
    );

    const mod = await loadRoute();
    const res = await mod.GET(req(), { params: Promise.resolve({ token: TOKEN }) });

    expect(res.status).toBe(404);
    expect(mockStreamAudioPreviewSource).not.toHaveBeenCalled();
  });
});
