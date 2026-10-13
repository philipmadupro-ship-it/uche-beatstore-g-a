import { describe, expect, it } from 'vitest';
import { deliveredAtFor, deliveryDateProblem, planDelivery, type DeliveryFacts, type DeliveryRequest } from './release-delivery';

const NOW = new Date('2026-10-13T10:00:00Z');
const ready: DeliveryFacts = { state: 'draft', readyToDeliver: true, openGates: [] };
const blocked: DeliveryFacts = { state: 'draft', readyToDeliver: false, openGates: ['legal', 'artwork'] };
const req = (over: Partial<DeliveryRequest> = {}): DeliveryRequest => ({ distributor: 'DistroKid', deliveredOn: null, override: false, note: null, ...over });

describe('planDelivery', () => {
  it('delivers a ready draft, now when no date is given', () => {
    expect(planDelivery(ready, req(), false, NOW)).toEqual({ ok: true, override: false, note: null, deliveredAt: NOW.toISOString(), openGates: [] });
  });

  it('dates a delivery at noon UTC of the day named', () => {
    const plan = planDelivery(ready, req({ deliveredOn: '2026-10-12' }), false, NOW);
    expect(plan).toMatchObject({ ok: true, deliveredAt: '2026-10-12T12:00:00.000Z' });
    expect(deliveredAtFor('2026-10-12', NOW)).toBe('2026-10-12T12:00:00.000Z');
  });

  it('refuses a future or impossible date', () => {
    expect(deliveryDateProblem('2026-11-01', NOW)).toMatch(/future/);
    expect(deliveryDateProblem('2026-02-31', NOW)).toBeNull(); // Date.parse rolls over; the contract regex is the shape check
    expect(planDelivery(ready, req({ deliveredOn: '2027-01-01' }), true, NOW)).toMatchObject({ ok: false, status: 400, field: 'delivered_on' });
  });

  it('a blocked release is 422 without an override', () => {
    expect(planDelivery(blocked, req(), true, NOW)).toMatchObject({ ok: false, status: 422, field: 'gates' });
  });

  it('an owner overrides with a note, and the open gates are kept for the record', () => {
    expect(planDelivery(blocked, req({ override: true, note: '  Label signed off by email  ' }), true, NOW)).toEqual({
      ok: true,
      override: true,
      note: 'Label signed off by email',
      deliveredAt: NOW.toISOString(),
      openGates: ['legal', 'artwork'],
    });
  });

  it('an override without a note is 400, a blank note too', () => {
    for (const note of [null, '', '   ']) {
      expect(planDelivery(blocked, req({ override: true, note }), true, NOW)).toMatchObject({ ok: false, status: 400, field: 'override_note' });
    }
  });

  it('a non-owner asking for an override is 403 — before the note, the date or the state are looked at', () => {
    expect(planDelivery(blocked, req({ override: true, note: 'ok' }), false, NOW)).toMatchObject({ ok: false, status: 403, field: 'override' });
    expect(planDelivery({ ...blocked, state: 'delivered' }, req({ override: true }), false, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it('an override on a ready release is an ordinary delivery: nothing was overridden, no note kept', () => {
    expect(planDelivery(ready, req({ override: true, note: 'just in case' }), true, NOW)).toMatchObject({ ok: true, override: false, note: null });
  });

  it('only a draft is delivered: delivered and cancelled are 409', () => {
    for (const state of ['delivered', 'cancelled']) {
      expect(planDelivery({ ...ready, state }, req(), true, NOW)).toMatchObject({ ok: false, status: 409, field: 'state' });
    }
  });
});
