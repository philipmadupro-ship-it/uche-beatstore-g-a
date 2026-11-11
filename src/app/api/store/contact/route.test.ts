import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSend = vi.fn();
const mockFrom = vi.fn();
const mockGetUserById = vi.fn();
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('resend', () => ({ Resend: class { emails = { send: (...a: unknown[]) => mockSend(...a) }; } }));
vi.mock('@/lib/log', () => ({ createLogger: () => mockLog }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (t: string) => mockFrom(t),
    auth: { admin: { getUserById: (id: string) => mockGetUserById(id) } },
  }),
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/store/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
const valid = { name: 'Ada', email: 'Ada@Example.com', subject: 'Beat', message: 'Hello there' };

function tables(profile: { contact_email?: string | null; user_id?: string | null } | null) {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'creator_profiles') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.not = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: profile, error: null });
      return chain;
    }
    if (t === 'contacts') return { upsert: () => Promise.resolve({ error: null }) };
    throw new Error(`unexpected ${t}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 're_live';
  process.env.RESEND_FROM_EMAIL = 'Store <sales@shop.example>';
  mockSend.mockResolvedValue({ data: { id: 'm1' }, error: null });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'owner@shop.example' } } });
  tables({ contact_email: 'producer@shop.example', user_id: 'u1' });
});

describe('POST /api/store/contact', () => {
  it('sends to the producer contact_email, reply-to the visitor', async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe('producer@shop.example');
    expect(arg.replyTo).toBe('Ada@Example.com');
    expect(arg.from).toBe('Store <sales@shop.example>');
  });

  it('falls back to the owner login email, not the no-reply sender, when no contact_email is set', async () => {
    tables({ contact_email: null, user_id: 'u1' });
    // contact_email filter returns no row; owner is found by a second lookup
    mockFrom.mockImplementation((t: string) => {
      if (t === 'creator_profiles') {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain; chain.not = () => chain; chain.limit = () => chain; chain.eq = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: { user_id: 'u1' }, error: null });
        return chain;
      }
      return { upsert: () => Promise.resolve({ error: null }) };
    });
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    expect(mockSend.mock.calls[0][0].to).toBe('owner@shop.example');
  });

  it('with no RESEND_API_KEY it does not crash on import and answers 503 with a logged reason', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await POST(req(valid));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/unavailable|try again/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/RESEND_API_KEY/), expect.anything());
  });

  it('a Resend rejection (unverified domain) logs the cause with a hint and tells the visitor it was NOT sent', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'The shop.example domain is not verified' } });
    const res = await POST(req(valid));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/could not send/i);
    const call = mockLog.error.mock.calls.find((c) => /send failed/i.test(String(c[0])));
    expect(call?.[1].hint).toMatch(/verif/i);
    expect(JSON.stringify(call?.[1])).not.toContain('ada@example.com');
  });

  it('caps name and subject length', async () => {
    expect((await POST(req({ ...valid, name: 'a'.repeat(121) }))).status).toBe(400);
    expect((await POST(req({ ...valid, subject: 's'.repeat(201) }))).status).toBe(400);
    expect((await POST(req({ ...valid, name: 'a'.repeat(120), subject: 's'.repeat(200) }))).status).toBe(200);
  });

  it('still validates input', async () => {
    expect((await POST(req({ name: 'a', email: 'nope', message: 'x' }))).status).toBe(400);
    expect((await POST(req({ email: 'a@b.co' }))).status).toBe(400);
  });
});
