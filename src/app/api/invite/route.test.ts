/**
 * /api/invite sends mail from the producer's verified domain. Buyers share the
 * producer's Supabase auth, so the gate must be requireProducer: a signed-in
 * buyer must be refused before Resend is ever called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireProducer = vi.fn();
const mockSend = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: () => mockRequireProducer(),
}));
// A signed-in session exists; it just is not the producer's.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'buyer-1' } } }) } }),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/local-store', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test');
});

describe('POST /api/invite', () => {
  it('refuses a signed-in buyer before sending anything', async () => {
    mockRequireProducer.mockResolvedValue({
      ok: false,
      res: Response.json({ error: 'Producer account required' }, { status: 403 }),
    });
    const { POST } = await import('./route');
    const res = await POST(new NextRequest('http://localhost/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'victim@example.com', role: 'admin' }),
    }));

    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
