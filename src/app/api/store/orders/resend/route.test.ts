/**
 * Re-sending a delivery email must not revive a revoked bundle. Refunds and
 * disputes set project_access_links.expires_at = now() (mig 117); the resend
 * route used to email that row's token anyway, a link to "access revoked".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockSend = vi.fn();
let linkRow: Record<string, unknown> | null = null;

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '1.1.1.1' }));
vi.mock('@/lib/buyer-tokens', () => ({
  verifyBuyerToken: (t: string) => (t === 'good' ? { email: 'buyer@example.test', exp: 9_999_999_999 } : null),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: () => {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        maybeSingle: async () => ({
          data: linkRow && filters.every(([c, v]) => linkRow![c] === v) ? linkRow : null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));

function resendReq() {
  return new NextRequest('http://localhost/api/store/orders/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'buyer@example.test', token: 'good', purchase_id: 'access-1', kind: 'project_bundle' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test');
  mockSend.mockResolvedValue({ data: { id: 'r1' }, error: null });
  linkRow = {
    id: 'access-1', buyer_email: 'buyer@example.test', token: 'bundle-secret',
    amount_usd: 80, project_id: 'p1', expires_at: null,
  };
});

describe('POST /api/store/orders/resend — project bundles', () => {
  it('re-sends an active bundle link', async () => {
    const { POST } = await import('./route');
    const res = await POST(resendReq());

    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((mockSend.mock.calls[0][0] as { html: string }).html).toContain('/store/projects/access/bundle-secret');
  });

  it('refuses to re-send a refunded bundle, and sends nothing', async () => {
    linkRow!.expires_at = '2026-01-01T00:00:00Z';
    const { POST } = await import('./route');
    const res = await POST(resendReq());

    expect(res.status).toBe(410);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
