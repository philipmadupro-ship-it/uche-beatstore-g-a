import { describe, expect, it } from 'vitest';
import { mayReadPaymentReference, ownStatementRows, payeeView, statementView, type StatementRow } from './view';

const st = (over: Partial<StatementRow> = {}): StatementRow => ({
  id: 's1', payee_id: 'p1', period_id: 'per1', currency: 'USD', net_minor: 75000, status: 'issued',
  approved_at: '2026-10-01', issued_at: '2026-10-02', created_at: '2026-09-30', ...over,
});

describe('finance views', () => {
  it('the payment reference goes only to finance.write', () => {
    expect(mayReadPaymentReference(new Set(['finance.read']))).toBe(false);
    expect(mayReadPaymentReference(new Set(['finance.read', 'finance.write']))).toBe(true);
    const row = { id: 'y', party_id: 'p', artist_contact_id: null, currency: 'USD', status: 'active', payment_reference: 'on file', created_at: 'x' };
    expect(payeeView(row, { reference: false })).not.toHaveProperty('paymentReference');
    expect(payeeView(row, { reference: true }).paymentReference).toBe('on file');
  });
  it('money leaves as a string of minor units, exactly', () => {
    const v = statementView(st({ net_minor: '9007199254740993' }), [], { own: false });
    expect(v.netMinor).toBe('9007199254740993');
    expect(() => statementView(st({ net_minor: 1.5 }), [], { own: false })).toThrow();
  });
  it('an artist is sent no review state and only issued statements', () => {
    const own = statementView(st(), [], { own: true });
    expect(own).not.toHaveProperty('approvedAt');
    expect(own).not.toHaveProperty('createdAt');
    expect(ownStatementRows([st(), st({ id: 's2', status: 'draft' }), st({ id: 's3', status: 'void' }), st({ id: 's4', status: 'approved' })]).map((r) => r.id)).toEqual(['s1']);
  });
  it('builds the payee and lines field by field (no stray column leaks)', () => {
    const row = { id: 'y', party_id: 'p', artist_contact_id: 'a', currency: 'USD', status: 'active', created_at: 'x', secret: 'nope' } as never;
    expect(Object.keys(payeeView(row, { reference: false })).sort()).toEqual(['artistContactId', 'createdAt', 'currency', 'id', 'partyId', 'status']);
    const line = { id: 'l', statement_id: 's', kind: 'earning', track_id: null, description: null, share_units: null, amount_minor: 5, currency: 'USD', position: 0, org_id: 'leak' } as never;
    expect(Object.keys(statementView(st(), [line], { own: true }).lines[0])).not.toContain('org_id');
  });
});
