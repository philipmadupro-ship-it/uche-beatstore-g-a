/**
 * Route tests for /api/stripe/webhook.
 *
 * The webhook is the most safety-critical endpoint in the app — Stripe
 * retries failed deliveries and we charge real money. This suite covers
 * the protective layers around fulfillment:
 *
 *   - 400 when the Stripe-Signature header / secret is missing
 *   - 400 when constructEvent throws (bad signature)
 *   - Layer-1 idempotency: a duplicate event_id short-circuits without
 *     touching fulfillment tables
 *   - Regression coverage for marking Stripe events processed only after
 *     durable purchase/access state exists
 *   - Regression coverage for critical delivery fulfillment not being
 *     silently fire-and-forget
 *   - Non-checkout events (e.g. charge.refunded with no purchase row)
 *     return 200 without crashing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockConstructEvent = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockResendSend = vi.fn();
const mockRenderContractPdf = vi.fn();
const mockUploadContractPdf = vi.fn();

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) },
  }),
}));

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock('resend', () => ({ Resend: class { emails = { send: mockResendSend } } }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://example.test' }));
vi.mock('@/lib/contracts/pdf', () => ({
  renderContractPdf: (...args: unknown[]) => mockRenderContractPdf(...args),
}));
vi.mock('@/lib/storage/upload', () => ({
  uploadContractPdf: (...args: unknown[]) => mockUploadContractPdf(...args),
}));

import { POST } from './route';

function req(body: string, sig: string | null = 'sig_test_123') {
  const headers = new Headers();
  if (sig) headers.set('stripe-signature', sig);
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers,
  }) as unknown as NextRequest;
}

function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_checkout',
        amount_total: 2500,
        customer: 'cus_test',
        customer_email: 'buyer@example.test',
        customer_details: { name: 'Buyer' },
        payment_intent: 'pi_test',
        metadata: {
          buyer_email: 'buyer@example.test',
          cart_items: JSON.stringify([
            { track_id: 'track_1', license_id: 'lease', license_type: 'lease' },
          ]),
        },
        ...overrides,
      },
    },
  };
}

function resolvedEq(result: unknown = { error: null }) {
  return {
    eq: vi.fn(() => Promise.resolve(result)),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForCall(fn: ReturnType<typeof vi.fn>) {
  for (let i = 0; i < 20; i += 1) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for mock call');
}

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockResendSend.mockReset();
  mockRenderContractPdf.mockReset();
  mockUploadContractPdf.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

describe('POST /api/stripe/webhook', () => {
  it('400s when stripe-signature header is missing', async () => {
    const res = await POST(req('{}', null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing signature' });
  });

  it('400s when STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(req('{}'));
    expect(res.status).toBe(400);
  });

  it('400s when constructEvent throws (bad signature)', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad signature' });
  });

  it('short-circuits on duplicate event_id (idempotency layer 1)', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_dup', metadata: {} } },
    });
    // First .from() call checks processed_stripe_events and finds the event.
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { event_id: 'evt_dup' }, error: null }),
        }),
      }),
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, skipped: true });
    // No further DB calls should have happened
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('does not mark a checkout event processed when the track purchase row fails to persist', async () => {
    const dbWrites: Array<{ table: string; method: string; payload: unknown }> = [];
    mockConstructEvent.mockReturnValue(checkoutCompletedEvent());
    mockFrom.mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: (payload: unknown) => {
            dbWrites.push({ table, method: 'insert', payload });
            return { select: vi.fn(() => Promise.resolve({ error: null, count: null })) };
          },
        };
      }

      if (table === 'abandoned_carts') {
        return {
          update: vi.fn(() => resolvedEq({ error: null })),
        };
      }

      if (table === 'license_purchases') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
          upsert: vi.fn(() => ({
            select: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: { message: 'purchase write failed' },
              }),
            ),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const res = await POST(req('{}'));

    expect(res.status).toBe(500);
    expect(dbWrites).not.toContainEqual(
      expect.objectContaining({ table: 'processed_stripe_events', method: 'insert' }),
    );
  });

  it('persists custom license file entitlements in purchase line_items', async () => {
    const licenseId = '11111111-1111-4111-8111-111111111111';
    let persistedLineItems: unknown = null;
    mockConstructEvent.mockReturnValue(checkoutCompletedEvent({
      metadata: {
        buyer_email: 'buyer@example.test',
        cart_items: JSON.stringify([{
          track_id: 'track_1',
          license_id: licenseId,
          license_type: 'lease',
        }]),
      },
    }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: vi.fn(() => ({
            select: vi.fn(() => Promise.resolve({ error: null })),
          })),
        };
      }
      if (table === 'abandoned_carts') {
        return { update: vi.fn(() => resolvedEq({ error: null })) };
      }
      if (table === 'license_purchases') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          upsert: (payload: Record<string, unknown>) => {
            persistedLineItems = payload.line_items;
            return {
              select: () => Promise.resolve({ data: [{ id: 'purchase_1' }], error: null }),
            };
          },
        };
      }
      if (table === 'licenses') {
        return {
          select: () => ({
            in: () => Promise.resolve({
              data: [{
                id: licenseId,
                is_exclusive: false,
                file_types: ['mp3', 'wav'],
                stems_included: false,
              }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'tracks') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await POST(req('{}'));

    expect(res.status).toBe(200);
    expect(persistedLineItems).toEqual([{
      track_id: 'track_1',
      license_id: licenseId,
      license_type: 'lease',
      file_types: ['MP3', 'WAV'],
      stems_included: false,
      is_exclusive: false,
    }]);
  });

  it('does not acknowledge a paid checkout until the buyer delivery email completes', async () => {
    const emailSend = deferred<{ id: string }>();
    let purchaseSelectCount = 0;
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM_EMAIL = 'sales@example.test';
    mockConstructEvent.mockReturnValue(checkoutCompletedEvent());
    mockRenderContractPdf.mockResolvedValue(Buffer.from('pdf'));
    mockUploadContractPdf.mockResolvedValue(null);
    mockResendSend.mockReturnValue(emailSend.promise);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'processed_stripe_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => Promise.resolve({ error: null, count: null })),
          })),
        };
      }

      if (table === 'abandoned_carts') {
        return {
          update: vi.fn(() => resolvedEq({ error: null })),
        };
      }

      if (table === 'license_purchases') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve(
                  purchaseSelectCount++ === 0
                    ? { data: null, error: null }
                    : { data: { fulfillment_email_sent: false }, error: null },
                ),
              ),
            })),
          })),
          upsert: vi.fn(() => ({
            select: vi.fn(() => Promise.resolve({ data: [{ id: 'purchase_1' }], error: null })),
          })),
          update: vi.fn(() => resolvedEq({ error: null })),
        };
      }

      if (table === 'tracks') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const postPromise = POST(req('{}'));

    await waitForCall(mockResendSend);
    await expect(Promise.race([
      postPromise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ])).resolves.toBe('pending');

    emailSend.resolve({ id: 'email_1' });
    const res = await postPromise;
    expect(res.status).toBe(200);
  });

  it('returns 200 for events we do not handle', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_other',
      type: 'customer.subscription.created',
      data: { object: {} },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});

/**
 * Fulfillment-branch coverage.
 *
 * The webhook makes many ordered service-client calls, so instead of a brittle
 * ordered-mock tower we install a table+op-dispatched fake Supabase client: a
 * chainable builder whose terminal result is chosen by (table, operation) and
 * which records every write. Tests assert the *money writes* that happen before
 * the 200 response — robust to call reordering. The fire-and-forget background
 * tasks (CRM/email) run against benign defaults (Resend is skipped with no API
 * key; Stripe is only used for signature verification).
 */
