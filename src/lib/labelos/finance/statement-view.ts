/**
 * What a statement looks like to the person reading it (LABEL-63). Pure; rows are built field
 * by field, never spread. Money leaves as a DECIMAL STRING of minor units.
 *
 * A viewer who is the payee's artist (`own`) is only ever sent an ISSUED statement, and sees
 * it as issued: who generated or approved it, and the draft/approved states, are the business
 * side's. A payment reference is sent only to a `finance.write` reader.
 */
import { minorFromDb } from './money';
import { groupBySong, paymentPosition, type PaymentPosition } from './statement-calc';

export type StatementFull = {
  id: string;
  payee_id: string;
  period_id: string;
  artist_contact_id: string | null;
  currency: string;
  net_minor: unknown;
  status: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  issued_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};

export type StatementLineFull = {
  id: string;
  statement_id: string;
  kind: string;
  track_id: string | null;
  earnings_line_id: string | null;
  advance_id: string | null;
  description: string | null;
  share_units: number | null;
  amount_minor: unknown;
  currency: string;
  position: number;
};

export type PaymentFull = {
  id: string;
  statement_id: string | null;
  amount_minor: unknown;
  currency: string;
  paid_on: string;
  reference?: string | null;
  voided_at: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type PeriodRow = { id: string; label: string; starts_on: string; ends_on: string; status: string };

export const STATEMENT_STATUS_LABEL: Record<string, string> = { draft: 'Draft', approved: 'Approved', issued: 'Issued', void: 'Void' };

const amount = (v: unknown): string => minorFromDb(v).toString();

export const periodView = (p: PeriodRow) => ({ id: p.id, label: p.label, startsOn: p.starts_on, endsOn: p.ends_on, status: p.status });

export function paymentView(p: PaymentFull, opts: { reference: boolean }) {
  return {
    id: p.id,
    amountMinor: amount(p.amount_minor),
    currency: p.currency,
    paidOn: p.paid_on,
    voided: p.voided_at !== null,
    recordedAt: p.created_at,
    ...(opts.reference ? { reference: p.reference ?? null } : {}),
  };
}

export const positionOf = (net: unknown, payments: readonly PaymentFull[]): PaymentPosition =>
  paymentPosition(minorFromDb(net), payments.map((p) => ({ amountMinor: minorFromDb(p.amount_minor), voided: p.voided_at !== null })));

const positionView = (pos: PaymentPosition) => ({
  paidMinor: pos.paidMinor.toString(),
  outstandingMinor: pos.outstandingMinor.toString(),
  paymentState: pos.state,
});

type SummaryContext = { own: boolean; payeeName: string | null; period: PeriodRow | null; payments: readonly PaymentFull[]; lineCount: number | null };

/** One row of the list: no lines (a statement can hold thousands). */
export function statementSummaryView(row: StatementFull, ctx: SummaryContext) {
  const issued = row.status === 'issued';
  return {
    id: row.id,
    payeeId: row.payee_id,
    payeeName: ctx.payeeName,
    periodId: row.period_id,
    periodLabel: ctx.period?.label ?? null,
    periodStartsOn: ctx.period?.starts_on ?? null,
    periodEndsOn: ctx.period?.ends_on ?? null,
    currency: row.currency,
    netMinor: amount(row.net_minor),
    status: ctx.own ? 'issued' : row.status,
    issuedAt: row.issued_at,
    lineCount: ctx.lineCount,
    ...(issued || ctx.own ? positionView(positionOf(row.net_minor, ctx.payments)) : {}),
    ...(ctx.own ? {} : { approvedAt: row.approved_at, createdAt: row.created_at, voidReason: row.void_reason }),
  };
}

/** The detail: the summary, the songs the earnings add up to, the recoupments, the payments. */
export function statementDetailView(
  row: StatementFull,
  lines: readonly StatementLineFull[],
  ctx: Omit<SummaryContext, 'lineCount'> & { reference: boolean; actions?: Record<string, boolean> },
) {
  const grouped = groupBySong(
    lines.map((l) => ({ kind: l.kind, trackId: l.track_id, description: l.description, shareUnits: l.share_units, amountMinor: minorFromDb(l.amount_minor) })),
  );
  return {
    ...statementSummaryView(row, { ...ctx, lineCount: lines.length }),
    songs: grouped.songs.map((s) => ({ trackId: s.trackId, title: s.title, earnedMinor: s.earnedMinor.toString(), lines: s.lines, shareUnits: s.shareUnits })),
    recoupedMinor: grouped.recoupedMinor.toString(),
    recoupments: grouped.recoupments,
    payments: ctx.payments.map((p) => paymentView(p, { reference: ctx.reference })),
    ...(ctx.actions ? { actions: ctx.actions } : {}),
  };
}
