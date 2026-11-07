import { describe, expect, it } from 'vitest';
import { payeePositions, positionTotals, positionView } from './position';

const B = (n: number) => BigInt(n);
const payee = (id: string, currency = 'USD', status = 'active') => ({ id, name: id, currency, artistContactId: null, status });
const adv = (id: string, payee_id: string, kind: string, amount: number, recouped = 0, voided = false) => ({
  id, payee_id, kind, amount_minor: amount, currency: 'USD', paid_on: null, note: null, voided_at: voided ? 'x' : null, created_at: 't', facts: { recouped: B(recouped), referenced: recouped > 0 },
});

describe('payeePositions', () => {
  const base = {
    payees: [payee('a'), payee('b')],
    advances: [adv('1', 'a', 'recoupable', 5000, 1500), adv('2', 'a', 'non_recoupable', 700), adv('3', 'a', 'recoupable', 999, 0, true), adv('4', 'b', 'recoupable', 100)],
    earnedByPayee: new Map([['a', B(4000)]]),
    recoupedByPayee: new Map([['a', B(1500)]]),
    statements: [
      { payee_id: 'a', status: 'issued', net_minor: 2000 },
      { payee_id: 'a', status: 'draft', net_minor: 500 },
      { payee_id: 'a', status: 'void', net_minor: 9999 },
    ],
    payments: [
      { payee_id: 'a', amount_minor: 800, voided_at: null },
      { payee_id: 'a', amount_minor: 100, voided_at: 'x' },
    ],
  };
  const [a, b] = payeePositions(base);

  it('adds up one payee from the stored facts', () => {
    expect(a).toMatchObject({ recoupableAdvanced: B(5000), nonRecoupableAdvanced: B(700), unrecouped: B(3500), earned: B(4000), recouped: B(1500), netEarned: B(2500) });
  });

  it('separates what is on a statement, what was issued and what is owed', () => {
    expect(a).toMatchObject({ onStatements: B(2500), notOnStatement: B(0), issued: B(2000), paid: B(800), owed: B(1200) });
  });

  it('a void advance, void statement and void payment count for nothing', () => {
    expect(a.recoupableAdvanced).toBe(B(5000));
    expect(a.onStatements).toBe(B(2500));
    expect(a.paid).toBe(B(800));
  });

  it('another payee has only its own numbers', () => {
    expect(b).toMatchObject({ recoupableAdvanced: B(100), unrecouped: B(100), earned: B(0), owed: B(0), paid: B(0) });
  });

  it('totals per currency', () => {
    const t = positionTotals([...payeePositions(base), ...payeePositions({ ...base, payees: [payee('c', 'EUR')], advances: [], earnedByPayee: new Map(), recoupedByPayee: new Map(), statements: [], payments: [] })]);
    expect(t.map((x) => [x.currency, x.payees])).toEqual([['EUR', 1], ['USD', 2]]);
    expect(t[1].unrecouped).toBe(B(3600));
  });

  it('sends money as strings', () => {
    expect(positionView(a).owedMinor).toBe('1200');
  });
});
