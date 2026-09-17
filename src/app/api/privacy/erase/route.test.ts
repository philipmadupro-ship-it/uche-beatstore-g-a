/**
 * Route tests for /api/privacy/erase.
 *
 * Contract:
 * - unauthenticated callers get the auth failure, and nothing is written
 * - every write is scoped to the signed-in producer AND the normalised email
 * - the email is replaced by the deterministic pseudonym, the Stripe customer nulled
 * - the raw email never reaches the log
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { redactedEmailFor } from '@/lib/privacy/erase';

type Call = { table: string; patch: unknown; filters: Array<[string, unknown]> };
const calls: Call[] = [];
const rowsByTable: Record<string, Array<{ id: string }>> = {};
const mockRequireUser = vi.fn();
const logInfo = vi.fn();

function fakeAdmin() {
  return {
    from: (table: string) => ({
      update: (patch: unknown) => {
        const call: Call = { table, patch, filters: [] };
        calls.push(call);
        const q = {
          eq: (col: string, val: unknown) => { call.filters.push([col, val]); return q; },
          select: () => Promise.resolve({ data: rowsByTable[table] ?? [], error: null }),
        };
        return q;
      },
    }),
  };
}

vi.mock('@/lib/auth/ownership', () => ({ requireUser: () => mockRequireUser() }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function post(body: unknown) {
  return new NextRequest('http://localhost/api/privacy/erase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rowsByTable)) delete rowsByTable[k];
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ ok: true, userId: 'seller-1', admin: fakeAdmin() });
});

describe('POST /api/privacy/erase', () => {
  it('returns the auth failure and writes nothing when signed out', async () => {
    mockRequireUser.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });
    const { POST } = await import('./route');
    const res = await POST(post({ email: 'buyer@example.test' }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('rejects a body without a valid email', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('anonymises both tables, scoped to the producer and the normalised email', async () => {
    rowsByTable.license_purchases = [{ id: 'lp1' }, { id: 'lp2' }];
    rowsByTable.project_access_links = [{ id: 'pal1' }];
    const { POST } = await import('./route');
    const res = await POST(post({ email: 'Buyer@Example.TEST' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ erased: true, licensePurchases: 2, projectAccessLinks: 1 });

    const pseudonym = redactedEmailFor('buyer@example.test');
    const lp = calls.find((c) => c.table === 'license_purchases')!;
    expect(lp.patch).toEqual({ buyer_email: pseudonym, buyer_stripe_customer: null });
    expect(lp.filters).toEqual([['seller_user_id', 'seller-1'], ['buyer_email', 'buyer@example.test']]);

    const pal = calls.find((c) => c.table === 'project_access_links')!;
    expect(pal.patch).toEqual({ buyer_email: pseudonym });
    expect(pal.filters).toEqual([['seller_user_id', 'seller-1'], ['buyer_email', 'buyer@example.test']]);
  });

  it('never logs the raw email', async () => {
    const { POST } = await import('./route');
    await POST(post({ email: 'buyer@example.test' }));
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('buyer@example.test');
  });
});
