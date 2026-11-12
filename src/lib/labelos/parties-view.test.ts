import { describe, expect, it } from 'vitest';
import type { PartyView } from './credits';
import { bodyFromForm, confirmationState, emptyForm, filterParties, formFromParty, partyFormError } from './parties-view';

const view = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'p1', kind: 'person', displayName: 'Nova', contactId: null,
  legal: { legalName: 'Nova Okafor', email: 'n@x.test', ipi: '00987654321', isni: null, pro: 'SACEM', proAffiliation: 'affiliated', publisherName: 'Pub Ltd', publisherIpi: null, address: '2 road Y', country: 'GB', confirmedAt: null },
  payee: { taxId: 'GB-TAX-2', paymentInstructions: 'Invoice monthly' },
  ...over,
});

describe('filterParties', () => {
  const list = [view(), view({ id: 'p2', displayName: 'Kilo', legal: undefined, payee: undefined })];
  it('matches every word in the display name, legal name, PRO or country the viewer can see', () => {
    expect(filterParties(list, 'nova').map((p) => p.id)).toEqual(['p1']);
    expect(filterParties(list, 'okafor gb').map((p) => p.id)).toEqual(['p1']);
    expect(filterParties(list, 'sacem').map((p) => p.id)).toEqual(['p1']);
  });
  it('never matches on data the viewer was not sent (no legal block, no payee block)', () => {
    expect(filterParties(list, 'kilo').map((p) => p.id)).toEqual(['p2']);
    expect(filterParties(list, 'okafor kilo')).toEqual([]);
  });
  it('does not search the tax id or payment instructions', () => {
    expect(filterParties(list, 'GB-TAX-2')).toEqual([]);
    expect(filterParties(list, 'invoice')).toEqual([]);
  });
  it('an empty query keeps everything, in order', () => {
    expect(filterParties(list, '  ').map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('confirmationState', () => {
  it('is unknown without the legal block, confirmed with a stamp, otherwise unconfirmed', () => {
    expect(confirmationState(view({ legal: undefined }))).toBe('unknown');
    expect(confirmationState(view())).toBe('unconfirmed');
    expect(confirmationState(view({ legal: { ...view().legal!, confirmedAt: '2026-10-02T10:00:00Z' } }))).toBe('confirmed');
  });
});

describe('form ↔ body', () => {
  it('a new party sends only what was typed', () => {
    const f = { ...emptyForm(), displayName: ' Odile ', country: 'fr', taxId: 'FR1' };
    expect(bodyFromForm(f, null)).toEqual({ display_name: ' Odile ', country: 'fr', tax_id: 'FR1' });
  });
  it('an edit sends only the fields that changed, so an untouched name never trips the lock', () => {
    const original = formFromParty(view());
    expect(bodyFromForm(original, original)).toEqual({});
    expect(bodyFromForm({ ...original, address: '9 new road', pro: '' }, original)).toEqual({ address: '9 new road', pro: '' });
  });
  it('payee fields are left out of the body when the viewer never had them', () => {
    const original = formFromParty(view({ payee: undefined }));
    expect(original.taxId).toBe('');
    expect(bodyFromForm({ ...original, taxId: '' }, original)).toEqual({});
  });
  it('a form built from a party with no legal block is empty there, and a user_id is the linked account', () => {
    const f = formFromParty(view({ legal: undefined, payee: undefined, mine: true }), 'u1');
    expect(f.legalName).toBe('');
    expect(f.userId).toBe('u1');
  });
});

describe('partyFormError', () => {
  it('needs a display name', () => {
    expect(partyFormError({ ...emptyForm(), displayName: ' ' })).toMatch(/name/i);
    expect(partyFormError({ ...emptyForm(), displayName: 'Nova' })).toBeNull();
  });
  it('refuses a bank or card number in the payment instructions before it leaves the browser', () => {
    expect(partyFormError({ ...emptyForm(), displayName: 'N', paymentInstructions: 'GB29 NWBK 6016 1331 9268 19' })).toMatch(/bank or card number/i);
  });
  it('refuses a country that is not a two-letter code', () => {
    expect(partyFormError({ ...emptyForm(), displayName: 'N', country: 'France' })).toMatch(/two-letter/);
    expect(partyFormError({ ...emptyForm(), displayName: 'N', country: 'fr' })).toBeNull();
  });
});
