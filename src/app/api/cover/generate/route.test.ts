/**
 * /api/cover/generate spends the producer's provider credits per call.
 * Buyers sign in through the same Supabase auth, so the gate must be
 * requireProducer, not requireUser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireProducer = vi.fn();
const mockUploadImage = vi.fn();
const mockFetch = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireProducer(),
}));
vi.mock('@/lib/storage/upload', () => ({
  uploadImage: (...args: unknown[]) => mockUploadImage(...args),
}));

function post(): NextRequest {
  return new NextRequest('http://localhost/api/cover/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'dark minimal cover' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
});

describe('/api/cover/generate', () => {
  it('refuses a signed-in buyer before calling any provider', async () => {
    mockRequireProducer.mockResolvedValue({
      ok: false,
      res: Response.json({ error: 'Producer account required' }, { status: 403 }),
    });
    const { POST, GET } = await import('./route');

    expect((await POST(post())).status).toBe(403);
    expect((await GET()).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it('lets the producer see which providers are configured', async () => {
    mockRequireProducer.mockResolvedValue({ ok: true, userId: 'producer-1' });
    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('sk-test');
  });
});
