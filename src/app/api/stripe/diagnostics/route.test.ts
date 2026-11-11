import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockRequireProducer = vi.fn();
const mockBalance = vi.fn();
const mockEndpoints = vi.fn();

vi.mock('@/lib/stripe/server', () => ({
  isStripeConfigured: () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET,
  getStripe: () => ({
    balance: { retrieve: () => mockBalance() },
    webhookEndpoints: { list: () => mockEndpoints() },
  }),
}));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => false }));
vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireProducer(),
  createServiceClient: () => { throw new Error('not used'); },
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_abc';
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_abc';
  process.env.RESEND_API_KEY = 're_abc';
  process.env.RESEND_FROM_EMAIL = 'Store <sales@u2c.example>';
  process.env.NEXT_PUBLIC_APP_URL = 'https://shop.example';
  mockRequireProducer.mockResolvedValue({ ok: true, userId: 'u1', admin: {} });
  mockBalance.mockResolvedValue({});
  mockEndpoints.mockResolvedValue({
    data: [{
      url: 'https://shop.example/api/stripe/webhook', status: 'enabled', livemode: true,
      enabled_events: ['checkout.session.completed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'],
    }],
  });
});

describe('GET /api/stripe/diagnostics', () => {
  it('is owner-only: a stranger gets the auth failure and Stripe is never called', async () => {
    mockRequireProducer.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockBalance).not.toHaveBeenCalled();
    expect(mockEndpoints).not.toHaveBeenCalled();
  });

  it('reports live key mode, webhook secret, and the Resend sender domain — no secret values', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.stripe.key_mode).toBe('live');
    expect(body.stripe.publishable_key_mode).toBe('live');
    expect(body.env.webhook_secret).toEqual({ set: true, looks_valid: true, has_whitespace: false });
    expect(body.resend).toMatchObject({ api_key_set: true, from_domain: 'u2c.example', sandbox_sender: false, problems: [] });
    expect(body.webhook).toMatchObject({ endpoint_registered: true, livemode: true, missing_events: [] });
    const text = JSON.stringify(body);
    expect(text).not.toContain('sk_live_abc');
    expect(text).not.toContain('whsec_abc');
    expect(text).not.toContain('re_abc');
  });

  it('explains a live key paired with a test publishable key and a test-mode endpoint', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_abc';
    mockEndpoints.mockResolvedValue({
      data: [{ url: 'https://shop.example/api/stripe/webhook', status: 'enabled', livemode: false, enabled_events: ['*'] }],
    });
    const body = await (await GET()).json();
    const hints = body.hints.join(' ');
    expect(hints).toMatch(/PUBLISHABLE_KEY is test/);
    expect(hints).toMatch(/TEST-mode endpoint/);
  });

  it('trims a publishable key pasted with a newline before comparing modes', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_abc\n';
    const body = await (await GET()).json();
    expect(body.stripe.publishable_key_mode).toBe('live');
    expect(body.hints.join(' ')).not.toMatch(/PUBLISHABLE_KEY is/);
  });

  it('flags the Resend sandbox sender', async () => {
    delete process.env.RESEND_FROM_EMAIL;
    const body = await (await GET()).json();
    expect(body.resend.sandbox_sender).toBe(true);
    expect(body.hints.join(' ')).toMatch(/sandbox/i);
  });

  it('tells the owner there is no live endpoint when the live key lists none', async () => {
    mockEndpoints.mockResolvedValue({ data: [] });
    const body = await (await GET()).json();
    expect(body.webhook.endpoint_registered).toBe(false);
    expect(body.hints.join(' ')).toMatch(/No Stripe webhook endpoint/);
  });
});
