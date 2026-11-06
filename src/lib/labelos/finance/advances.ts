/**
 * The advances ledger (LABEL-64). Pure: facts in, a view out. No float anywhere —
 * every amount is a `bigint` of minor units in the payee's one currency.
 *
 * An advance is money the label paid a payee up front. Two kinds:
 *  - `recoupable`: drawn down by LABEL-62's recoupment out of the payee's later
 *    earnings (oldest advance first). `remaining = amount − Σ recouped`.
 *  - `non_recoupable`: never drawn down, never part of a statement. It is shown on
 *    the ledger and counts in the payee's position as "advanced, not recoverable".
 *
 * An advance is FIXED (kind / amount / date) once anything references it — a
 * recoupment (180) or a statement line (181). That is the database's rule
 * (`advances_edit_frozen`); `advanceState` repeats it from the same facts so the
 * screen can disable the control instead of offering one that will be refused.
 * A void advance is final.
 */
import { minorFromDb } from './money';

export const ADVANCE_KINDS = ['recoupable', 'non_recoupable'] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];
export const ADVANCE_KIND_LABEL: Record<AdvanceKind, string> = { recoupable: 'Recoupable', non_recoupable: 'Non-recoupable' };

export type AdvanceRow = {
  id: string;
  payee_id: string;
  kind: string;
  amount_minor: unknown;
  currency: string;
  paid_on: string | null;
  note: string | null;
  voided_at: string | null;
  created_at: string;
};

/** What the ledger knows about one advance besides its own row. */
export type AdvanceFacts = {
  /** Σ earnings_recoupments.amount_minor against this advance (non-void imports only: a void import deletes its rows). */
  recouped: bigint;
  /** True when ANY recoupment or statement line names the advance. */
  referenced: boolean;
};

export type AdvanceStatus = 'void' | 'open' | 'partly_recouped' | 'recouped' | 'non_recoupable';

export type AdvanceState = {
  status: AdvanceStatus;
  amount: bigint;
  recouped: bigint;
  /** Still to be recovered from later earnings. Zero for a non-recoupable or void advance. */
  remaining: bigint;
  /** kind / amount / date may still change. */
  canEditTerms: boolean;
  /** The note can change on any live advance. */
  canEditNote: boolean;
  canVoid: boolean;
};

export const isAdvanceKind = (k: string): k is AdvanceKind => (ADVANCE_KINDS as readonly string[]).includes(k);

const ZERO = BigInt(0);

export function advanceState(row: Pick<AdvanceRow, 'kind' | 'amount_minor' | 'voided_at'>, facts: AdvanceFacts): AdvanceState {
  const amount = minorFromDb(row.amount_minor);
  const live = row.voided_at === null;
  const recoupable = row.kind === 'recoupable';
  const recouped = recoupable ? facts.recouped : ZERO;
  let remaining = live && recoupable ? amount - recouped : ZERO;
  if (remaining < ZERO) remaining = ZERO;
  let status: AdvanceStatus;
  if (!live) status = 'void';
  else if (!recoupable) status = 'non_recoupable';
  else if (remaining === ZERO) status = 'recouped';
  else if (recouped > ZERO) status = 'partly_recouped';
  else status = 'open';
  return {
    status,
    amount,
    recouped,
    remaining,
    canEditTerms: live && !facts.referenced,
    canEditNote: live,
    canVoid: live && !facts.referenced,
  };
}

export const ADVANCE_STATUS_LABEL: Record<AdvanceStatus, string> = {
  void: 'Void',
  open: 'Open',
  partly_recouped: 'Partly recouped',
  recouped: 'Recouped',
  non_recoupable: 'Not recoupable',
};

export type LedgerTotals = {
  currency: string;
  /** Live recoupable advances, face value. */
  recoupable: bigint;
  /** Live non-recoupable advances, face value. */
  nonRecoupable: bigint;
  /** Σ recouped against live recoupable advances. */
  recouped: bigint;
  /** Σ remaining on live recoupable advances: what the payee still owes the label. */
  unrecouped: bigint;
};

/**
 * Totals per currency, never across. `states` are the already-computed states of LIVE and VOID
 * advances alike; a void one counts for nothing.
 */
export function ledgerTotals(items: readonly { currency: string; kind: string; state: AdvanceState }[]): LedgerTotals[] {
  const by = new Map<string, LedgerTotals>();
  for (const it of items) {
    if (it.state.status === 'void') continue;
    let t = by.get(it.currency);
    if (!t) {
      t = { currency: it.currency, recoupable: ZERO, nonRecoupable: ZERO, recouped: ZERO, unrecouped: ZERO };
      by.set(it.currency, t);
    }
    if (it.kind === 'recoupable') {
      t.recoupable += it.state.amount;
      t.recouped += it.state.recouped;
      t.unrecouped += it.state.remaining;
    } else {
      t.nonRecoupable += it.state.amount;
    }
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * The JSON of one advance. Built field by field. Amounts leave as decimal strings of minor units.
 * `reference` is false for a viewer who does not hold finance.write: they read the ledger, not who typed it.
 */
export function advanceView(row: AdvanceRow, facts: AdvanceFacts) {
  const s = advanceState(row, facts);
  return {
    id: row.id,
    payeeId: row.payee_id,
    kind: row.kind,
    currency: row.currency.trim(),
    amountMinor: s.amount.toString(),
    recoupedMinor: s.recouped.toString(),
    remainingMinor: s.remaining.toString(),
    status: s.status,
    paidOn: row.paid_on,
    note: row.note,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    canEditTerms: s.canEditTerms,
    canEditNote: s.canEditNote,
    canVoid: s.canVoid,
  };
}
export type AdvanceView = ReturnType<typeof advanceView>;
