/**
 * Route tests for /api/store/promo.
 *
 * Validates the public promo-lookup endpoint:
 *   - 400 on invalid body
 *   - { valid: false } for unknown / inactive / expired / capped / wrong-seller codes
 *   - { valid: true, discount_*, code } for a good code
 *   - normalizes the code to uppercase before lookup
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const ilikeArgs: { col?: string; value?: string } = {};

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        ilike: (col: string, value: string) => {
          ilikeArgs.col = col;
          ilikeArgs.value = value;
          return { maybeSingle: () => mockMaybeSingle() };
        },
      }),
    }),
  }),
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/store/promo', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;
}

beforeEach(() => {
  mockMaybeSingle.mockReset();
  ilikeArgs.col = undefined;
  ilikeArgs.value = undefined;
});

describe('POST /api/store/promo', () => {
  it('400s on missing code', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ valid: false, error: 'Invalid request' });
  });

  it('returns invalid when code not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const res = await POST(req({ code: 'nope' }));
    expect(await res.json()).toEqual({ valid: false, error: 'Invalid code' });
  });

  it('normalizes code to uppercase before lookup', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    await POST(req({ code: 'summer10' }));
    expect(ilikeArgs.value).toBe('SUMMER10');
  });

  it('rejects inactive codes', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { code: 'X', active: false, uses_count: 0, discount_percent: 10 },
    });
    const res = await POST(req({ code: 'X' }));
    expect(await res.json()).toEqual({ valid: false, error: 'Code is no longer active' });
  });

  it('rejects expired codes', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        code: 'X',
        active: true,
        uses_count: 0,
        expires_at: '2000-01-01T00:00:00Z',
        discount_percent: 10,
      },
    });
    const res = await POST(req({ code: 'X' }));
    expect(await res.json()).toEqual({ valid: false, error: 'Code has expired' });
  });

  it('rejects codes that hit max_uses', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { code: 'X', active: true, uses_count: 5, max_uses: 5, discount_percent: 10 },
    });
    const res = await POST(req({ code: 'X' }));
    expect(await res.json()).toEqual({ valid: false, error: 'Code usage limit reached' });
  });

  it('rejects codes scoped to a different seller', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { code: 'X', active: true, uses_count: 0, user_id: 'seller-a', discount_percent: 10 },
    });
    const res = await POST(
      req({ code: 'X', seller_user_id: '11111111-2222-4333-8444-555555555555' }),
    );
    expect(await res.json()).toEqual({ valid: false, error: 'Code not valid for this seller' });
  });

  it('returns discount terms for a valid code', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        code: 'SUMMER10',
        active: true,
        uses_count: 0,
        discount_percent: 10,
        discount_amount: 0,
      },
    });
    const res = await POST(req({ code: 'summer10' }));
    expect(await res.json()).toEqual({
      valid: true,
      code: 'SUMMER10',
      discount_percent: 10,
      discount_amount: 0,
    });
  });
});
