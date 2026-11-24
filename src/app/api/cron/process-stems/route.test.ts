import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const batch = vi.fn();
vi.mock('@/lib/stems/pipeline', () => ({ processStemBatch: (...a: unknown[]) => batch(...a) }));
vi.mock('@/lib/stems/runtime', () => ({ defaultPipelineDeps: () => ({}) }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));

const req = (auth?: string) => new NextRequest('http://localhost/api/cron/process-stems', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's3cret'; });

describe('GET /api/cron/process-stems', () => {
  it('requires the bearer secret before any work', async () => {
    const { GET } = await import('./route');
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect(batch).not.toHaveBeenCalled();
    delete process.env.CRON_SECRET;
    expect((await GET(req('Bearer s3cret'))).status).toBe(500);
  });
  it('runs one batch and reports it', async () => {
    batch.mockResolvedValue({ claimed: 1, done: 1, failed: 0, waiting: 0, retry: 0, expired: 0 });
    const { GET } = await import('./route');
    const res = await GET(req('Bearer s3cret'));
    expect(res.status).toBe(200);
    expect((await res.json()).done).toBe(1);
  });
});
