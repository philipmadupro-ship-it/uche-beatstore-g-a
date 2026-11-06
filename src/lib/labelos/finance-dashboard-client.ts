/**
 * Browser-side calls to the advances / dashboard / period-close routes (LABEL-64). Money arrives
 * as decimal strings of minor units and is shown through `showMoney`; nothing here does arithmetic
 * on it (the server sums, the screen only draws).
 */
import { currencyExponent, isCurrency } from './finance/money';
import { minorFromTyped } from './statements-client';

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

export type AdvanceItem = {
  id: string;
  payeeId: string;
  kind: 'recoupable' | 'non_recoupable';
  currency: string;
  amountMinor: string;
  recoupedMinor: string;
  remainingMinor: string;
  status: 'void' | 'open' | 'partly_recouped' | 'recouped' | 'non_recoupable';
  paidOn: string | null;
  note: string | null;
  voidedAt: string | null;
  createdAt: string;
  canEditTerms: boolean;
  canEditNote: boolean;
  canVoid: boolean;
};
export type AdvancePayee = { id: string; name: string | null; currency: string; active: boolean };
export type LedgerTotal = { currency: string; recoupableMinor: string; nonRecoupableMinor: string; recoupedMinor: string; unrecoupedMinor: string };

export type PositionItem = {
  payeeId: string;
  name: string | null;
  currency: string;
  active: boolean;
  recoupableAdvancedMinor: string;
  nonRecoupableAdvancedMinor: string;
  unrecoupedMinor: string;
  earnedMinor: string;
  recoupedMinor: string;
  netEarnedMinor: string;
  onStatementsMinor: string;
  notOnStatementMinor: string;
  issuedMinor: string;
  paidMinor: string;
  owedMinor: string;
};
export type ReleaseItem = {
  releaseId: string;
  title: string;
  state: string;
  releaseDate: string | null;
  currency: string;
  grossMinor: string;
  royaltiesMinor: string;
  /** Withheld from a reader limited to some artists. */
  spentMinor?: string;
  committedMinor?: string;
  marginMinor?: string;
  lines: number;
};
export type PeriodOverviewItem = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: string;
  closedAt: string | null;
  imports: number;
  draftStatements: number;
  linesWaiting: number;
  payeesWithoutStatement: number;
  canClose: boolean;
  closeBlocked: string | null;
  closeWarnings: string[];
  canReopen: boolean;
};
export type SummaryCurrency = {
  currency: string;
  advances: { recoupable: string; nonRecoupable: string; recouped: string; unrecouped: string };
  earnings: { gross: string; royalties: string; spent?: string; committed?: string; margin?: string };
  payouts: { issued: string; paid: string; owed: string; notOnStatement: string };
};
export type Dashboard = {
  schemaReady: boolean;
  scoped: boolean;
  positions: PositionItem[];
  releases: ReleaseItem[];
  unattributed: { currency: string; kind: 'ambiguous' | 'unmatched'; grossMinor: string; lines: number }[];
  summary: { currencies: SummaryCurrency[]; periods: { open: number; closed: number } | null };
  periods: PeriodOverviewItem[] | null;
};

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
const send = (method: 'POST' | 'PATCH', body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const fetchAdvances = (orgId: string) =>
  call<{ schemaReady: boolean; canWrite: boolean; advances: AdvanceItem[]; totals: LedgerTotal[]; payees: AdvancePayee[] }>(`${base(orgId)}/advances`, undefined, 'Could not load the advances');
export const createAdvance = (orgId: string, body: { payee_id: string; kind: string; amount_minor: string; paid_on?: string; note?: string }) =>
  call<{ id: string }>(`${base(orgId)}/advances`, send('POST', body), 'Could not record the advance');
export const patchAdvance = (orgId: string, id: string, body: { kind?: string; amount_minor?: string; paid_on?: string | null; note?: string | null }) =>
  call<{ updated: boolean }>(`${base(orgId)}/advances/${id}`, send('PATCH', body), 'Could not change the advance');
export const voidAdvance = (orgId: string, id: string) => call<{ voided: boolean }>(`${base(orgId)}/advances/${id}/void`, send('POST'), 'Could not void the advance');
export const fetchDashboard = (orgId: string) => call<Dashboard>(`${base(orgId)}/dashboard`, undefined, 'Could not load the finance overview');
export const closePeriod = (orgId: string, id: string) => call<{ closed: boolean }>(`${base(orgId)}/periods/${id}/close`, send('POST'), 'Could not close the period');
export const reopenPeriod = (orgId: string, id: string) => call<{ reopened: boolean }>(`${base(orgId)}/periods/${id}/reopen`, send('POST'), 'Could not reopen the period');

/** What a person typed ("1,200.50") as minor units for the payee's currency; null when it is not an amount above zero. */
export function typedAmountMinor(text: string, currency: string): string | null {
  return isCurrency(currency) ? minorFromTyped(text, currencyExponent(currency)) : null;
}
