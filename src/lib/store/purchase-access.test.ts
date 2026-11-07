import { describe, it, expect } from 'vitest';
import { purchaseAccess, REVOKED_MESSAGE, UNDER_REVIEW_MESSAGE } from './purchase-access';

describe('purchaseAccess', () => {
  it('allows a paid, unflagged purchase', () => {
    expect(purchaseAccess({ download_unlocked: true, needs_refund_review: false })).toEqual({ allowed: true });
    // Rows from before migration 106 have no flag at all.
    expect(purchaseAccess({ download_unlocked: true })).toEqual({ allowed: true });
    expect(purchaseAccess({ download_unlocked: true, needs_refund_review: null })).toEqual({ allowed: true });
  });

  it('refuses a refunded or disputed purchase', () => {
    expect(purchaseAccess({ download_unlocked: false })).toEqual({ allowed: false, reason: 'revoked', message: REVOKED_MESSAGE });
    expect(purchaseAccess({ download_unlocked: null })).toMatchObject({ allowed: false, reason: 'revoked' });
  });

  it('holds a double-sold exclusive until the producer has reviewed it', () => {
    expect(purchaseAccess({ download_unlocked: true, needs_refund_review: true }))
      .toEqual({ allowed: false, reason: 'under-review', message: UNDER_REVIEW_MESSAGE });
  });

  it('reports a refund over a pending review, since that is the final word', () => {
    expect(purchaseAccess({ download_unlocked: false, needs_refund_review: true })).toMatchObject({ reason: 'revoked' });
  });
});
