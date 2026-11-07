import { describe, expect, it } from 'vitest';
import { financeSummary, financeSummaryView } from './summary';
import { payeePositions } from './position';

const B = (n: number) => BigInt(n);

describe('financeSummary', () => {
  const positions = payeePositions({
    payees: [{ id: 'a', name: 'A', currency: 'USD', artistContactId: null, status: 'active' }],
    advances: [{ id: '1', payee_id: 'a', kind: 'recoupable', amount_minor: 5000, currency: 'USD', paid_on: null, note: null, voided_at: null, created_at: 't', facts: { recouped: B(1000), referenced: true } }],
    earnedByPayee: new Map([['a', B(3000)]]),
    recoupedByPayee: new Map([['a', B(1000)]]),
    statements: [{ payee_id: 'a', status: 'issued', net_minor: 2000 }],
    payments: [{ payee_id: 'a', amount_minor: 500, voided_at: null }],
  });
  const rows = [{ releaseId: 'r', title: 'R', state: 'draft', releaseDate: null, currency: 'USD', gross: B(9000), royalties: B(3000), spent: B(1000), committed: B(0), margin: B(5000), lines: 2 }];

  it('folds positions and releases into one object per currency', () => {
    const s = financeSummary({ positions, releaseRows: rows, periods: [{ status: 'open' }, { status: 'closed' }, { status: 'closed' }] });
    expect(s.currencies).toHaveLength(1);
    expect(s.currencies[0].advances).toEqual({ recoupable: B(5000), nonRecoupable: B(0), recouped: B(1000), unrecouped: B(4000) });
    expect(s.currencies[0].earnings.margin).toBe(B(5000));
    expect(s.currencies[0].payouts).toMatchObject({ issued: B(2000), paid: B(500), owed: B(1500) });
    expect(s.periods).toEqual({ open: 1, closed: 2 });
  });

  it('keeps a currency that only has release income', () => {
    const s = financeSummary({ positions: [], releaseRows: [{ ...rows[0], currency: 'EUR' }] });
    expect(s.currencies.map((c) => c.currency)).toEqual(['EUR']);
    expect(s.periods).toBeNull();
  });

  it('is JSON-safe', () => {
    expect(() => JSON.stringify(financeSummaryView(financeSummary({ positions, releaseRows: rows })))).not.toThrow();
  });
});
