/**
 * Route tests for /api/sales.
 *
 * Auth-gated producer sales feed. Key contract:
 *   - 401 when there's no session.
 *   - Merges license_purchases (track) with project_access_links
 *     (project bundle) into one chronological list.
 *   - Prefers frozen project_access_links.amount_usd over the current
 *     projects.price_usd (regression: migration 044).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockRequireUser = vi.fn();
const mockFromQueue: Array<(table: string) => any> = [];

vi.mock('@/lib/auth/ownership', () => ({
  requireUser: () => mockRequireUser(),
}));

function adminMock() {
  return {
    from: (table: string) => {
      const handler = mockFromQueue.shift();
      if (!handler) throw new Error(`No mock for from('${table}') — queue empty`);
      return handler(table);
    },
  };
}

/** purchases / access_links: .select().eq().order */
function eqOrderResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => ({ order: () => Promise.resolve({ data, error }) }),
    }),
  });
}

/** projects (owned list): .select().eq() */
function eqResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      eq: () => Promise.resolve({ data, error }),
      in: () => Promise.resolve({ data, error }),
    }),
  });
}

/** access_links scoped to projectIds: .select().in().order */
function inOrderResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({
      in: () => ({ order: () => Promise.resolve({ data, error }) }),
    }),
  });
}

/** tracks .select().in */
function inResult(data: unknown, error: unknown = null) {
  return () => ({
    select: () => ({ in: () => Promise.resolve({ data, error }) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromQueue.length = 0;
});

async function loadRoute() {
  return import('./route');
}

describe('GET /api/sales', () => {
  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });
    const mod = await loadRoute();
    const res = await mod.GET();
    expect(res.status).toBe(401);
  });

  it('returns an empty feed for a brand-new producer', async () => {
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'seller-1', admin: adminMock() });
    // license_purchases
    mockFromQueue.push(eqOrderResult([]));
    // projects (owned list — no projects, so the access_links + price_usd fetches are skipped)
    mockFromQueue.push(eqResult([]));
    const mod = await loadRoute();
    const res = await mod.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sales).toEqual([]);
    expect(body.totals).toEqual({ count: 0, revenue_usd: 0, track_count: 0, project_count: 0 });
  });

  it('prefers frozen amount_usd over current price_usd for project sales', async () => {
    // REGRESSION (migration 044): if the producer lowers price_usd from
    // $99 → $19 the day after a sale, that sale's amount must remain $99.
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'seller-1', admin: adminMock() });

    // 1. license_purchases — none
    mockFromQueue.push(eqOrderResult([]));
    // 2. projects (owned) — one project, current price $19
    mockFromQueue.push(eqResult([{ id: 'proj-1', name: 'Bundle' }]));
    // 3. project_access_links (in / order) — one sale frozen at $99
    mockFromQueue.push(inOrderResult([
      {
        id: 'access-1',
        project_id: 'proj-1',
        buyer_email: 'b@x.io',
        stripe_session_id: 'cs_test_1',
        amount_usd: 99,
        created_at: '2026-01-02T00:00:00Z',
        expires_at: null,
      },
    ]));
    // 4. projects price_usd lookup — current price is $19 (lowered post-sale)
    mockFromQueue.push(inResult([{ id: 'proj-1', price_usd: 19 }]));

    const mod = await loadRoute();
    const res = await mod.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sales).toHaveLength(1);
    expect(body.sales[0].kind).toBe('project');
    expect(body.sales[0].amount_usd).toBe(99); // ← frozen, not 19
    expect(body.totals.revenue_usd).toBe(99);
    expect(body.totals.project_count).toBe(1);
  });

  it('falls back to current price_usd when amount_usd is null (legacy row)', async () => {
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'seller-1', admin: adminMock() });

    mockFromQueue.push(eqOrderResult([]));
    mockFromQueue.push(eqResult([{ id: 'proj-1', name: 'Bundle' }]));
    mockFromQueue.push(inOrderResult([
      {
        id: 'access-1',
        project_id: 'proj-1',
        buyer_email: 'b@x.io',
        stripe_session_id: 'cs_test_1',
        amount_usd: null, // pre-migration-044 row
        created_at: '2026-01-02T00:00:00Z',
        expires_at: null,
      },
    ]));
    mockFromQueue.push(inResult([{ id: 'proj-1', price_usd: 19 }]));

    const mod = await loadRoute();
    const res = await mod.GET();
    const body = await res.json();
    expect(body.sales[0].amount_usd).toBe(19); // ← falls back to current
  });

  it('merges track sales and project sales sorted by created_at desc', async () => {
    mockRequireUser.mockResolvedValue({ ok: true, userId: 'seller-1', admin: adminMock() });

    // 1. license_purchases — one track sale older than the project sale
    mockFromQueue.push(eqOrderResult([
      {
        id: 'lp-1',
        buyer_email: 'a@x.io',
        track_ids: ['track-a'],
        line_items: [{ track_id: 'track-a', license_type: 'lease' }],
        license_type: 'lease',
        amount_usd: 30,
        stripe_session_id: 'cs_t_1',
        status: 'paid',
        download_unlocked: true,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]));
    // 2. tracks hydration
    mockFromQueue.push(inResult([{ id: 'track-a', title: 'Track A' }]));
    // 3. projects (owned)
    mockFromQueue.push(eqResult([{ id: 'proj-1', name: 'Bundle' }]));
    // 4. project_access_links — newer sale
    mockFromQueue.push(inOrderResult([
      {
        id: 'access-1',
        project_id: 'proj-1',
        buyer_email: 'b@x.io',
        stripe_session_id: 'cs_p_1',
        amount_usd: 99,
        created_at: '2026-01-02T00:00:00Z',
        expires_at: null,
      },
    ]));
    // 5. projects price_usd lookup
    mockFromQueue.push(inResult([{ id: 'proj-1', price_usd: 99 }]));

    const mod = await loadRoute();
    const res = await mod.GET();
    const body = await res.json();
    expect(body.sales).toHaveLength(2);
    // Newer first
    expect(body.sales[0].kind).toBe('project');
    expect(body.sales[1].kind).toBe('track');
    expect(body.sales[1].item_label).toBe('Track A'); // hydrated from tracks table
    expect(body.totals.revenue_usd).toBe(129);
    expect(body.totals.track_count).toBe(1);
    expect(body.totals.project_count).toBe(1);
  });
});
