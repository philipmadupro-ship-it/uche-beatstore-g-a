import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockConfigured = vi.fn();
const mockRow = vi.fn();
const mockPublic = vi.fn();
const mockOwns = vi.fn();
const mockStream = vi.fn();

vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => mockConfigured() }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockRow(), error: null }) }) }) }),
  }),
}));
vi.mock('@/lib/store/public-preview-access', () => ({ canStreamPublicly: (...a: unknown[]) => mockPublic(...a) }));
vi.mock('@/lib/store/owned-preview-access', () => ({
  sessionOwnsTrack: (...a: unknown[]) => mockOwns(...a),
  ownedStreamHeaders: (h: Headers) => h.set('cache-control', 'private, no-store'),
}));
vi.mock('@/lib/audio/stream-source', () => ({ streamAudioPreviewSource: (...a: unknown[]) => mockStream(...a) }));

const req = () => new NextRequest('http://localhost/api/store/wave/t1');
const call = async () => (await import('./route')).GET(req(), { params: Promise.resolve({ id: 't1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigured.mockReturnValue(true);
  mockRow.mockReturnValue({ preview_url: 'https://pub.r2.dev/previews/a.mp3', audio_url: 'r2://priv/m.wav', store_listed: true, user_id: 'u1' });
  mockPublic.mockResolvedValue(true);
  mockOwns.mockResolvedValue(false);
  mockStream.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
});

describe('GET /api/store/wave/[id]', () => {
  it('streams <preview>.wave.bin for a public track, cached publicly', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockStream).toHaveBeenCalledWith(expect.anything(), 'https://pub.r2.dev/previews/a.mp3.wave.bin');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600');
  });

  it('is 404 for a track the preview route would not serve', async () => {
    mockPublic.mockResolvedValue(false);
    expect((await call()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('serves the owner of a delisted beat, privately', async () => {
    mockPublic.mockResolvedValue(false);
    mockOwns.mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('is 404 without a public preview (never derives a file from the master) and when the file is missing', async () => {
    mockRow.mockReturnValue({ preview_url: null, audio_url: 'https://pub.r2.dev/m.wav', store_listed: true, user_id: 'u1' });
    expect((await call()).status).toBe(404);
    expect(mockStream).not.toHaveBeenCalled();
    mockRow.mockReturnValue({ preview_url: 'https://pub.r2.dev/previews/a.mp3', store_listed: true, user_id: 'u1' });
    mockStream.mockResolvedValue(new Response('nope', { status: 404 }));
    expect((await call()).status).toBe(404);
  });
});
