/**
 * Route tests for /api/store/checkout — project-mode branch.
 *
 * Pinned regressions:
 *   - Stripe rejects `ui_mode: 'embedded'` ("no longer supported, use
 *     'embedded_page'") and `automatic_payment_methods` for embedded
 *     sessions. Both must stay out of the create-session payload.
 *   - Project checkout must validate buyer_email, presence of the
 *     project, and a positive price_usd before touching Stripe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSessionsCreate = vi.fn();
const mockIsStripeConfigured = vi.fn();
const mockIsSupabaseConfigured = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ checkout: { sessions: { create: mockSessionsCreate } } }),
  isStripeConfigured: () => mockIsStripeConfigured(),
}));

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockMaybeSingle(),
        }),
        in: () => ({ /* unused in project branch */ }),
      }),
    }),
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppUrl: () => 'https://example.test',
}));

function postBody(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/store/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const VALID_PROJECT = {
  id: PROJECT_ID,
  user_id: 'seller-1',
  name: 'Bundle One',
  price_usd: 49,
  store_featured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsStripeConfigured.mockReturnValue(true);
  mockIsSupabaseConfigured.mockReturnValue(true);
});

async function loadRoute() {
  return import('./route');
}

describe('POST /api/store/checkout — project mode', () => {
  it('rejects when buyer_email is missing', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ project_id: PROJECT_ID }));
    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('rejects when buyer_email is malformed', async () => {
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'not-an-email', project_id: PROJECT_ID }));
    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('returns 404 when project does not exist', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'b@x.io', project_id: PROJECT_ID }));
    expect(res.status).toBe(404);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('rejects an unpriced project (price_usd missing)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...VALID_PROJECT, price_usd: null }, error: null });
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'b@x.io', project_id: PROJECT_ID }));
    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('rejects a project priced at zero', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...VALID_PROJECT, price_usd: 0 }, error: null });
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'b@x.io', project_id: PROJECT_ID }));
    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('creates a Stripe session with embedded_page and no automatic_payment_methods', async () => {
    // REGRESSION: Stripe rejects ui_mode: 'embedded' (renamed) and
    // automatic_payment_methods (not supported for embedded). Both bugs
    // shipped to main once before being caught by manual verification.
    mockMaybeSingle.mockResolvedValueOnce({ data: VALID_PROJECT, error: null });
    mockSessionsCreate.mockResolvedValueOnce({ id: 'cs_test_x', client_secret: 'secret_x' });

    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'b@x.io', project_id: PROJECT_ID }));
    expect(res.status).toBe(200);

    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.ui_mode).toBe('embedded_page');
    expect(args).not.toHaveProperty('automatic_payment_methods');
    expect(args.mode).toBe('payment');
    expect(args.customer_email).toBe('b@x.io');
    expect(args.line_items).toHaveLength(1);
    expect(args.line_items[0].price_data.unit_amount).toBe(4900);
    expect(args.metadata.purchase_kind).toBe('project');
    expect(args.metadata.project_id).toBe(PROJECT_ID);
    expect(args.metadata.seller_user_id).toBe('seller-1');
    expect(args.return_url).toContain('{CHECKOUT_SESSION_ID}');

    const body = await res.json();
    expect(body).toEqual({ client_secret: 'secret_x', session_id: 'cs_test_x' });
  });

  it('returns 503 when Stripe is not configured', async () => {
    mockIsStripeConfigured.mockReturnValueOnce(false);
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'b@x.io', project_id: PROJECT_ID }));
    expect(res.status).toBe(503);
  });

  it('returns 503 when Supabase is not configured', async () => {
    mockIsSupabaseConfigured.mockReturnValueOnce(false);
    const mod = await loadRoute();
    const res = await mod.POST(postBody({ buyer_email: 'b@x.io', project_id: PROJECT_ID }));
    expect(res.status).toBe(503);
  });
});
