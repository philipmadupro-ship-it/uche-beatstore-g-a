import { describe, it, expect } from 'vitest';
import { computeFunnel, isStoreEventType, FUNNEL_STAGES } from './funnel';

describe('isStoreEventType', () => {
  it('accepts known types, rejects others', () => {
    expect(isStoreEventType('pdp_view')).toBe(true);
    expect(isStoreEventType('remove_from_cart')).toBe(true);
    expect(isStoreEventType('purchase')).toBe(true);
    expect(isStoreEventType('nope')).toBe(false);
    expect(isStoreEventType(null)).toBe(false);
    expect(isStoreEventType(7)).toBe(false);
  });
});

describe('computeFunnel', () => {
  it('returns one result per stage in order', () => {
    const out = computeFunnel([]);
    expect(out.map((r) => r.stage)).toEqual([...FUNNEL_STAGES]);
    expect(out.every((r) => r.sessions === 0)).toBe(true);
  });

  it('counts each session once per stage and back-fills shallower stages', () => {
    // s1 reaches purchase (deepest), s2 reaches add_to_cart, s3 only views.
    const out = computeFunnel([
      { session_id: 's1', event_type: 'pdp_view' },
      { session_id: 's1', event_type: 'add_to_cart' },
      { session_id: 's1', event_type: 'add_to_cart' }, // dup add — still 1 session
      { session_id: 's1', event_type: 'checkout_start' },
      { session_id: 's1', event_type: 'purchase' },
      { session_id: 's2', event_type: 'add_to_cart' }, // no view event — still back-filled
      { session_id: 's3', event_type: 'pdp_view' },
    ]);
    const by = Object.fromEntries(out.map((r) => [r.stage, r.sessions]));
    expect(by.pdp_view).toBe(3); // s1, s2 (back-filled), s3
    expect(by.add_to_cart).toBe(2); // s1, s2
    expect(by.checkout_start).toBe(1); // s1
    expect(by.purchase).toBe(1); // s1
  });

  it('computes pctOfTop and pctOfPrev', () => {
    const out = computeFunnel([
      { session_id: 'a', event_type: 'pdp_view' },
      { session_id: 'b', event_type: 'pdp_view' },
      { session_id: 'c', event_type: 'pdp_view' },
      { session_id: 'd', event_type: 'pdp_view' },
      { session_id: 'a', event_type: 'add_to_cart' },
      { session_id: 'b', event_type: 'add_to_cart' },
      { session_id: 'a', event_type: 'purchase' },
    ]);
    const view = out.find((r) => r.stage === 'pdp_view')!;
    const cart = out.find((r) => r.stage === 'add_to_cart')!;
    const checkout = out.find((r) => r.stage === 'checkout_start')!;
    const purchase = out.find((r) => r.stage === 'purchase')!;

    expect(view.sessions).toBe(4);
    expect(view.pctOfTop).toBe(100);
    expect(cart.sessions).toBe(2);
    expect(cart.pctOfTop).toBe(50);
    expect(cart.pctOfPrev).toBe(50);
    // purchase back-fills checkout_start, so checkout = 1 session (a)
    expect(checkout.sessions).toBe(1);
    expect(purchase.sessions).toBe(1);
    expect(purchase.pctOfPrev).toBe(100); // 1 of 1 that reached checkout
  });

  it('ignores sessionless rows and non-funnel types', () => {
    const out = computeFunnel([
      { session_id: null, event_type: 'pdp_view' },
      { session_id: 's1', event_type: 'remove_from_cart' }, // not a funnel stage
      { event_type: 'pdp_view' },
    ]);
    expect(out.every((r) => r.sessions === 0)).toBe(true);
  });
});
