/**
 * Route tests for /api/audio — the producer's master-audio proxy.
 *
 * The contract being pinned is a security one. This route hands back whatever
 * `src` names, including a private master, and with `redirect=1` a presigned
 * R2 URL that works with no session at all. It used to gate on
 * `supabase.auth.getUser()` alone, and buyers share the same Supabase auth as
 * the producer — so every buyer with an account was past the gate.
 *
 * These tests exist so that can never quietly come back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireProducer = vi.fn();
const mockIsSupabaseConfigured = vi.fn(() => true);
const mockStreamPreview = vi.fn();
const mockStreamDownload = vi.fn();
const mockGetPresignedUrl = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireProducer(),
}));
vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));
vi.mock('@/lib/audio/stream-source', () => ({
  streamAudioPreviewSource: (...a: unknown[]) => mockStreamPreview(...a),
  streamAudioSource: (...a: unknown[]) => mockStreamDownload(...a),
}));
vi.mock('@/lib/storage/upload', () => ({
  getPresignedUrl: (...a: unknown[]) => mockGetPresignedUrl(...a),
}));

const PRIVATE_MASTER = 'r2://private-bucket/masters/night-shift.wav';

const req = (query: string) =>
  new NextRequest(`http://localhost/api/audio?${query}`);

/** A caller who is signed in but is NOT the producer — i.e. a buyer. */
const asBuyer = () =>
  mockRequireProducer.mockResolvedValueOnce({
    ok: false,
    res: NextResponse.json({ error: 'Producer account required' }, { status: 403 }),
  });

const asProducer = () =>
  mockRequireProducer.mockResolvedValueOnce({ ok: true, userId: 'producer-1', admin: {} });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSupabaseConfigured.mockReturnValue(true);
  mockStreamPreview.mockResolvedValue(new Response('audio', { status: 200 }));
  mockStreamDownload.mockResolvedValue(new Response('audio', { status: 200 }));
  mockGetPresignedUrl.mockResolvedValue('https://r2.example/signed?sig=abc');
});

describe('GET /api/audio', () => {
  it('refuses a signed-in buyer', async () => {
    asBuyer();
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}`));
    expect(res.status).toBe(403);
    // Crucially, the object was never touched.
    expect(mockStreamPreview).not.toHaveBeenCalled();
    expect(mockStreamDownload).not.toHaveBeenCalled();
  });

  it('will not mint a presigned URL for a buyer', async () => {
    // The worst case: `redirect=1` returns a URL that then works with no
    // session at all, so leaking one outlives the request.
    asBuyer();
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}&redirect=1`));
    expect(res.status).toBe(403);
    expect(mockGetPresignedUrl).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(null);
  });

  it('will not hand a buyer a download either', async () => {
    asBuyer();
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}&download=1&filename=x.wav`));
    expect(res.status).toBe(403);
    expect(mockStreamDownload).not.toHaveBeenCalled();
  });

  it('checks the caller before reading the query at all', async () => {
    // A missing `src` must not be reported ahead of the 403: answering "400
    // Missing src" to a buyer would confirm the gate is only shape-checking.
    asBuyer();
    const { GET } = await import('./route');
    const res = await GET(req(''));
    expect(res.status).toBe(403);
  });

  it('serves the producer', async () => {
    asProducer();
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}`));
    expect(res.status).toBe(200);
    expect(mockStreamPreview).toHaveBeenCalled();
  });

  it('still redirects the producer to a presigned URL', async () => {
    asProducer();
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}&redirect=1`));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://r2.example/signed');
  });

  it('still forces a download for the producer', async () => {
    asProducer();
    const { GET } = await import('./route');
    await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}&download=1&filename=Night%20Shift.wav`));
    expect(mockStreamDownload).toHaveBeenCalledWith(
      expect.anything(),
      PRIVATE_MASTER,
      'Night Shift.wav',
    );
  });

  it('never caches a response', async () => {
    asProducer();
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}`));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('skips the gate only when there is no database to authenticate against', async () => {
    // Local no-database dev: nothing private exists to protect.
    mockIsSupabaseConfigured.mockReturnValue(false);
    const { GET } = await import('./route');
    const res = await GET(req(`src=${encodeURIComponent(PRIVATE_MASTER)}`));
    expect(res.status).toBe(200);
    expect(mockRequireProducer).not.toHaveBeenCalled();
  });
});
