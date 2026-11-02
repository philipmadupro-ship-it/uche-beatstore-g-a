/**
 * A statement as a document (LABEL-63): the data the PDF and the CSV are both made from, and the
 * payout CSV. Pure. Amounts are plain decimals of the statement's own currency (`formatMajor`);
 * every CSV cell goes through `csvCell` (a value that starts with = + - @ is neutralised).
 * Nothing here knows an account number: there is none anywhere in the finance record.
 */
import { csvCell } from '../org-export';
import { formatMajor, money } from './money';
import { PAYMENT_STATE_LABEL, type PaymentState } from './statement-calc';
import { STATEMENT_STATUS_LABEL } from './statement-view';

export type StatementDocument = {
  statementId: string;
  orgName: string;
  payeeName: string;
  periodLabel: string;
  periodStartsOn: string | null;
  periodEndsOn: string | null;
  currency: string;
  status: string;
  issuedOn: string | null;
  generatedOn: string;
  songs: { title: string; shareUnits: number | null; earnedMinor: bigint }[];
  recoupedMinor: bigint;
  netMinor: bigint;
  paidMinor: bigint;
  outstandingMinor: bigint;
  paymentState: PaymentState;
  payments: { paidOn: string; amountMinor: bigint; voided: boolean }[];
};

/** 600000 → "60", 333333 → "33.3333": 100 % = 1 000 000 units, digit by digit. */
export function formatShareUnits(units: number | null): string {
  if (units === null) return '';
  const whole = Math.floor(units / 10000);
  const frac = String(units % 10000).padStart(4, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export const dec = (minor: bigint, currency: string): string => formatMajor(money(minor, currency));

export function statementFileName(statementId: string, status: string, ext: 'pdf' | 'csv'): string {
  return `statement-${statementId.replace(/-/g, '').slice(0, 12)}-${status}.${ext}`;
}

export const STATEMENT_CSV_COLUMNS = ['Section', 'Item', 'Share %', 'Amount'] as const;

export function statementCsv(d: StatementDocument): string {
  const rows: (string | number)[][] = [
    ['Statement', 'Payee', '', d.payeeName],
    ['Statement', 'Period', '', `${d.periodLabel}${d.periodStartsOn && d.periodEndsOn ? ` (${d.periodStartsOn} to ${d.periodEndsOn})` : ''}`],
    ['Statement', 'Currency', '', d.currency],
    ['Statement', 'Status', '', STATEMENT_STATUS_LABEL[d.status] ?? d.status],
    ...(d.issuedOn ? [['Statement', 'Issued', '', d.issuedOn]] : []),
    ...d.songs.map((s) => ['Earnings', s.title, formatShareUnits(s.shareUnits), dec(s.earnedMinor, d.currency)]),
    ['Advances', 'Recouped', '', dec(-d.recoupedMinor, d.currency)],
    ['Total', 'Net', '', dec(d.netMinor, d.currency)],
    ...d.payments.map((p) => ['Payment', `${p.paidOn}${p.voided ? ' (voided)' : ''}`, '', dec(p.voided ? BigInt(0) : p.amountMinor, d.currency)]),
    ['Total', 'Paid', '', dec(d.paidMinor, d.currency)],
    ['Total', 'Outstanding', '', dec(d.outstandingMinor, d.currency)],
  ];
  return [STATEMENT_CSV_COLUMNS.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

// ── Payout CSV ───────────────────────────────────────────────────────────

export const PAYOUT_CSV_COLUMNS = ['Statement', 'Payee', 'Period', 'Currency', 'Net', 'Paid', 'Outstanding', 'Status', 'Payment state', 'Payment reference'] as const;

export type PayoutRow = {
  statementId: string;
  payeeName: string;
  periodLabel: string;
  currency: string;
  netMinor: bigint;
  paidMinor: bigint;
  outstandingMinor: bigint;
  status: string;
  paymentState: PaymentState;
  /** Finance's own free-text note on the payee ("wire ref on file"). Never an account number (the database refuses one). */
  paymentReference: string | null;
};

/** One row per statement still owed money. Payees in different currencies are different rows, never summed. */
export function payoutCsv(rows: readonly PayoutRow[]): string {
  const lines = rows.map((r) =>
    [
      r.statementId,
      r.payeeName,
      r.periodLabel,
      r.currency,
      dec(r.netMinor, r.currency),
      dec(r.paidMinor, r.currency),
      dec(r.outstandingMinor, r.currency),
      STATEMENT_STATUS_LABEL[r.status] ?? r.status,
      PAYMENT_STATE_LABEL[r.paymentState],
      r.paymentReference ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [PAYOUT_CSV_COLUMNS.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}
