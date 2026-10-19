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
const mockRateLimit = vi.fn();
vi.mock('@/lib/security/rate-limit', () => ({
  rateLimitDurable: (...a: unknown[]) => mockRateLimit(...a),
  clientIp: () => '203.0.113.9',
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
  mockRateLimit.mockResolvedValue(true);
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

  describe('audit log and rate limit', () => {
    let audit: Array<Record<string, unknown>> = [];

    function live(expiresAt: string | null = null, track: string | null = 'track-1') {
      audit = [];
      mockFrom.mockImplementation((t: string) => {
        if (t === 'store_events') return { insert: (row: Record<string, unknown>) => { audit.push(row); return Promise.resolve({ error: null }); } };
        if (t === 'project_access_links') return one({ id: 'access-1', project_id: 'p', expires_at: expiresAt, seller_user_id: 'seller-1' });
        if (t === 'project_tracks') return one(track ? { track_id: track } : null);
        return one({ audio_url: 'https://cdn.example.test/a.mp3', wav_url: null, title: 'Beat' });
      });
    }

    it('writes a granted event naming the bundle purchase, not the token', async () => {
      live();
      const { GET } = await import('./route');
      expect((await GET(req(), ctx)).status).toBe(200);

      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        event_type: 'download', seller_user_id: 'seller-1',
        metadata: { purchase_kind: 'project', purchase_id: 'access-1', format: 'mp3', outcome: 'granted' },
      });
      expect(JSON.stringify(audit[0])).not.toContain('tok');
    });

    it('writes a denied event for an expired link and for a track outside the bundle', async () => {
      const { GET } = await import('./route');

      live(new Date(Date.now() - 1000).toISOString());
      expect((await GET(req(), ctx)).status).toBe(404);
      expect(audit[0].metadata).toMatchObject({ outcome: 'denied', reason: 'expired' });

      live(null, null);
      expect((await GET(req(), ctx)).status).toBe(404);
      expect(audit[0].metadata).toMatchObject({ outcome: 'denied', reason: 'track-not-in-purchase' });
      expect(mockStream).not.toHaveBeenCalled();
    });

    it('logs nothing for an unknown token, and nothing for the pre-check', async () => {
      const { GET } = await import('./route');
      audit = [];
      mockFrom.mockImplementation(() => one(null));
      expect((await GET(req(), ctx)).status).toBe(404);
      expect(audit).toEqual([]);

      live();
      const probe = new NextRequest(req().url, { headers: { range: 'bytes=0-0', 'x-download-probe': '1' } });
      expect((await GET(probe, ctx)).status).toBe(200);
      expect(audit).toEqual([]);
    });

    it('answers 429 over the limit before any lookup', async () => {
      live();
      mockRateLimit.mockResolvedValue(false);
      const { GET } = await import('./route');
      const res = await GET(req(), ctx);

      expect(res.status).toBe(429);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});
