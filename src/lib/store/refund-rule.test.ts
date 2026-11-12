import { describe, it, expect } from 'vitest';
import { refundAccessEffect } from './refund-rule';

describe('refundAccessEffect', () => {
  it('keeps access on a partial refund', () => {
    expect(refundAccessEffect('charge.refunded', { refunded: false, amount: 30000, amount_refunded: 1000 })).toBe('keep');
    expect(refundAccessEffect('charge.refunded', { amount: 30000, amount_refunded: 1000 })).toBe('keep');
    expect(refundAccessEffect('charge.refunded', { refunded: false })).toBe('keep');
  });

  it('revokes when the whole payment is returned', () => {
    expect(refundAccessEffect('charge.refunded', { refunded: true, amount: 30000, amount_refunded: 30000 })).toBe('revoke');
    expect(refundAccessEffect('charge.refunded', { amount: 30000, amount_refunded: 30000 })).toBe('revoke');
    // The last of several partial refunds is the one that completes it.
    expect(refundAccessEffect('charge.refunded', { refunded: true, amount: 30000, amount_refunded: 30000 })).toBe('revoke');
  });

  it('always revokes on a dispute, whatever the charge fields say', () => {
    expect(refundAccessEffect('charge.dispute.created', { refunded: false, amount: 30000, amount_refunded: 0 })).toBe('revoke');
    expect(refundAccessEffect('charge.dispute.created', {})).toBe('revoke');
  });

  it('revokes when the event shape cannot be read', () => {
    expect(refundAccessEffect('charge.refunded', {})).toBe('revoke');
    expect(refundAccessEffect('charge.refunded', { amount: null, amount_refunded: null })).toBe('revoke');
  });
});
