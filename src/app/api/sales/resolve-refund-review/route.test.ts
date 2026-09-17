/**
 * Route tests for /api/sales/resolve-refund-review.
 *
 * Contract: only the purchase's own seller can clear needs_refund_review, the
 * route never touches another seller's row, and it never calls Stripe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const PURCHASE_ID = '11111111-1111-4111-8111-111111111111';
let purchaseRow: Record<string, unknown> | null = null;
const updates: Array<{ patch: unknown; id: unknown }> = [];
const mockRequireUser = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({ requireUser: () => mockRequireUser() }));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/stripe/server', () => {
  throw new Error('resolve-refund-review must not import Stripe');
});

const admin = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: purchaseRow, error: null }) }) }),
    update: (patch: unknown) => ({
      eq: (_col: string, id: unknown) => { updates.push({ patch, id }); return Promise.resolve({ error: null }); },
    }),
  }),
};

function post(body: unknown) {
  return new NextRequest('http://localhost/api/sales/resolve-refund-review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  purchaseRow = { id: PURCHASE_ID, seller_user_id: 'seller-1' };
  mockRequireUser.mockResolvedValue({ ok: true, userId: 'seller-1', admin });
});

describe('POST /api/sales/resolve-refund-review', () => {
  it('returns the auth failure when signed out', async () => {
    mockRequireUser.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) });
    const { POST } = await import('./route');
    expect((await POST(post({ purchase_id: PURCHASE_ID }))).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('400s on a non-uuid purchase id', async () => {
    const { POST } = await import('./route');
    expect((await POST(post({ purchase_id: 'abc' }))).status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("404s on another seller's purchase and leaves it untouched", async () => {
    purchaseRow = { id: PURCHASE_ID, seller_user_id: 'seller-2' };
    const { POST } = await import('./route');
    expect((await POST(post({ purchase_id: PURCHASE_ID }))).status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it('404s when the purchase does not exist', async () => {
    purchaseRow = null;
    const { POST } = await import('./route');
    expect((await POST(post({ purchase_id: PURCHASE_ID }))).status).toBe(404);
  });

  it('clears the flag on the seller\'s own purchase', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ purchase_id: PURCHASE_ID }));
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ patch: { needs_refund_review: false }, id: PURCHASE_ID }]);
  });
});
