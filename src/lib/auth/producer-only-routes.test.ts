/**
 * Buyers sign in through the same Supabase auth as the producer, so a route
 * that only checks "is someone signed in" is open to every buyer account.
 * These routes spend producer resources (Resend domain, AI credits, R2) or
 * expose producer data, and must refuse a signed-in buyer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireProducer = vi.fn();
const mockGetUser = vi.fn();
const mockSend = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireProducer(),
  createServiceClient: () => ({ from: mockAdminFrom }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockGetUser() } }),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));
vi.mock('@/lib/local-store', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));

const buyerDenied = () => ({ ok: false, res: NextResponse.json({ error: 'Producer account required' }, { status: 403 }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'buyer-1' } } });
  mockRequireProducer.mockResolvedValue(buyerDenied());
});

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('producer-only routes refuse a signed-in buyer', () => {
  it('POST /api/email does not send mail', async () => {
    const { POST } = await import('@/app/api/email/route');
    const res = await POST(post('http://localhost/api/email', { email: 'victim@example.com', shareToken: 'abcdef123', message: 'phish' }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('POST /api/invite does not create or send an invite', async () => {
    const { POST } = await import('@/app/api/invite/route');
    const res = await POST(post('http://localhost/api/invite', { email: 'victim@example.com', role: 'admin' }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it('GET /api/team does not list team members', async () => {
    const { GET } = await import('@/app/api/team/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it('POST /api/cover/generate does not spend AI credits', async () => {
    const { POST } = await import('@/app/api/cover/generate/route');
    const res = await POST(post('http://localhost/api/cover/generate', { prompt: 'x' }));
    expect(res.status).toBe(403);
  });
});
