import { describe, it, expect } from 'vitest';
import { findStuckFulfillments, type PurchaseRow } from './fulfillment-alerts';

const NOW = Date.parse('2026-06-28T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const TH = { stemsHours: 24, emailMinutes: 30 };

const row = (over: Partial<PurchaseRow>): PurchaseRow => ({
  id: 'p1', seller_user_id: 's1', status: 'paid', created_at: hoursAgo(48), ...over,
});

describe('findStuckFulfillments', () => {
  it('flags an exclusive awaiting stems past the threshold', () => {
    const out = findStuckFulfillments([row({ needs_stems_upload: true, created_at: hoursAgo(48) })], NOW, TH);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('awaiting_stems');
  });

  it('does NOT flag stems still within the grace window', () => {
    const out = findStuckFulfillments([row({ needs_stems_upload: true, created_at: hoursAgo(2) })], NOW, TH);
    expect(out).toHaveLength(0);
  });

  it('flags a paid purchase whose delivery email never sent', () => {
    const out = findStuckFulfillments([row({ fulfillment_email_sent: false, created_at: minsAgo(45) })], NOW, TH);
    expect(out.map((a) => a.kind)).toEqual(['delivery_email_failed']);
  });

  it('does NOT flag a fresh purchase whose email is still in flight', () => {
    const out = findStuckFulfillments([row({ fulfillment_email_sent: false, created_at: minsAgo(5) })], NOW, TH);
    expect(out).toHaveLength(0);
  });

  it('can raise both kinds for one row', () => {
    const out = findStuckFulfillments(
      [row({ needs_stems_upload: true, fulfillment_email_sent: false, created_at: hoursAgo(48) })],
      NOW, TH,
    );
    expect(out.map((a) => a.kind).sort()).toEqual(['awaiting_stems', 'delivery_email_failed']);
  });

  it('ignores refunded/disputed and seller-less rows', () => {
    const out = findStuckFulfillments([
      row({ needs_stems_upload: true, status: 'refunded' }),
      row({ needs_stems_upload: true, seller_user_id: null }),
    ], NOW, TH);
    expect(out).toHaveLength(0);
  });

  it('ignores rows with nothing wrong', () => {
    const out = findStuckFulfillments(
      [row({ needs_stems_upload: false, fulfillment_email_sent: true })],
      NOW, TH,
    );
    expect(out).toHaveLength(0);
  });
});
