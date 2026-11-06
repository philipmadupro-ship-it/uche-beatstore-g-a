import { describe, expect, it } from 'vitest';
import { advanceState, advanceView, ledgerTotals } from './advances';

const row = (over: Partial<Parameters<typeof advanceState>[0]> = {}) => ({ kind: 'recoupable', amount_minor: 5000, voided_at: null, ...over });
const none = { recouped: BigInt(0), referenced: false };

describe('advanceState', () => {
  it('an untouched recoupable advance is open, editable and can be voided', () => {
    const s = advanceState(row(), none);
    expect(s).toMatchObject({ status: 'open', canEditTerms: true, canVoid: true, canEditNote: true });
    expect(s.remaining).toBe(BigInt(5000));
  });

  it('a partly recouped advance has a remainder and is frozen', () => {
    const s = advanceState(row(), { recouped: BigInt(1200), referenced: true });
    expect(s.status).toBe('partly_recouped');
    expect(s.remaining).toBe(BigInt(3800));
    expect(s.canEditTerms).toBe(false);
    expect(s.canVoid).toBe(false);
    expect(s.canEditNote).toBe(true);
  });

  it('is recouped at exactly zero remaining and never goes below', () => {
    expect(advanceState(row(), { recouped: BigInt(5000), referenced: true }).status).toBe('recouped');
    expect(advanceState(row(), { recouped: BigInt(9000), referenced: true }).remaining).toBe(BigInt(0));
  });

  it('a non-recoupable advance is never drawn down, whatever the facts say', () => {
    const s = advanceState(row({ kind: 'non_recoupable' }), { recouped: BigInt(100), referenced: false });
    expect(s).toMatchObject({ status: 'non_recoupable', recouped: BigInt(0), remaining: BigInt(0) });
  });

  it('a void advance is final', () => {
    const s = advanceState(row({ voided_at: '2026-01-01T00:00:00Z' }), none);
    expect(s).toMatchObject({ status: 'void', canEditTerms: false, canEditNote: false, canVoid: false });
    expect(s.remaining).toBe(BigInt(0));
  });

  it('a referenced advance with no recoupment (a statement line only) is still frozen', () => {
    expect(advanceState(row(), { recouped: BigInt(0), referenced: true }).canEditTerms).toBe(false);
  });

  it('reads a big bigint column without a float', () => {
    expect(advanceState(row({ amount_minor: '9007199254740993' }), none).amount).toBe(BigInt('9007199254740993'));
  });
});

describe('ledgerTotals', () => {
  const item = (currency: string, kind: string, amount: number, recouped = 0, voided = false) => ({
    currency,
    kind,
    state: advanceState(row({ kind, amount_minor: amount, voided_at: voided ? 'x' : null }), { recouped: BigInt(recouped), referenced: recouped > 0 }),
  });

  it('totals per currency and never mixes them', () => {
    const t = ledgerTotals([item('USD', 'recoupable', 5000, 1000), item('USD', 'non_recoupable', 700), item('EUR', 'recoupable', 300)]);
    expect(t).toEqual([
      { currency: 'EUR', recoupable: BigInt(300), nonRecoupable: BigInt(0), recouped: BigInt(0), unrecouped: BigInt(300) },
      { currency: 'USD', recoupable: BigInt(5000), nonRecoupable: BigInt(700), recouped: BigInt(1000), unrecouped: BigInt(4000) },
    ]);
  });

  it('counts a void advance for nothing', () => {
    expect(ledgerTotals([item('USD', 'recoupable', 5000, 0, true)])).toEqual([]);
  });
});

describe('advanceView', () => {
  it('sends strings for money and no raw row fields', () => {
    const v = advanceView(
      { id: 'a', payee_id: 'p', kind: 'recoupable', amount_minor: 5000, currency: 'USD ', paid_on: '2026-01-02', note: 'signing', voided_at: null, created_at: 't', ...({ created_by: 'u' } as object) },
      { recouped: BigInt(1), referenced: true },
    );
    expect(v.amountMinor).toBe('5000');
    expect(v.remainingMinor).toBe('4999');
    expect(v.currency).toBe('USD');
    expect(Object.keys(v)).not.toContain('created_by');
  });
});
