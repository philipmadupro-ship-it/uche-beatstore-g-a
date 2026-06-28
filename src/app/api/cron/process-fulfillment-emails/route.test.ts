import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const processBatch = vi.fn();

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/fulfillment/email-outbox', () => ({
  processFulfillmentEmailBatch: (...args: unknown[]) => processBatch(...args),
}));

function request(secret?: string) {
  return new NextRequest('http://localhost/api/cron/process-fulfillment-emails?limit=7', {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe('GET /api/cron/process-fulfillment-emails', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    processBatch.mockReset();
    processBatch.mockResolvedValue({ claimed: 2, sent: 2, failed: 0, dead: 0 });
  });

  it('rejects requests without the cron secret', async () => {
    const { GET } = await import('./route');
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('processes a bounded batch for an authorized cron request', async () => {
    const { GET } = await import('./route');
    const response = await GET(request('cron-secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: 2, sent: 2, failed: 0, dead: 0 });
    expect(processBatch).toHaveBeenCalledWith(7);
  });
});
