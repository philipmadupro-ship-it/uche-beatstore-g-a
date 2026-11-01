/**
 * What a finance row looks like to the person reading it (LABEL-61). Pure;
 * rows are built field by field, never spread. Money leaves as a DECIMAL
 * STRING of minor units, so no consumer rounds it through a double.
 *
 * Free text finance keeps (a payee's payment reference) goes only to a
 * `finance.write` reader: the column grants already hide it from every API
 * role, and this is the route-side half of that rule.
 */
import { minorFromDb } from './money';

export type PayeeRow = {
  id: string;
  party_id: string;
  artist_contact_id: string | null;
  currency: string;
  status: string;
  payment_reference?: string | null;
  created_at: string;
};

export type StatementRow = {
  id: string;
  payee_id: string;
  period_id: string;
  currency: string;
  net_minor: unknown;
  status: string;
  approved_at: string | null;
  issued_at: string | null;
  created_at: string;
};

export type StatementLineRow = {
  id: string;
  statement_id: string;
  kind: string;
  track_id: string | null;
  description: string | null;
  share_units: number | null;
  amount_minor: unknown;
  currency: string;
  position: number;
};

export const mayReadPaymentReference = (caps: ReadonlySet<string>): boolean => caps.has('finance.write');

const amount = (v: unknown): string => minorFromDb(v).toString();

export function payeeView(row: PayeeRow, opts: { reference: boolean }) {
  return {
    id: row.id,
    partyId: row.party_id,
    artistContactId: row.artist_contact_id,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    ...(opts.reference ? { paymentReference: row.payment_reference ?? null } : {}),
  };
}

export function statementLineView(l: StatementLineRow) {
  return {
    id: l.id,
    kind: l.kind,
    trackId: l.track_id,
    description: l.description,
    shareUnits: l.share_units,
    amountMinor: amount(l.amount_minor),
    currency: l.currency,
    position: l.position,
  };
}

/**
 * A statement. `approvedAt` / `status` beyond issued are the business side's:
 * an artist (own = true) is only ever sent an ISSUED statement, and sees it as
 * issued; the review state of a draft is not theirs.
 */
export function statementView(row: StatementRow, lines: StatementLineRow[], opts: { own: boolean }) {
  return {
    id: row.id,
    payeeId: row.payee_id,
    periodId: row.period_id,
    currency: row.currency,
    netMinor: amount(row.net_minor),
    status: opts.own ? 'issued' : row.status,
    issuedAt: row.issued_at,
    ...(opts.own ? {} : { approvedAt: row.approved_at, createdAt: row.created_at }),
    lines: lines.map(statementLineView),
  };
}

/** Only issued statements are an artist's to see (the database says the same). */
export const ownStatementRows = (rows: StatementRow[]): StatementRow[] => rows.filter((r) => r.status === 'issued');
