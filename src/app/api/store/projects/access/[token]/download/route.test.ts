/**
 * Route tests for /api/store/projects/access/[token]/download.
 *
 * Public, token-gated. A 500 must never carry DB/storage internals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockFrom = vi.fn();
const mockStream = vi.fn();

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({ from: (t: string) => mockFrom(t) }),
}));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioSource: (...a: unknown[]) => mockStream(...a),
}));

const one = (data: unknown, error: unknown = null) => ({
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }), eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }) }),
});

function req(): NextRequest {
  return new NextRequest('http://localhost/api/store/projects/access/tok/download?track_id=track-1&format=mp3');
}
const ctx = { params: Promise.resolve({ token: 'tok' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockStream.mockResolvedValue(new NextResponse('audio'));
});

describe('GET /api/store/projects/access/[token]/download', () => {
  it('does not echo internal error text to the buyer', async () => {
    mockFrom.mockImplementation(() => { throw new Error('relation "project_access_links" secret-internal-detail'); });
    const { GET } = await import('./route');
    const res = await GET(req(), ctx);

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-internal-detail');
  });

  it('answers 404 for an unknown or expired token, and streams for a live one', async () => {
    const { GET } = await import('./route');

    mockFrom.mockImplementation(() => one(null));
    expect((await GET(req(), ctx)).status).toBe(404);

    mockFrom.mockImplementation(() => one({ project_id: 'p', expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect((await GET(req(), ctx)).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();

    mockFrom.mockImplementation((t: string) => {
      if (t === 'project_access_links') return one({ project_id: 'p', expires_at: null });
      if (t === 'project_tracks') return one({ track_id: 'track-1' });
      return one({ audio_url: 'https://cdn.example.test/a.mp3', wav_url: null, title: 'Beat' });
    });
    expect((await GET(req(), ctx)).status).toBe(200);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });
});
