import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: (...a: unknown[]) => mockSend(...a) }; } }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({}) }));

import { deliverFulfillmentEmail } from './email-outbox';

type Existing = { id: string; status: string; locked_at?: string | null } | null;

function fakeAdmin(existing: Existing, claimedByOther = false) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({
      select: () => {
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: existing, error: null });
        return c;
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'job1' }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.in = () => c;
        c.select = () => Promise.resolve({ data: claimedByOther ? [] : [{ id: existing?.id ?? 'job1' }], error: null });
        // plain `.eq()` terminal for the post-send updates
        (c as { then?: unknown }).then = (res: (v: unknown) => void) => res({ error: null });
        return c;
      },
    }),
  };
  return { admin: admin as never, inserts, updates };
}

const base = {
  kind: 'track' as const, referenceId: 'r1', stripeSessionId: 'cs_1',
  to: 'b@x.co', subject: 's', html: '<p>x</p>',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 're_x';
  process.env.RESEND_FROM_EMAIL = 'a@shop.example';
  mockSend.mockResolvedValue({ data: { id: 'e' }, error: null });
});

describe('deliverFulfillmentEmail — webhook holds its own job', () => {
  it('inserts the job already locked, so the cron cannot claim it mid-send', async () => {
    const { admin, inserts } = fakeAdmin(null);
    await deliverFulfillmentEmail({ admin, ...base });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ status: 'processing' });
    expect(typeof inserts[0].locked_at).toBe('string');
    expect(inserts[0].attempts).toBe(1);
  });

  it('a failed send releases the job (failed, unlocked, retry scheduled) for the cron', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const { admin, updates } = fakeAdmin(null);
    await expect(deliverFulfillmentEmail({ admin, ...base })).rejects.toBeTruthy();
    const release = updates.find((u) => u.status === 'failed');
    expect(release).toMatchObject({ status: 'failed', locked_at: null });
    expect(typeof release?.next_attempt_at).toBe('string');
  });

  it('does not send when the cron is already sending this job', async () => {
    const { admin } = fakeAdmin({ id: 'job1', status: 'processing', locked_at: new Date().toISOString() });
    const r = await deliverFulfillmentEmail({ admin, ...base });
    expect(mockSend).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, inFlight: true });
  });

  it('takes over a previously failed job before sending it', async () => {
    const { admin, updates } = fakeAdmin({ id: 'job1', status: 'failed', locked_at: null });
    const r = await deliverFulfillmentEmail({ admin, ...base });
    expect(updates[0]).toMatchObject({ status: 'processing' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(true);
  });

  it('does not send when the cron claims the failed job first (compare-and-set lost)', async () => {
    const { admin } = fakeAdmin({ id: 'job1', status: 'failed', locked_at: null }, true);
    const r = await deliverFulfillmentEmail({ admin, ...base });
    expect(mockSend).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, inFlight: true });
  });

  it('still sends directly when the outbox table is unavailable', async () => {
    const admin = { from: () => { throw new Error('relation does not exist'); } } as never;
    const r = await deliverFulfillmentEmail({ admin, ...base });
    expect(r.sent).toBe(true);
  });
});
