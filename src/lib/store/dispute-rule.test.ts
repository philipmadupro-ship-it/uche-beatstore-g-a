import { describe, it, expect } from 'vitest';
import { disputeClosedEffect } from './dispute-rule';

describe('disputeClosedEffect', () => {
  it('restores access when the seller kept the money', () => {
    expect(disputeClosedEffect('won')).toBe('restore');
    expect(disputeClosedEffect('warning_closed')).toBe('restore');
  });

  it('keeps access revoked when the bank took the money or the charge was refunded', () => {
    expect(disputeClosedEffect('lost')).toBe('keep-revoked');
    expect(disputeClosedEffect('charge_refunded')).toBe('keep-revoked');
  });

  it('changes nothing for a status it does not recognise or an open one', () => {
    for (const s of ['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review', 'something_new', '', null, undefined]) {
      expect(disputeClosedEffect(s)).toBe('ignore');
    }
  });
});
