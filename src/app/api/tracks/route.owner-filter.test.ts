/**
 * `/api/tracks` reads with the service role, which bypasses RLS, so the route
 * must apply the owner rule itself. Migration 097 retired the legacy
 * `user_id IS NULL` allowance ("owner-only, not owner-or-null"); the bounded
 * branch re-opened it with `.or('user_id.eq.X,user_id.is.null')`, listing
 * orphan rows to any producer. These tests drive the Supabase branch through
 * a query-builder fake that records every filter applied.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const OWNER = '11111111-1111-4111-8111-111111111111';

type Call = { method: string; args: unknown[] };
let calls: Call[] = [];
const mockScopedList = vi.fn();

function builder(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'or', 'eq', 'in', 'gte', 'lte', 'order', 'range']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return chain;
}

const admin = {
  from: (table: string) => {
    calls.push({ method: 'from', args: [table] });
    return builder([]);
  },
};

vi.mock('@/lib/db', () => ({
  scopedList: (...args: unknown[]) => mockScopedList(...args),
  isErrorResponse: () => false,
  isSupabaseConfigured: () => true,
  createServiceClient: () => admin,
  requireUser: async () => ({ ok: true, userId: OWNER, admin }),
  query: vi.fn(),
}));

function req(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  calls = [];
  mockScopedList.mockReset();
  mockScopedList.mockResolvedValue([]);
});

describe('GET /api/tracks owner filter', () => {
  it('bounded list filters to the caller only — no legacy null-owner rows', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('/api/tracks?paged=1&lean=1&limit=100'));
    expect(res.status).toBe(200);

    expect(calls).toContainEqual({ method: 'eq', args: ['user_id', OWNER] });
    const orFilters = calls.filter((c) => c.method === 'or').map((c) => String(c.args[0]));
    expect(orFilters.some((f) => f.includes('user_id.is.null'))).toBe(false);
  });

  it('keeps the owner filter alongside search and store_listed filters', async () => {
    const { GET } = await import('./route');
    await GET(req('/api/tracks?paged=1&q=trap&store_listed=1'));

    expect(calls).toContainEqual({ method: 'eq', args: ['user_id', OWNER] });
    expect(calls.filter((c) => String(c.args[0] ?? '').includes('user_id.is.null'))).toEqual([]);
  });

  it('legacy unbounded list asks scopedList for owner-only rows', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('/api/tracks'));
    expect(res.status).toBe(200);

    expect(mockScopedList).toHaveBeenCalledWith('tracks', expect.objectContaining({ includeNullOwner: false }));
  });
});
