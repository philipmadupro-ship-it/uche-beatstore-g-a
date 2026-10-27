import { describe, expect, it } from 'vitest';
import { WITHDRAWAL_NOTE_MAX, cancelRefusal, planWithdrawal } from './release-withdrawal';

const NOW = new Date('2026-10-27T10:00:00Z');
const base = { state: 'delivered', imported_released: false, store_listed: false, release_date: '2026-10-20', store_listed_at: null as string | null };

describe('planWithdrawal (LABEL-56)', () => {
  it('only a delivered release is withdrawn', () => {
    expect(planWithdrawal(base, { note: null, deletePreviews: false }, NOW)).toMatchObject({ ok: true, unlist: false });
    for (const state of ['draft', 'cancelled']) {
      const plan = planWithdrawal({ ...base, state }, { note: null, deletePreviews: false }, NOW);
      expect(plan).toMatchObject({ ok: false, status: 409, field: 'state' });
    }
  });

  it('a draft is told to cancel, a cancelled one that it is closed, a withdrawn one that it already is', () => {
    const msg = (state: string) => {
      const p = planWithdrawal({ ...base, state }, { note: null, deletePreviews: false }, NOW);
      return p.ok ? '' : p.error;
    };
    expect(msg('draft')).toMatch(/never delivered/);
    expect(msg('draft')).toMatch(/cancel/i);
    expect(msg('withdrawn')).toMatch(/already withdrawn/);
    expect(msg('cancelled')).toMatch(/cancelled/);
  });

  it('a listed release is unlisted by the same step, with the LABEL-42 preview rules', () => {
    // Released (date has come) and listed: the previews were public, so they are kept unless asked… and never offered for deletion.
    const out = planWithdrawal({ ...base, store_listed: true, store_listed_at: '2026-10-21T00:00:00Z' }, { note: null, deletePreviews: true }, NOW);
    expect(out).toMatchObject({ ok: true, unlist: true, askToDeletePreviews: false, deletePreviews: false });
    // Never publicly out (listed before its date came): deletion may be asked for and honoured.
    const early = planWithdrawal(
      { ...base, release_date: '2026-11-30', store_listed: true, store_listed_at: '2026-10-21T00:00:00Z' },
      { note: null, deletePreviews: true },
      NOW,
    );
    expect(early).toMatchObject({ ok: true, unlist: true, askToDeletePreviews: true, deletePreviews: true });
  });

  it('keeps a trimmed note, drops a blank one, refuses an over-long one', () => {
    expect(planWithdrawal(base, { note: '  wrong master  ', deletePreviews: false }, NOW)).toMatchObject({ ok: true, note: 'wrong master' });
    expect(planWithdrawal(base, { note: '   ', deletePreviews: false }, NOW)).toMatchObject({ ok: true, note: null });
    expect(planWithdrawal(base, { note: 'x'.repeat(WITHDRAWAL_NOTE_MAX + 1), deletePreviews: false }, NOW)).toMatchObject({ ok: false, status: 400, field: 'note' });
  });
});

describe('cancelRefusal (what DELETE / PATCH say about a release that went out)', () => {
  it('says plainly that only a draft is cancelled and a delivered release is withdrawn', () => {
    const msg = cancelRefusal({ state: 'delivered', imported_released: false });
    expect(msg).toMatch(/only a draft/i);
    expect(msg).toMatch(/withdraw it/i);
    expect(cancelRefusal({ state: 'delivered', imported_released: false }, 'delete')).toMatch(/cancelled or deleted/);
    expect(cancelRefusal({ state: 'withdrawn', imported_released: false })).toMatch(/withdrawn/);
  });
  it('an imported release is not deleted, but it can be cancelled', () => {
    expect(cancelRefusal({ state: 'draft', imported_released: true }, 'delete')).toMatch(/already out/);
    expect(cancelRefusal({ state: 'draft', imported_released: true }, 'cancel')).toBeNull();
  });
  it('a plain draft or cancelled release has nothing to say', () => {
    expect(cancelRefusal({ state: 'draft', imported_released: false }, 'delete')).toBeNull();
    expect(cancelRefusal({ state: 'cancelled', imported_released: false }, 'delete')).toBeNull();
  });
});
