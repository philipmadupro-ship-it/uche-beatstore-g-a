import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { imageUploadLimits } from '@/lib/upload/image-validation';

const mockUploadImage = vi.fn();
const mockRequireUser = vi.fn();

const mockDeleteUploadedImage = vi.fn();
vi.mock('@/lib/storage/upload', () => ({
  uploadImage: (...args: unknown[]) => mockUploadImage(...args),
  deleteUploadedImage: (...args: unknown[]) => mockDeleteUploadedImage(...args),
  uploadedImageKey: (url: string) => (url.startsWith('/uploads/covers/') ? url.slice('/uploads/'.length) : null),
}));

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireUser(),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function requestWithFile(file?: File): NextRequest {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }
  return new NextRequest('http://localhost/api/upload/image', {
    method: 'POST',
    body: formData,
  });
}

async function loadRoute() {
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ ok: true, user: { id: 'user-1' } });
  mockUploadImage.mockResolvedValue('/uploads/covers/test.webp');
});

describe('POST /api/upload/image', () => {
  it('requires a producer session before reading upload data', async () => {
    const res = Response.json({ error: 'Not authenticated' }, { status: 401 });
    mockRequireUser.mockResolvedValueOnce({ ok: false, res });

    const mod = await loadRoute();
    const response = await mod.POST(requestWithFile(new File([PNG], 'cover.png', { type: 'image/png' })));

    expect(response.status).toBe(401);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it('rejects unsupported cover image formats before storage upload', async () => {
    const mod = await loadRoute();
    const response = await mod.POST(requestWithFile(new File(['gif'], 'cover.gif', { type: 'image/gif' })));

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Use JPG, PNG, or WebP artwork.' });
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it('rejects oversized cover images before storage upload', async () => {
    const mod = await loadRoute();
    const response = await mod.POST(requestWithFile(new File(
      [new Uint8Array(imageUploadLimits.maxSizeBytes + 1)],
      'cover.png',
      { type: 'image/png' },
    )));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Keep artwork under 4 MB.' });
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it('uploads valid covers with the normalized extension and mime type', async () => {
    const mod = await loadRoute();
    const response = await mod.POST(requestWithFile(new File([WEBP], 'cover.webp', { type: 'image/webp' })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, url: '/uploads/covers/test.webp' });
    expect(mockUploadImage).toHaveBeenCalledWith(expect.any(Buffer), 'webp', 'image/webp');
  });

  it('refuses a signed-in buyer (not the producer) before storage upload', async () => {
    mockRequireUser.mockResolvedValueOnce({
      ok: false,
      res: Response.json({ error: 'Producer account required' }, { status: 403 }),
    });
    const mod = await loadRoute();
    const response = await mod.POST(requestWithFile(new File([PNG], 'cover.png', { type: 'image/png' })));

    expect(response.status).toBe(403);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it('rejects a file whose bytes do not match its declared image type', async () => {
    const mod = await loadRoute();
    const html = new File(['<html><script>alert(1)</script></html>'], 'cover.png', { type: 'image/png' });
    const response = await mod.POST(requestWithFile(html));

    expect(response.status).toBe(415);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});

/** Admin stub: every reference lookup resolves with the given count/error. */
function adminWith(result: { count: number | null; error: unknown }, seen: string[] = []) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string) => { seen.push(`${table}.${column}`); return Promise.resolve(result); },
      }),
    }),
  };
}

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/image', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('DELETE /api/upload/image', () => {
  const url = '/uploads/covers/abcDEF_123.webp';

  it('requires a producer', async () => {
    mockRequireUser.mockResolvedValueOnce({ ok: false, res: Response.json({ error: 'x' }, { status: 403 }) });
    const mod = await loadRoute();
    const res = await mod.DELETE(deleteRequest({ url }));
    expect(res.status).toBe(403);
    expect(mockDeleteUploadedImage).not.toHaveBeenCalled();
  });

  it('refuses URLs that uploadImage did not mint', async () => {
    mockRequireUser.mockResolvedValueOnce({ ok: true, userId: 'u1', admin: adminWith({ count: 0, error: null }) });
    const mod = await loadRoute();
    const res = await mod.DELETE(deleteRequest({ url: 'https://evil.example/covers/abcDEF_123.webp' }));
    expect(res.status).toBe(400);
    expect(mockDeleteUploadedImage).not.toHaveBeenCalled();
  });

  it('refuses while any row still references the image', async () => {
    const seen: string[] = [];
    mockRequireUser.mockResolvedValueOnce({ ok: true, userId: 'u1', admin: adminWith({ count: 1, error: null }, seen) });
    const mod = await loadRoute();
    const res = await mod.DELETE(deleteRequest({ url }));
    expect(res.status).toBe(409);
    expect(seen).toContain('tracks.cover_url');
    expect(mockDeleteUploadedImage).not.toHaveBeenCalled();
  });

  it('fails safe when a reference lookup errors', async () => {
    mockRequireUser.mockResolvedValueOnce({ ok: true, userId: 'u1', admin: adminWith({ count: null, error: { message: 'column does not exist' } }) });
    const mod = await loadRoute();
    const res = await mod.DELETE(deleteRequest({ url }));
    expect(res.status).toBe(409);
    expect(mockDeleteUploadedImage).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced upload', async () => {
    mockRequireUser.mockResolvedValueOnce({ ok: true, userId: 'u1', admin: adminWith({ count: 0, error: null }) });
    const mod = await loadRoute();
    const res = await mod.DELETE(deleteRequest({ url }));
    expect(res.status).toBe(200);
    expect(mockDeleteUploadedImage).toHaveBeenCalledWith(url);
  });
});
