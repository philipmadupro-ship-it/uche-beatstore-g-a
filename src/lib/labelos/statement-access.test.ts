import { describe, expect, it } from 'vitest';
import { mayActOnPayee, mayReadStatement } from './statement-access';

const row = (over = {}) => ({ artist_contact_id: 'a1', payee_id: 'p1', status: 'issued', ...over });

describe('mayReadStatement', () => {
  it('staff: the whole org, or only their artists', () => {
    expect(mayReadStatement({ kind: 'staff', artists: null }, row({ status: 'draft' }))).toBe(true);
    expect(mayReadStatement({ kind: 'staff', artists: new Set(['a1']) }, row({ status: 'draft' }))).toBe(true);
    expect(mayReadStatement({ kind: 'staff', artists: new Set(['a2']) }, row())).toBe(false);
    // a payee with no roster artist is whole-org only
    expect(mayReadStatement({ kind: 'staff', artists: new Set(['a1']) }, row({ artist_contact_id: null }))).toBe(false);
    expect(mayReadStatement({ kind: 'staff', artists: null }, row({ artist_contact_id: null }))).toBe(true);
  });

  it('the payee’s own artist: their ISSUED statements only', () => {
    const own = { kind: 'own' as const, payeeIds: new Set(['p1']) };
    expect(mayReadStatement(own, row())).toBe(true);
    for (const status of ['draft', 'approved', 'void']) expect(mayReadStatement(own, row({ status }))).toBe(false);
    expect(mayReadStatement(own, row({ payee_id: 'p2' }))).toBe(false);
  });
});

describe('mayActOnPayee', () => {
  it('follows the artist scope', () => {
    expect(mayActOnPayee(null, { artist_contact_id: null })).toBe(true);
    expect(mayActOnPayee(new Set(['a1']), { artist_contact_id: 'a1' })).toBe(true);
    expect(mayActOnPayee(new Set(['a1']), { artist_contact_id: 'a2' })).toBe(false);
  });
});