const SELLER = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

function installDb(responder: (ctx: { table: string; op: string; payload?: any }) => any) {
  const writes: Array<{ table: string; op: string; payload?: any }> = [];
  mockFrom.mockImplementation((table: string) => {
    let op = 'select';
    let payload: any;
    const settle = () => Promise.resolve(responder({ table, op, payload }) ?? { data: null, error: null });
    const chain: any = {
      select: () => chain,
      insert: (p: any) => { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); return chain; },
      upsert: (p: any) => { op = 'upsert'; payload = p; writes.push({ table, op, payload: p }); return chain; },
      update: (p: any) => { op = 'update'; payload = p; writes.push({ table, op, payload: p }); return chain; },
      delete: () => { op = 'delete'; writes.push({ table, op }); return chain; },
      eq: () => chain, in: () => chain, gte: () => chain, lt: () => chain, gt: () => chain,
      or: () => chain, not: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: () => settle(),
      single: () => settle(),
      then: (f: any, r: any) => settle().then(f, r),
      catch: (r: any) => settle().catch(r),
    };
    return chain;
  });
  mockRpc.mockResolvedValue({ data: 1, error: null });
  return writes;
}

describe('POST /api/stripe/webhook — fulfillment branches', () => {
  it('track_license: upserts a paid license_purchases row with the frozen amount', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_lp',
      type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_lp', amount_total: 2500, payment_intent: 'pi_lp', customer: 'cus_1',
        metadata: {
          purchase_kind: 'track_license',
          seller_user_id: SELLER,
          buyer_email: 'buyer@example.com',
          cart_items: JSON.stringify([{ track_id: 't1', license_id: 'lease', license_type: 'lease' }]),
        },
      } },
    });
    const writes = installDb(({ table, op }) => {
      if (table === 'processed_stripe_events' && op === 'insert') return { error: null, count: null };
      if (table === 'license_purchases' && op === 'select') return { data: null };
      if (table === 'license_purchases' && op === 'upsert') return { data: [{ id: 'lp_1' }], error: null };
      return { data: null, error: null };
    });

    const res = await POST(req('{}'));
    expect(res.status).toBe(200);

    const upsert = writes.find((w) => w.table === 'license_purchases' && w.op === 'upsert');
    expect(upsert).toBeTruthy();
    expect(upsert!.payload).toMatchObject({
      status: 'paid',
      stripe_session_id: 'cs_lp',
      amount_usd: 25,
      track_ids: ['t1'],
      download_unlocked: true,
    });
  });

  it('project: inserts a project_access_links row with the frozen amount', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_proj',
      type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_proj', amount_total: 5000, payment_intent: 'pi_proj', customer: 'cus_2',
        metadata: { purchase_kind: 'project', project_id: PROJECT, seller_user_id: SELLER, buyer_email: 'buyer@example.com' },
      } },
    });
    const writes = installDb(({ table, op }) => {
      if (table === 'processed_stripe_events' && op === 'insert') return { error: null, count: null };
      if (table === 'project_access_links' && op === 'select') return { data: null };
      if (table === 'project_access_links' && op === 'insert') return { data: { id: 'pal_1', token: 'tok_abc' }, error: null };
      return { data: null, error: null };
    });

    const res = await POST(req('{}'));
    expect(res.status).toBe(200);

    const insert = writes.find((w) => w.table === 'project_access_links' && w.op === 'insert');
    expect(insert).toBeTruthy();
    expect(insert!.payload).toMatchObject({
      project_id: PROJECT,
      stripe_session_id: 'cs_proj',
      amount_usd: 50,
    });
  });

  it('charge.refunded: flips status to refunded and re-lists the exclusive track', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_refund',
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_lp' } },
    });
    const writes = installDb(({ table, op }) => {
      if (table === 'license_purchases' && op === 'update') return { error: null };
      if (table === 'license_purchases' && op === 'select') return {
        data: { seller_user_id: SELLER, amount_usd: 25, buyer_email: 'b@x.com',
          line_items: [{ track_id: 't1', license_type: 'exclusive' }], track_ids: ['t1'] },
      };
      return { data: null, error: null };
    });

    const res = await POST(req('{}'));
    expect(res.status).toBe(200);

    const statusUpdate = writes.find((w) => w.table === 'license_purchases' && w.op === 'update');
    expect(statusUpdate!.payload).toMatchObject({ status: 'refunded', download_unlocked: false });

    const relist = writes.find((w) => w.table === 'tracks' && w.op === 'update');
    expect(relist!.payload).toMatchObject({ exclusive_sold: false, store_listed: true });
  });

  it('charge.dispute.created: flips status to disputed and does NOT re-list tracks', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_dispute',
      type: 'charge.dispute.created',
      data: { object: { payment_intent: 'pi_lp' } },
    });
    const writes = installDb(({ table, op }) => {
      if (table === 'license_purchases' && op === 'update') return { error: null };
      if (table === 'license_purchases' && op === 'select') return {
        data: { seller_user_id: SELLER, amount_usd: 25, buyer_email: 'b@x.com', line_items: [], track_ids: [] },
      };
      return { data: null, error: null };
    });

    const res = await POST(req('{}'));
    expect(res.status).toBe(200);

    const statusUpdate = writes.find((w) => w.table === 'license_purchases' && w.op === 'update');
    expect(statusUpdate!.payload).toMatchObject({ status: 'disputed', download_unlocked: false });
    // Disputes don't auto-relist (the sale may still be contested).
    expect(writes.find((w) => w.table === 'tracks' && w.op === 'update')).toBeUndefined();
  });
});
