/**
 * A buyer can hold a Supabase session, and before migration 119 RLS let that
 * session INSERT a track row of its own via PostgREST — store_listed, free
 * download enabled, audio pointed at a private-bucket object. The public
 * stream routes must refuse any track whose owner is not the producer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PRIVATE = 'r2://private-bucket/masters/secret.wav';
let trackRow: Record<string, unknown> | null = null;
let producerIds = new Set<string>();
const mockStream = vi.fn(async () => new Response('bytes', { status: 200 }));

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, rateLimit: () => true, clientIp: () => '1.1.1.1' }));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioSource: (...a: unknown[]) => mockStream(...(a as [])),
  streamAudioPreviewSource: (...a: unknown[]) => mockStream(...(a as [])),
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      let eqVal: unknown;
      const chain = {
        select: () => chain,
        eq: (_c: string, v: unknown) => { eqVal ??= v; return chain; },
        maybeSingle: async () => {
          if (table === 'tracks') return { data: trackRow, error: null };
          if (table === 'creator_profiles') return { data: producerIds.has(String(eqVal)) ? { user_id: eqVal } : null };
          return { data: null };
        },
      };
      return chain;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  producerIds = new Set(['producer-1']);
});

const buyerTrack = () => ({
  id: 't-evil', title: 'x', user_id: 'buyer-1', store_listed: true, free_download_enabled: true,
  audio_url: PRIVATE, preview_url: PRIVATE,
});

describe('public stream routes refuse buyer-owned tracks', () => {
  it('GET /api/store/free-download', async () => {
    trackRow = buyerTrack();
    const { GET } = await import('@/app/api/store/free-download/route');
    const res = await GET(new NextRequest('http://localhost/api/store/free-download?track_id=t-evil'));
    expect(res.status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('GET /api/store/preview/[id]', async () => {
    trackRow = buyerTrack();
    const { GET } = await import('@/app/api/store/preview/[id]/route');
    const res = await GET(new NextRequest('http://localhost/api/store/preview/t-evil'), { params: Promise.resolve({ id: 't-evil' }) });
    expect(res.status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('still serves the producer\'s own listed track', async () => {
    trackRow = { ...buyerTrack(), user_id: 'producer-1', preview_url: 'https://pub.example/p.mp3' };
    const { GET } = await import('@/app/api/store/preview/[id]/route');
    const res = await GET(new NextRequest('http://localhost/api/store/preview/t1'), { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(200);
    expect(mockStream).toHaveBeenCalled();
  });
});
