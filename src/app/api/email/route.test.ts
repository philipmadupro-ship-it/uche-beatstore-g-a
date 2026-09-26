/**
 * /api/email sends mail from the producer's verified domain. Buyers share the
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
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/local-store', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test');
});

describe('POST /api/email', () => {
  it('refuses a signed-in buyer before sending anything', async () => {
    mockRequireProducer.mockResolvedValue({
      ok: false,
      res: Response.json({ error: 'Producer account required' }, { status: 403 }),
    });
    const { POST } = await import('./route');
    const res = await POST(new NextRequest('http://localhost/api/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'victim@example.com', shareToken: 'abcdef123', subject: 'x' }),
    }));

    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
