/**
 * Route tests for /api/privacy/erase.
 *
 * Contract:
 * - signed-out callers and signed-in buyers get the auth failure, and nothing is written
 * - every step of buildErasurePlan runs, filtered on the normalised email, and
 *   on the producer's id wherever the table has a producer column
 * - anonymise steps write the pseudonym; delete steps delete
 * - a failing step stops the run, reports what was done, and is safe to re-run
 * - the raw email never reaches the log
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { buildErasurePlan, redactedEmailFor } from '@/lib/privacy/erase';

type Call = {
  table: string;
  action: 'update' | 'delete';
  patch?: unknown;
  filters: Array<[string, string, unknown]>;
};
const calls: Call[] = [];
const rowsByTable: Record<string, number> = {};
let failTable: string | null = null;
const mockRequireProducer = vi.fn();
const logInfo = vi.fn();
const logError = vi.fn();

function fakeAdmin() {
  const chain = (call: Call) => {
    const q = {
      eq: (col: string, val: unknown) => { call.filters.push(['eq', col, val]); return q; },
      neq: (col: string, val: unknown) => { call.filters.push(['neq', col, val]); return q; },
      select: () => Promise.resolve(
        failTable === call.table
          ? { data: null, error: { message: 'boom' } }
          : { data: Array.from({ length: rowsByTable[call.table] ?? 0 }, (_, i) => ({ id: i })), error: null },
      ),
    };
    return q;
  };
  return {
    from: (table: string) => ({
      update: (patch: unknown) => { const c: Call = { table, action: 'update', patch, filters: [] }; calls.push(c); return chain(c); },
      delete: () => { const c: Call = { table, action: 'delete', filters: [] }; calls.push(c); return chain(c); },
    }),
  };
}

vi.mock('@/lib/auth/ownership', () => ({ requireProducer: () => mockRequireProducer() }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: logInfo, warn: vi.fn(), error: logError, debug: vi.fn() }),
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
  failTable = null;
  vi.clearAllMocks();
  mockRequireProducer.mockResolvedValue({ ok: true, userId: 'seller-1', admin: fakeAdmin() });
});

describe('POST /api/privacy/erase', () => {
  it.each([
    ['signed out', 401],
    ['a signed-in buyer', 403],
  ])('refuses %s and writes nothing', async (_who, status) => {
    mockRequireProducer.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'no' }, { status }) });
    const { POST } = await import('./route');
    const res = await POST(post({ email: 'buyer@example.test' }));
    expect(res.status).toBe(status);
    expect(calls).toHaveLength(0);
  });

  it('rejects a body without a valid email', async () => {
    const { POST } = await import('./route');
    expect((await POST(post({ email: 'not-an-email' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('runs every plan step, scoped to the producer and the normalised email', async () => {
    rowsByTable.license_purchases = 2;
    rowsByTable.buyer_favorites = 3;
    rowsByTable.contacts = 1;
    const { POST } = await import('./route');
    const res = await POST(post({ email: 'Buyer@Example.TEST' }));
    expect(res.status).toBe(200);

    const plan = buildErasurePlan('buyer@example.test');
    expect(calls.map((c) => `${c.action}:${c.table}`)).toEqual(
      plan.map((s) => `${s.action === 'delete' ? 'delete' : 'update'}:${s.table}`),
    );
    plan.forEach((step, i) => {
      const filters = calls[i].filters;
      expect(filters).toContainEqual(['eq', step.emailColumn, 'buyer@example.test']);
      if (step.scope) expect(filters).toContainEqual(['eq', step.scope, 'seller-1']);
      else expect(filters.some(([, col]) => col === 'seller_user_id' || col === 'user_id')).toBe(false);
    });

    const body = await res.json();
    expect(body).toMatchObject({ erased: true, total: 6, licensePurchases: 2, favorites: 3, contacts: 1 });
  });

  it('writes the pseudonym, never the address', async () => {
    const { POST } = await import('./route');
    await POST(post({ email: 'buyer@example.test' }));
    const lp = calls.find((c) => c.table === 'license_purchases')!;
    expect(lp.patch).toEqual({ buyer_email: redactedEmailFor('buyer@example.test'), buyer_stripe_customer: null });
    expect(JSON.stringify(calls.map((c) => c.patch ?? null))).not.toContain('buyer@example.test');
  });

  it('stops at a failing step and reports what was already done', async () => {
    rowsByTable.license_purchases = 1;
    failTable = 'contacts';
    const { POST } = await import('./route');
    const res = await POST(post({ email: 'buyer@example.test' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/contacts.*Re-run/);
    expect(body.partial).toMatchObject({ licensePurchases: 1 });
    expect(calls.some((c) => c.table === 'buyer_favorites')).toBe(false);
  });

  it('never logs the raw email', async () => {
    failTable = 'buyer_offers';
    const { POST } = await import('./route');
    await POST(post({ email: 'buyer@example.test' }));
    failTable = null;
    await POST(post({ email: 'buyer@example.test' }));
    const logged = JSON.stringify([...logInfo.mock.calls, ...logError.mock.calls]);
    expect(logged).not.toContain('buyer@example.test');
  });
});
