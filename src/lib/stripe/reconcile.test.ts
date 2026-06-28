import { describe, it, expect } from 'vitest';
import { findUnfulfilledSessions, type StripeSessionLite } from './reconcile';

const s = (id: string, payment_status: string, amount_total: number | null = 1000, purchase_kind?: string): StripeSessionLite =>
  ({ id, payment_status, amount_total, purchase_kind });

describe('findUnfulfilledSessions', () => {
  it('flags a paid session with no fulfillment row', () => {
    const out = findUnfulfilledSessions([s('sess_1', 'paid', 2500, 'track_license')], new Set());
    expect(out).toEqual([{ sessionId: 'sess_1', amountUsd: 25, purchaseKind: 'track_license' }]);
  });

  it('ignores paid sessions that DO have a fulfillment row', () => {
    const out = findUnfulfilledSessions([s('sess_1', 'paid')], new Set(['sess_1']));
    expect(out).toEqual([]);
  });

  it('ignores unpaid / incomplete sessions (never owed fulfillment)', () => {
    const out = findUnfulfilledSessions(
      [s('sess_unpaid', 'unpaid'), s('sess_noprice', 'no_payment_required')],
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it('handles a mixed batch', () => {
    const sessions = [
      s('ok', 'paid'),          // fulfilled
      s('bad', 'paid', 5000, 'project'), // unfulfilled
      s('pending', 'unpaid'),   // ignored
    ];
    const out = findUnfulfilledSessions(sessions, new Set(['ok']));
    expect(out.map((u) => u.sessionId)).toEqual(['bad']);
    expect(out[0]).toEqual({ sessionId: 'bad', amountUsd: 50, purchaseKind: 'project' });
  });

  it('reports null amount when Stripe omits amount_total', () => {
    const out = findUnfulfilledSessions([s('x', 'paid', null)], new Set());
    expect(out[0].amountUsd).toBeNull();
  });
});
