import { describe, expect, it } from 'vitest';
import { clearsConfirmation, normalizeIsni, ownPartyName, partyColumns, partyLockViolation, pickSelfCorrections } from './parties';

describe('partyColumns', () => {
  it('keeps only the keys the body names', () => {
    expect(partyColumns({ legal_name: ' Nova  Okafor ' })).toEqual({ ok: true, columns: { legal_name: 'Nova Okafor' } });
    expect(partyColumns({})).toEqual({ ok: true, columns: {} });
  });

  it('empty strings clear a field; null clears too', () => {
    expect(partyColumns({ legal_name: '  ', ipi: '', pro: null, email: '' })).toEqual({
      ok: true,
      columns: { legal_name: null, ipi: null, pro: null, email: null },
    });
  });

  it('normalises the IPI to digits, whatever separators it was typed with', () => {
    expect(partyColumns({ ipi: '00 123.456-789' })).toEqual({ ok: true, columns: { ipi: '00123456789' } });
    expect(partyColumns({ publisher_ipi: '123456789' })).toEqual({ ok: true, columns: { publisher_ipi: '123456789' } });
  });

  it('refuses an IPI that cannot be real, naming the field', () => {
    expect(partyColumns({ ipi: '12ab' })).toEqual({ ok: false, error: 'ipi: not a valid IPI (9 to 11 digits)' });
    expect(partyColumns({ publisher_ipi: '1' })).toMatchObject({ ok: false, error: expect.stringContaining('publisher_ipi') });
  });

  it('normalises an ISNI and refuses a malformed one', () => {
    expect(normalizeIsni('0000 0001 2103 000x')).toBe('000000012103000X');
    expect(partyColumns({ isni: '0000 0001 2103 0007' })).toEqual({ ok: true, columns: { isni: '0000000121030007' } });
    expect(partyColumns({ isni: '123' })).toMatchObject({ ok: false });
  });

  it('lower-cases the email and requires a display name when one is sent', () => {
    expect(partyColumns({ email: ' Nova@Example.COM ' })).toEqual({ ok: true, columns: { email: 'nova@example.com' } });
    expect(partyColumns({ display_name: '   ' })).toEqual({ ok: false, error: 'A party needs a display name' });
    expect(partyColumns({ display_name: ' Nova ' })).toEqual({ ok: true, columns: { display_name: 'Nova' } });
  });

  it('passes the kind, the affiliation and the links through', () => {
    expect(partyColumns({ kind: 'company', pro_affiliation: 'affiliated', contact_id: 'c', user_id: null })).toEqual({
      ok: true,
      columns: { kind: 'company', pro_affiliation: 'affiliated', contact_id: 'c', user_id: null },
    });
  });
});

describe('ownPartyName', () => {
  it('prefers the name, then the email’s local part, then a neutral word', () => {
    expect(ownPartyName({ name: 'Pierre', email: 'p@x.test' })).toBe('Pierre');
    expect(ownPartyName({ name: null, email: 'pierre@x.test' })).toBe('pierre');
    expect(ownPartyName({ name: null, email: null })).toBe('Member');
  });
});

describe('LABEL-54 fields', () => {
  it('stores address, upper-cased country, tax id and payment instructions as typed text', () => {
    expect(partyColumns({ address: ' 1 rue  X ', country: 'fr', tax_id: ' FR 12 ', payment_instructions: 'PayPal, ask finance' })).toEqual({
      ok: true,
      columns: { address: '1 rue X', country: 'FR', tax_id: 'FR 12', payment_instructions: 'PayPal, ask finance' },
    });
  });
  it('empty strings clear them', () => {
    expect(partyColumns({ address: '', country: '', tax_id: ' ', payment_instructions: '' })).toEqual({
      ok: true,
      columns: { address: null, country: null, tax_id: null, payment_instructions: null },
    });
  });
  it('refuses a country that is not a two-letter code', () => {
    expect(partyColumns({ country: 'France' })).toMatchObject({ ok: false, error: expect.stringContaining('country') });
  });
  it('refuses payment instructions that hold an IBAN or a card number, without echoing the number', () => {
    for (const v of ['GB29 NWBK 6016 1331 9268 19', '4111 1111 1111 1111']) {
      const r = partyColumns({ payment_instructions: v });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(v.slice(0, 8));
    }
  });
});

describe('pickSelfCorrections', () => {
  it('keeps the legal fields and drops identity, links and payee data', () => {
    expect(
      pickSelfCorrections({ legal_name: 'N', ipi: '1', display_name: 'X', user_id: 'u', contact_id: 'c', tax_id: 't', payment_instructions: 'p', email: 'e', kind: 'company', address: 'a', country: 'FR' }),
    ).toEqual({ legal_name: 'N', ipi: '1', address: 'a', country: 'FR' });
  });
});

describe('partyLockViolation', () => {
  const cur = { display_name: 'Nova', user_id: 'u1' };
  it('allows anything while no sheet that left draft names the party', () => {
    expect(partyLockViolation({ display_name: 'Nova O', user_id: 'u2' }, cur, false)).toBeNull();
  });
  it('refuses a rename once a circulated sheet names the party, whitespace and all', () => {
    expect(partyLockViolation({ display_name: 'Nova Okafor' }, cur, true)).toMatch(/new version/i);
    expect(partyLockViolation({ display_name: '  nova ' }, cur, true)).toMatch(/new version/i);
  });
  it('lets the same name through (a no-op rename is not a rename)', () => {
    expect(partyLockViolation({ display_name: ' Nova  ' }, cur, true)).toBeNull();
  });
  it('refuses swapping or removing the linked account, allows linking one that is missing', () => {
    expect(partyLockViolation({ user_id: 'u2' }, cur, true)).toMatch(/account/);
    expect(partyLockViolation({ user_id: null }, cur, true)).toMatch(/account/);
    expect(partyLockViolation({ user_id: 'u1' }, cur, true)).toBeNull();
    expect(partyLockViolation({ user_id: 'u9' }, { display_name: 'Nova', user_id: null }, true)).toBeNull();
  });
  it('never locks the legal data', () => {
    expect(partyLockViolation({}, cur, true)).toBeNull();
  });
});

describe('clearsConfirmation', () => {
  it('is true for a field the person can correct, and for re-linking the account', () => {
    for (const key of ['legal_name', 'ipi', 'isni', 'pro', 'pro_affiliation', 'publisher_name', 'publisher_ipi', 'address', 'country', 'user_id']) {
      expect(clearsConfirmation({ [key]: 'x' }), key).toBe(true);
    }
  });
  it('is false for the display name, the kind, the email and payee data', () => {
    expect(clearsConfirmation({ display_name: 'x', kind: 'company', email: 'e', tax_id: 't', payment_instructions: 'p' })).toBe(false);
    expect(clearsConfirmation({})).toBe(false);
  });
  it('is true for the contact link (LABEL-71: a confirmed party stands for its artist in store consent, so moving it clears it)', () => {
    expect(clearsConfirmation({ contact_id: 'c' })).toBe(true);
  });
});
