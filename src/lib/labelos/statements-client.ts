/**
 * Browser-side calls to the finance statement routes (LABEL-63). Money arrives as decimal strings
 * of minor units and is shown through `showMoney`; nothing here does arithmetic on it.
 */
export type PeriodItem = { id: string; label: string; startsOn: string; endsOn: string; status: string };
export type PaymentItem = { id: string; amountMinor: string; currency: string; paidOn: string; voided: boolean; recordedAt: string; reference?: string | null };
export type StatementItem = {
  id: string;
  payeeId: string;
  payeeName: string | null;
  periodId: string;
  periodLabel: string | null;
  currency: string;
  netMinor: string;
  status: 'draft' | 'approved' | 'issued' | 'void';
  issuedAt: string | null;
  paidMinor?: string;
  outstandingMinor?: string;
  paymentState?: 'nothing_due' | 'unpaid' | 'partial' | 'paid';
  approvedAt?: string | null;
  voidReason?: string | null;
};
export type StatementDetail = StatementItem & {
  songs: { trackId: string | null; title: string; earnedMinor: string; lines: number; shareUnits: number | null }[];
  recoupedMinor: string;
  recoupments: number;
  payments: PaymentItem[];
  actions?: { regenerate: boolean; approve: boolean; issue: boolean; void: boolean; recordPayment: boolean; voidPayment: boolean };
};
export type PayeeItem = { id: string; name: string | null; currency: string; status: string; artistContactId: string | null; partyId: string };

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

const base = (orgId: string) => `/api/org/${orgId}/finance`;

async function call<T>(url: string, init: RequestInit | undefined, fail: string): Promise<Result<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (!res.ok) return { ok: false, error: String(body.error ?? fail), code: typeof body.code === 'string' ? body.code : undefined };
    return { ok: true, ...(body as T) };
  } catch {
    return { ok: false, error: fail };
  }
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const fetchStatements = (orgId: string) =>
  call<{ schemaReady: boolean; own: boolean; canGenerate?: boolean; canApprove?: boolean; statements: StatementItem[] }>(`${base(orgId)}/statements`, undefined, 'Could not load the statements');
export const fetchStatement = (orgId: string, id: string) => call<{ own: boolean; statement: StatementDetail }>(`${base(orgId)}/statements/${id}`, undefined, 'Could not load the statement');
export const fetchPeriods = (orgId: string) => call<{ schemaReady: boolean; canWrite: boolean; periods: PeriodItem[] }>(`${base(orgId)}/periods`, undefined, 'Could not load the periods');
export const fetchPayees = (orgId: string) => call<{ payees: PayeeItem[] }>(`${base(orgId)}/payees`, undefined, 'Could not load the payees');
export const createPeriod = (orgId: string, body: { label: string; starts_on: string; ends_on: string }) => call<{ period: PeriodItem }>(`${base(orgId)}/periods`, post(body), 'Could not open the period');
export const generateStatement = (orgId: string, body: { payee_id: string; period_id: string }) => call<{ id: string; lines: number }>(`${base(orgId)}/statements`, post(body), 'Could not generate the statement');
export const statementAct = (orgId: string, id: string, act: 'approve' | 'issue' | 'void', body?: { reason?: string }) =>
  call<Record<string, never>>(`${base(orgId)}/statements/${id}/${act}`, post(body), `Could not ${act} the statement`);
export const recordPayment = (orgId: string, id: string, body: { amount_minor: string; paid_on: string; reference?: string }) =>
  call<{ id: string }>(`${base(orgId)}/statements/${id}/payments`, post(body), 'Could not record the payment');
export const voidPayment = (orgId: string, id: string, paymentId: string) =>
  call<Record<string, never>>(`${base(orgId)}/statements/${id}/payments/${paymentId}/void`, post(), 'Could not void the payment');
export const voidImport = (orgId: string, importId: string) =>
  call<{ allocations: number; recoupments: number; drafts_discarded: number }>(`${base(orgId)}/earnings/imports/${importId}/void`, post(), 'Could not void the import');

export const exportUrl = (orgId: string, id: string, format: 'pdf' | 'csv') => `${base(orgId)}/statements/${id}/export?format=${format}`;
export const payoutUrl = (orgId: string, currency?: string) => `${base(orgId)}/statements/payout${currency ? `?currency=${currency}` : ''}`;

/** "12.34" → "1234" for a currency with `exp` decimals; null when it is not an amount. Digit by digit, no float. */
export function minorFromTyped(text: string, exp: number): string | null {
  const m = /^\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > exp) return null;
  const digits = (m[1].replace(/,/g, '') + frac.padEnd(exp, '0')).replace(/^0+(?=\d)/, '');
  return /^[1-9]\d{0,17}$/.test(digits) ? digits : null;
}
