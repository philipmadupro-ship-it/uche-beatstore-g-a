/**
 * Route tests for /api/stripe/webhook.
 *
 * The webhook is the most safety-critical endpoint in the app — Stripe
 * retries failed deliveries and we charge real money. This suite covers
 * the protective layers around fulfillment:
 *
 *   - 400 when the Stripe-Signature header / secret is missing
 *   - 400 when constructEvent throws (bad signature)
 *   - Layer-1 idempotency: a duplicate event_id short-circuits without
 *     touching fulfillment tables
 *   - Non-checkout events (e.g. charge.refunded with no purchase row)
 *     return 200 without crashing
 *
 * We do NOT exercise the full fulfillment path here — those touch CRM,
 * tracks delisting, Resend email, and Stripe API. That's covered by the
 * integration smoke (curl-after-Stripe-CLI) in the runbook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConstructEvent = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) },
  }),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn() } } }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://example.test' }));

import { POST } from './route';

function req(body: string, sig: string | null = 'sig_test_123') {
  const headers = new Headers();
  if (sig) headers.set('stripe-signature', sig);
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers,
  }) as any;
}

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockFrom.mockReset();
  mockRpc.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

describe('POST /api/stripe/webhook', () => {
  it('400s when stripe-signature header is missing', async () => {
    const res = await POST(req('{}', null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing signature' });
  });

  it('400s when STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(req('{}'));
    expect(res.status).toBe(400);
  });

  it('400s when constructEvent throws (bad signature)', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad signature' });
  });

  it('short-circuits on duplicate event_id (idempotency layer 1)', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_dup', metadata: {} } },
    });
    // First .from() call inserts into processed_stripe_events — return a
    // 23505 unique_violation to simulate the duplicate.
    mockFrom.mockReturnValueOnce({
      insert: () => ({
        select: () =>
          Promise.resolve({
            error: { code: '23505', message: 'duplicate key value' },
            count: null,
          }),
      }),
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, skipped: true });
    // No further DB calls should have happened
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('returns 200 for events we do not handle', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_other',
      type: 'customer.subscription.created',
      data: { object: {} },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});
