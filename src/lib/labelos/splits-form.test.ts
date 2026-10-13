import { describe, expect, it } from 'vitest';
import { formState, rowsToBody, sameRows, withRemainder, type FormRow } from './splits-form';
import { FULL_SHARE } from './splits';

const row = (partyId: string, share: string, role = 'writer', key = `k-${partyId}-${share}`): FormRow => ({ key, partyId, role, share });

describe('formState: the live sum', () => {
  it('33.3333 × 3 reads 99.9999%, 0.0001% unassigned, and cannot circulate', () => {
    const s = formState('composition', [row('a', '33.3333'), row('b', '33.3333'), row('c', '33.3333')]);
    expect(s).toMatchObject({ total: 999_999, remaining: 1, totalText: '99.9999%', tone: 'short', canCirculate: false, complete: true });
    expect(s.summary).toBe('0.0001% unassigned.');
    expect(s.blocker).toBe('The shares add up to 99.9999%; 0.0001% is still unassigned.');
  });

  it('exactly 100 can circulate', () => {
    const s = formState('composition', [row('a', '33.3334'), row('b', '33.3333'), row('c', '33.3333')]);
    expect(s).toMatchObject({ total: FULL_SHARE, remaining: 0, totalText: '100%', tone: 'ok', canCirculate: true, blocker: null });
    expect(s.summary).toBe('Adds up to 100%.');
  });

  it('over 100 says how much', () => {
    const s = formState('composition', [row('a', '60'), row('b', '40.5')]);
    expect(s).toMatchObject({ tone: 'over', canCirculate: false });
    expect(s.summary).toBe('0.5% too much.');
  });

  it('a half-typed row is incomplete, counts for nothing, and blocks with a plain reason', () => {
    expect(formState('composition', [row('a', '50'), row('b', '')])).toMatchObject({ total: 500_000, complete: false, canCirculate: false, blocker: 'Every line needs a share: more than 0, up to four decimals.' });
    expect(formState('composition', [row('a', '50'), row('', '50')]).blocker).toBe('Every line needs a person.');
    expect(formState('composition', [row('a', '50.12345')]).units).toEqual([null]);
    expect(formState('composition', [row('a', '0')]).units).toEqual([null]);
    expect(formState('composition', [row('a', 'abc')]).complete).toBe(false);
    expect(formState('composition', []).blocker).toBe('Add at least one line.');
  });

  it('is exact where floats are not: 0.1 + 0.2 + 99.7', () => {
    expect(formState('composition', [row('a', '0.1'), row('b', '0.2'), row('c', '99.7')]).canCirculate).toBe(true);
  });

  it('a master sheet takes master_owner only', () => {
    expect(formState('master', [row('a', '100', 'master_owner')]).canCirculate).toBe(true);
    expect(formState('master', [row('a', '100', 'writer')]).canCirculate).toBe(false);
  });
});

describe('withRemainder ("Add remainder")', () => {
  it('fills the first blank share with exactly what is missing', () => {
    const rows = withRemainder('composition', [row('a', '33.3333'), row('b', ''), row('c', '33.3333')]);
    expect(rows.map((r) => r.share)).toEqual(['33.3333', '33.3334', '33.3333']);
    expect(formState('composition', rows).total).toBe(FULL_SHARE);
  });

  it('adds a row when every share is typed', () => {
    const before = [row('a', '33.3333'), row('b', '33.3333'), row('c', '33.3333')];
    const rows = withRemainder('composition', before);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({ partyId: '', role: 'writer', share: '0.0001' });
    expect(before).toHaveLength(3); // the input is not mutated
  });

  it('a master sheet’s new row has the master role', () => {
    expect(withRemainder('master', [])[0]).toMatchObject({ role: 'master_owner', share: '100' });
  });

  it('does nothing when full or over', () => {
    expect(withRemainder('composition', [row('a', '100')])).toHaveLength(1);
    expect(withRemainder('composition', [row('a', '70'), row('b', '40')]).map((r) => r.share)).toEqual(['70', '40']);
  });
});

describe('rowsToBody / sameRows', () => {
  it('sends the share as typed (trimmed) for the server to parse', () => {
    expect(rowsToBody([row('a', ' 12.5 ', 'publisher')])).toEqual([{ party_id: 'a', role: 'publisher', share: '12.5' }]);
  });

  it('"50", "50.0" and "50.0000" are the same share; a different role or party is a change', () => {
    expect(sameRows([row('a', '50', 'writer', '1')], [row('a', '50.0000', 'writer', '2')])).toBe(true);
    expect(sameRows([row('a', '50')], [row('a', '50', 'publisher')])).toBe(false);
    expect(sameRows([row('a', '50')], [row('b', '50')])).toBe(false);
    expect(sameRows([row('a', '50')], [row('a', '50'), row('b', '10')])).toBe(false);
  });
});
