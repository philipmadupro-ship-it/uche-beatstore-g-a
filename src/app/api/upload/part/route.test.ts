import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetSession = vi.fn();
const mockRecordPart = vi.fn();
const mockGetUploadPartUrl = vi.fn();
const mockUploadPart = vi.fn();
const mockRequireOwner = vi.fn();

vi.mock('@/lib/storage/upload-sessions', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  recordPart: (...args: unknown[]) => mockRecordPart(...args),
}));

vi.mock('@/lib/storage/multipart', () => ({
  getUploadPartUrl: (...args: unknown[]) => mockGetUploadPartUrl(...args),
  uploadPart: (...args: unknown[]) => mockUploadPart(...args),
}));

vi.mock('@/lib/storage/upload-session-auth', () => ({
  requireUploadSessionOwner: (...args: unknown[]) => mockRequireOwner(...args),
}));

function session() {
  return {
    sessionId: 'session-1',
    uploadId: 'upload-1',
    key: 'tracks/beat.wav',
    fileName: 'beat.wav',
    fileSize: 13,
    contentType: 'audio/wav',
    partSize: 5,
    totalParts: 3,
    parts: [],
    type: 'beat',
    projectId: null,
    replaceTrackId: null,
    userId: 'user-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'in_progress',
  };
}

function jsonRequest(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/upload/part', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(session());
  mockRequireOwner.mockResolvedValue({ ok: true, userId: 'user-1' });
  mockGetUploadPartUrl.mockResolvedValue('https://r2.example/signed');
  mockRecordPart.mockImplementation(async (_id, part) => ({
    ...session(),
    parts: [part],
  }));
});

describe('POST /api/upload/part', () => {
  it('issues a short-lived direct upload URL for an owned session', async () => {
    const mod = await import('./route');
    const res = await mod.POST(jsonRequest('POST', { sessionId: 'session-1', partNumber: 2 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      direct: true,
      url: 'https://r2.example/signed',
      expectedSize: 5,
    });
    expect(mockGetUploadPartUrl).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      key: 'tracks/beat.wav',
      partNumber: 2,
    });
  });

  it('rejects a part number outside the session', async () => {
    const mod = await import('./route');
    const res = await mod.POST(jsonRequest('POST', { sessionId: 'session-1', partNumber: 4 }));
    expect(res.status).toBe(400);
    expect(mockGetUploadPartUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/upload/part (batch)', () => {
  it('signs every requested part in one request, after one ownership check', async () => {
    mockGetUploadPartUrl.mockImplementation(async ({ partNumber }: { partNumber: number }) => `https://r2.example/p${partNumber}`);
    const mod = await import('./route');
    const res = await mod.POST(jsonRequest('POST', { sessionId: 'session-1', partNumbers: [1, 2, 3, 2] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      direct: true,
      urls: { 1: 'https://r2.example/p1', 2: 'https://r2.example/p2', 3: 'https://r2.example/p3' },
      expiresIn: 900,
    });
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockRequireOwner).toHaveBeenCalledTimes(1);
  });

  it('reports direct: false when R2 signing is unavailable, so the client proxies', async () => {
    mockGetUploadPartUrl.mockResolvedValue(null);
    const mod = await import('./route');
    const res = await mod.POST(jsonRequest('POST', { sessionId: 'session-1', partNumbers: [1, 2] }));
    expect(await res.json()).toMatchObject({ direct: false, urls: {} });
  });

  it('rejects a part outside the session, a bad entry, and an empty list', async () => {
    const mod = await import('./route');
    for (const partNumbers of [[1, 4], [1, 'x'], [0], []]) {
      const res = await mod.POST(jsonRequest('POST', { sessionId: 'session-1', partNumbers }));
      expect(res.status).toBe(400);
    }
    expect(mockGetUploadPartUrl).not.toHaveBeenCalled();
  });

  it('does not sign for someone else\'s session', async () => {
    mockRequireOwner.mockResolvedValue({ ok: false, res: new Response(null, { status: 404 }) });
    const mod = await import('./route');
    const res = await mod.POST(jsonRequest('POST', { sessionId: 'session-1', partNumbers: [1] }));
    expect(res.status).toBe(404);
    expect(mockGetUploadPartUrl).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/upload/part', () => {
  it('records the R2 ETag and exact final-part size', async () => {
    const mod = await import('./route');
    const res = await mod.PATCH(jsonRequest('PATCH', {
      sessionId: 'session-1',
      partNumber: 3,
      etag: '"etag-3"',
      size: 3,
    }));

    expect(res.status).toBe(200);
    expect(mockRecordPart).toHaveBeenCalledWith('session-1', {
      PartNumber: 3,
      ETag: '"etag-3"',
      Size: 3,
    });
  });

  it('rejects a truncated final part before recording it', async () => {
    const mod = await import('./route');
    const res = await mod.PATCH(jsonRequest('PATCH', {
      sessionId: 'session-1',
      partNumber: 3,
      etag: '"etag-3"',
      size: 2,
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid part size' });
    expect(mockRecordPart).not.toHaveBeenCalled();
  });
});
