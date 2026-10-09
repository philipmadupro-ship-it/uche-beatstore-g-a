import { describe, expect, it } from 'vitest';
import { normalizeIsni, ownPartyName, partyColumns } from './parties';

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
