/**
 * The contract store's rules (LABEL-60): when a term ends, how close that is,
 * and the store's search and filters. Pure and free of Node imports, so the
 * Contracts page (a client component) uses the very functions the calendar
 * feed and the tests do.
 */
import { CONTRACT_STATUS_LABELS, TEMPLATE_TYPE_LABELS, type ContractStatus, type TemplateTypeId } from './contracts/types';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day a term ends (the last day it runs): effective date plus term months, minus one day. */
export function contractEnd(effectiveDate: string | null, termMonths: number | null): string | null {
  const hit = effectiveDate ? DAY.exec(effectiveDate) : null;
  if (!hit || !termMonths || !Number.isInteger(termMonths) || termMonths < 1) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const start = new Date(Date.UTC(y, m - 1, d));
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== m - 1 || start.getUTCDate() !== d) return null;
  const total = m - 1 + termMonths;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  // Clamp 31 Jan + 1 month to the last day of February.
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(ty, tm, Math.min(d, last) - 1));
  return end.toISOString().slice(0, 10);
}

export type ExpiryState = { kind: 'none' } | { kind: 'ok'; days: number } | { kind: 'soon'; days: number } | { kind: 'expired'; days: number };

export const EXPIRY_SOON_DAYS = 60;

/** Void and draft contracts do not expire; a sent or signed one does when its term runs out. */
export function expiryState(c: { status: ContractStatus; effective_date: string | null; term_months: number | null }, today: string): ExpiryState {
  if (c.status !== 'sent' && c.status !== 'signed') return { kind: 'none' };
  const end = contractEnd(c.effective_date, c.term_months);
  if (!end || !DAY.test(today)) return { kind: 'none' };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { kind: 'expired', days: -days };
  return days <= EXPIRY_SOON_DAYS ? { kind: 'soon', days } : { kind: 'ok', days };
}

export type StoreRow = {
  id: string;
  type: TemplateTypeId;
  title: string;
  status: ContractStatus;
  effective_date: string | null;
  term_months: number | null;
  parties: readonly { name: string }[];
};

export type StoreQuery = { q?: string; status?: ContractStatus | 'all'; type?: TemplateTypeId | 'all'; expiring?: boolean };

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The contract store's filter. Every word of `q` must appear in the title, the
 * type's name, a party's name or the status word (so "nova recording signed"
 * finds Nova's signed recording agreement). `expiring` keeps the contracts
 * whose term ends within the soon window or already has.
 */
export function filterStore<T extends StoreRow>(rows: readonly T[], query: StoreQuery, today: string): T[] {
  const words = fold(query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8);
  return rows.filter((r) => {
    if (query.status && query.status !== 'all' && r.status !== query.status) return false;
    if (query.type && query.type !== 'all' && r.type !== query.type) return false;
    if (query.expiring) {
      const e = expiryState(r, today);
      if (e.kind !== 'soon' && e.kind !== 'expired') return false;
    }
    if (words.length === 0) return true;
    const hay = fold([r.title, TEMPLATE_TYPE_LABELS[r.type], CONTRACT_STATUS_LABELS[r.status], ...r.parties.map((p) => p.name)].join(' \n '));
    return words.every((w) => hay.includes(w));
  });
}
