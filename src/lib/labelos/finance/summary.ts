/**
 * The finance summary the executive dashboard (LABEL-67) calls. Pure and read-only: it takes the
 * positions and the per-release rows this task already computes and folds them into one object
 * per currency. No I/O, no UI, no chart — LABEL-67 decides how to draw it.
 *
 * The caller passes what the VIEWER may see (positions already limited to their artist scope,
 * release rows already limited to theirs); this function never widens that.
 *
 *   advances    face value, recouped and still-to-recover (recoupable) and non-recoupable
 *   earnings    gross received on attributed releases, royalties payable, marketing spent, margin
 *   payouts     issued to payees, paid, and owed now
 *   periods     how many are open / closed (whole-org viewers only; pass undefined otherwise)
 */
import { positionTotals, type PayeePosition } from './position';
import type { ReleaseIncomeRow } from './release-income';

const ZERO = BigInt(0);

export type FinanceSummaryCurrency = {
  currency: string;
  advances: { recoupable: bigint; nonRecoupable: bigint; recouped: bigint; unrecouped: bigint };
  earnings: { gross: bigint; royalties: bigint; spent: bigint; committed: bigint; margin: bigint };
  payouts: { issued: bigint; paid: bigint; owed: bigint; notOnStatement: bigint };
};
export type FinanceSummary = { currencies: FinanceSummaryCurrency[]; periods: { open: number; closed: number } | null };

export function financeSummary(input: {
  positions: readonly PayeePosition[];
  releaseRows: readonly ReleaseIncomeRow[];
  periods?: readonly { status: string }[];
}): FinanceSummary {
  const map = new Map<string, FinanceSummaryCurrency>();
  const cur = (currency: string): FinanceSummaryCurrency => {
    let c = map.get(currency);
    if (!c) {
      c = {
        currency,
        advances: { recoupable: ZERO, nonRecoupable: ZERO, recouped: ZERO, unrecouped: ZERO },
        earnings: { gross: ZERO, royalties: ZERO, spent: ZERO, committed: ZERO, margin: ZERO },
        payouts: { issued: ZERO, paid: ZERO, owed: ZERO, notOnStatement: ZERO },
      };
      map.set(currency, c);
    }
    return c;
  };
  for (const t of positionTotals(input.positions)) {
    const c = cur(t.currency);
    c.advances = { recoupable: t.recoupableAdvanced, nonRecoupable: t.nonRecoupableAdvanced, recouped: t.recouped, unrecouped: t.unrecouped };
    c.payouts = { issued: t.issued, paid: t.paid, owed: t.owed, notOnStatement: t.notOnStatement };
  }
  for (const r of input.releaseRows) {
    const e = cur(r.currency).earnings;
    e.gross += r.gross;
    e.royalties += r.royalties;
    e.spent += r.spent;
    e.committed += r.committed;
    e.margin += r.margin;
  }
  const periods = input.periods
    ? { open: input.periods.filter((p) => p.status === 'open').length, closed: input.periods.filter((p) => p.status === 'closed').length }
    : null;
  return { currencies: [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency)), periods };
}

/** JSON-safe: every amount a decimal string of minor units. */
export function financeSummaryView(s: FinanceSummary) {
  const str = <T extends Record<string, bigint>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toString()]));
  return {
    currencies: s.currencies.map((c) => ({ currency: c.currency, advances: str(c.advances), earnings: str(c.earnings), payouts: str(c.payouts) })),
    periods: s.periods,
  };
}
