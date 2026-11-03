import { describe, expect, it } from 'vitest';
import { closeCheck, mayCloseRole, mayReopenRole, periodOverviewView } from './period-close';

describe('closeCheck', () => {
  it('closes an open period with nothing in flux', () => {
    expect(closeCheck({ status: 'open', draftStatements: 0, payeesWithoutStatement: 0 })).toEqual({ ok: true, warnings: [] });
  });
  it('refuses while a draft statement exists', () => {
    const c = closeCheck({ status: 'open', draftStatements: 2, payeesWithoutStatement: 0 });
    expect(c).toMatchObject({ ok: false, code: 'drafts_open' });
    expect(!c.ok && c.message).toContain('2 draft statements');
  });
  it('warns, but does not refuse, when a payee has earnings and no statement', () => {
    const c = closeCheck({ status: 'open', draftStatements: 0, payeesWithoutStatement: 1 });
    expect(c.ok && c.warnings[0]).toContain('1 payee has earnings');
  });
  it('a closed period is already closed', () => {
    expect(closeCheck({ status: 'closed', draftStatements: 0, payeesWithoutStatement: 0 })).toMatchObject({ ok: false, code: 'already_closed' });
  });
});

describe('who may', () => {
  it('closing needs finance.approve over the whole organization', () => {
    expect(mayCloseRole(new Set(['finance.approve']), false)).toBe(true);
    expect(mayCloseRole(new Set(['finance.approve']), true)).toBe(false);
    expect(mayCloseRole(new Set(['finance.write']), false)).toBe(false);
  });
  it('only an owner reopens', () => {
    expect(mayReopenRole('owner')).toBe(true);
    expect(mayReopenRole('admin')).toBe(false);
  });
});

describe('periodOverviewView', () => {
  const p = { id: 'p', label: 'Q1', startsOn: '2026-01-01', endsOn: '2026-03-31', status: 'open', closedAt: null, draftStatements: 1, payeesWithoutStatement: 0, imports: 3 };
  it('explains a blocked close and offers no reopen on an open period', () => {
    const v = periodOverviewView(p, { canClose: true, canReopen: true });
    expect(v).toMatchObject({ canClose: false, canReopen: false });
    expect(v.closeBlocked).toContain('draft statement');
  });
  it('offers reopen on a closed period only to those who may', () => {
    const closed = { ...p, status: 'closed', draftStatements: 0, closedAt: 't' };
    expect(periodOverviewView(closed, { canClose: true, canReopen: true }).canReopen).toBe(true);
    expect(periodOverviewView(closed, { canClose: true, canReopen: false }).canReopen).toBe(false);
  });
});
