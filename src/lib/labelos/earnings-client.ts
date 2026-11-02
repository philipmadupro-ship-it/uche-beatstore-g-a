/**
 * Browser-side calls to the earnings routes (LABEL-62). Money arrives as
 * decimal strings of minor units and is shown through `formatMajor`; nothing
 * here does arithmetic on it.
 */
import { formatMajor, isCurrency, money } from './finance/money';

export type EarningsImport = { id: string; period_id?: string | null; status?: string; source: string; file_name: string | null; currency: string; row_count: number; total_minor: string; created_at: string };
export type ReviewLine = {
  id: string; import_id: string; line_no: number; isrc: string | null; upc: string | null; title: string | null; store: string | null;
  gross_minor: string; currency: string; matched: boolean; reason: string | null; reason_label: string | null;
};

export type ImportsResult = { ok: true; schemaReady: boolean; canWrite: boolean; scoped: boolean; imports: EarningsImport[] } | { ok: false; error: string };
export type QueueResult = { ok: true; schemaReady: boolean; canWrite: boolean; lines: ReviewLine[] } | { ok: false; error: string };
export type ImportSummary = { created: boolean; import_id: string; lines?: number; allocated_lines?: number; waiting_lines?: number; rounded_lines?: number; message?: string };
export type ImportAttempt =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string; issues?: { lineNo: number; message: string }[]; more?: number };

const base = (orgId: string) => `/api/org/${orgId}/finance/earnings`;

async function read<T>(res: Response, fail: string): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) return { ok: false, error: (body as { error?: string } | null)?.error ?? fail };
  return { ok: true, body: body as T };
}

export async function fetchImports(orgId: string): Promise<ImportsResult> {
  try {
    const r = await read<Omit<Extract<ImportsResult, { ok: true }>, 'ok'>>(await fetch(`${base(orgId)}/imports`, { cache: 'no-store' }), 'Could not load the imports');
    return r.ok ? { ok: true, ...r.body } : r;
  } catch {
    return { ok: false, error: 'Could not load the imports' };
  }
}

export async function fetchQueue(orgId: string): Promise<QueueResult> {
  try {
    const r = await read<Omit<Extract<QueueResult, { ok: true }>, 'ok'>>(await fetch(`${base(orgId)}/unmatched`, { cache: 'no-store' }), 'Could not load the queue');
    return r.ok ? { ok: true, ...r.body } : r;
  } catch {
    return { ok: false, error: 'Could not load the queue' };
  }
}

export async function uploadEarnings(orgId: string, form: FormData): Promise<ImportAttempt> {
  try {
    const res = await fetch(`${base(orgId)}/imports`, { method: 'POST', body: form });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (!res.ok) return { ok: false, error: String(body.error ?? 'The import failed'), issues: body.issues as never, more: body.more as number | undefined };
    return { ok: true, summary: body as unknown as ImportSummary };
  } catch {
    return { ok: false, error: 'The import failed' };
  }
}

export async function recalculate(orgId: string, importId: string): Promise<{ ok: true; resolved: number; stillWaiting: number } | { ok: false; error: string }> {
  try {
    const r = await read<{ resolved: number; still_waiting: number }>(await fetch(`${base(orgId)}/imports/${importId}/recalculate`, { method: 'POST' }), 'Could not re-run the earnings');
    return r.ok ? { ok: true, resolved: r.body.resolved, stillWaiting: r.body.still_waiting } : r;
  } catch {
    return { ok: false, error: 'Could not re-run the earnings' };
  }
}

/** "1,234.50 USD" from a minor-unit string; the raw text if the currency is unknown. */
export function showMoney(minor: string, currency: string): string {
  if (!isCurrency(currency)) return `${minor} ${currency}`;
  const text = formatMajor(money(BigInt(minor), currency));
  const [whole, frac] = text.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${text.startsWith('-') ? '-' : ''}${grouped}${frac ? '.' + frac : ''} ${currency}`;
}
