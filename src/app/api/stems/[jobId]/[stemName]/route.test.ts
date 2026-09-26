import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockAuthorize = vi.fn();
vi.mock('@/lib/stems/authorize', async (orig) => ({
  ...(await orig<typeof import('@/lib/stems/authorize')>()),
  authorizeStemJob: (id: string) => mockAuthorize(id),
}));

import { GET } from './route';

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
});

const call = (jobId: string, stemName: string) =>
  GET(new NextRequest(`http://localhost/api/stems/x/y`), { params: Promise.resolve({ jobId, stemName }) });

describe('GET /api/stems/[jobId]/[stemName]', () => {
  it('refuses an unauthenticated caller without touching the stem service', async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await call('job-1', 'vocals');
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('refuses a non-owner', async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await call('job-1', 'vocals')).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects path injection before auth or upstream fetch', async () => {
    expect((await call('..', 'vocals')).status).toBe(400);
    expect((await call('job-1', '..%2F..%2Fjobs')).status).toBe(400);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('streams to the owner with a private, uncached response', async () => {
    mockAuthorize.mockResolvedValue(null);
    const res = await call('job-1', 'vocals');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
