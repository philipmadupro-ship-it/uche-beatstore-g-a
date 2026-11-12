/**
 * Browser calls to `/api/org/[orgId]/contracts/[contractId]/splits` (LABEL-59).
 * Like the sibling clients, each answers a tagged result so a screen shows the
 * server's own words.
 */
import type { SplitKind } from './splits';

export type PlanLine = { partyId: string; name: string; role: string; roleLabel: string; share: string };
export type KindPlanView =
  | { kind: SplitKind; ok: true; incomplete: boolean; lines: PlanLine[] }
  | { kind: SplitKind; ok: false; reason: string; message: string };

export type DriftItemView = { partyId: string; name: string; code: 'missing' | 'differs'; contract: string; sheet: string | null };
export type DriftEntry = { kind: SplitKind; drifted: boolean; sheetId: string; items?: DriftItemView[] };

export type ContractSplitsPayload = {
  schemaReady: boolean;
  applicable: boolean;
  kinds: { key: SplitKind; label: string }[];
  plans: KindPlanView[];
  drift: DriftEntry[];
  canPrefill: boolean;
  /** Which kinds already have a draft (only sent to someone who can pre-fill). */
  drafts?: Partial<Record<SplitKind, boolean>>;
};

export type PrefillResult = { kind: SplitKind; action: 'created' | 'replaced' | 'skipped'; reason?: string; sheetId?: string };

export type ContractSplitsResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; results?: PrefillResult[] };

async function send<T extends object>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<ContractSplitsResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}`, results: Array.isArray(json.results) ? (json.results as PrefillResult[]) : undefined };
    }
    return { ok: true, ...(json as T) };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

const url = (orgId: string, contractId: string) => `/api/org/${orgId}/contracts/${contractId}/splits`;

export const fetchContractSplits = (orgId: string, contractId: string) => send<ContractSplitsPayload>(url(orgId, contractId), 'GET');

export const prefillSplitsFromContract = (orgId: string, contractId: string, body: { kind?: SplitKind; replace_draft?: boolean }) =>
  send<{ results: PrefillResult[] }>(url(orgId, contractId), 'POST', body);
