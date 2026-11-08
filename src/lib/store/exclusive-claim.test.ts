import { describe, it, expect } from 'vitest';
import { trackHeldByAnotherBuyer } from './exclusive-claim';

const exclusive = (over = {}) => ({
  track_ids: ['t1'],
  line_items: [{ track_id: 't1', license_type: 'exclusive' }],
  license_type: 'exclusive',
  download_unlocked: true,
  needs_refund_review: false,
  ...over,
});

describe('trackHeldByAnotherBuyer', () => {
  it('is true when another buyer holds a live exclusive on the track', () => {
    expect(trackHeldByAnotherBuyer('t1', [exclusive()])).toBe(true);
  });

  it('is false for a retry of the winner: the only other row is the flagged loser', () => {
    expect(trackHeldByAnotherBuyer('t1', [exclusive({ needs_refund_review: true })])).toBe(false);
  });

  it('is false when nobody else bought it, or they only leased it', () => {
    expect(trackHeldByAnotherBuyer('t1', [])).toBe(false);
    expect(trackHeldByAnotherBuyer('t1', [exclusive({ line_items: [{ track_id: 't1', license_type: 'lease' }], license_type: 'lease' })])).toBe(false);
  });

  it('ignores a refunded or disputed exclusive and purchases of other tracks', () => {
    expect(trackHeldByAnotherBuyer('t1', [exclusive({ download_unlocked: false })])).toBe(false);
    expect(trackHeldByAnotherBuyer('t1', [exclusive({ track_ids: ['t2'], line_items: [{ track_id: 't2', license_type: 'exclusive' }] })])).toBe(false);
  });

  it('reads a legacy row with no line items from its headline license type', () => {
    expect(trackHeldByAnotherBuyer('t1', [exclusive({ line_items: null })])).toBe(true);
    expect(trackHeldByAnotherBuyer('t1', [exclusive({ line_items: null, license_type: 'lease' })])).toBe(false);
  });
});
