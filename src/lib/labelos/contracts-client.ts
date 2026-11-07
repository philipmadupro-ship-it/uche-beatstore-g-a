/**
 * Browser calls to the contract routes (LABEL-57). Each answers a tagged
 * result so a screen shows the server's own words.
 */
import type { ContractView } from './contracts/context';
import type { HistoryEntry } from './contracts/history';
import type { Rendered } from './contracts/render';
import type { PartySlot, TemplateClause } from './contracts/templates';
import type { TemplateTypeId } from './contracts/types';

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; missing?: string[] };

async function send<T extends object>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: unknown; missing?: unknown };
    if (!res.ok) {
      const missing = Array.isArray(json.missing) ? json.missing.filter((k): k is string => typeof k === 'string') : undefined;
      return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}`, ...(missing ? { missing } : {}) };
    }
    return { ok: true, ...json };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

export type ContractsPayload = { schemaReady: boolean; canWrite: boolean; contracts: ContractView[] };
export const loadContracts = (orgId: string) => send<ContractsPayload>(`/api/org/${orgId}/contracts`, 'GET');

export type ClauseMarksView = { marks: Record<string, 'same' | 'edited' | 'added'>; removed: TemplateClause[]; changed: number };
export type ContractDetail = {
  contract: ContractView;
  document: Rendered;
  canWrite: boolean;
  /** Contracts staff only (`contracts.read`): the wording, how it differs from its template, the history and the stored PDF. */
  clauses?: TemplateClause[];
  clause_marks?: ClauseMarksView;
  history?: HistoryEntry[];
  history_actors?: Record<string, string>;
  copy?: { asset_id: string; project_id: string } | null;
  can_store?: boolean;
  can_manage?: boolean;
};
export const loadContract = (orgId: string, id: string) => send<ContractDetail>(`/api/org/${orgId}/contracts/${id}`, 'GET');

export const createContract = (orgId: string, body: Record<string, unknown>) => send<{ id: string }>(`/api/org/${orgId}/contracts`, 'POST', body);
export const updateContract = (orgId: string, id: string, body: Record<string, unknown>) => send<{ ok: true; version?: number }>(`/api/org/${orgId}/contracts/${id}`, 'PATCH', body);
export const voidContract = (orgId: string, id: string, reason?: string) =>
  send<{ ok: true }>(`/api/org/${orgId}/contracts/${id}`, 'PATCH', { status: 'void', ...(reason ? { void_reason: reason } : {}) });

export type PlatformTemplate = {
  type: TemplateTypeId;
  name: string;
  version: number;
  source: string;
  summary: string;
  slots: PartySlot[];
  clauses: TemplateClause[];
  suggested_fields: string[];
  field_keys: string[];
};
export type OrgTemplate = { id: string; type: TemplateTypeId; version: number; name: string; clauses: TemplateClause[]; based_on: string | null; created_at: string; field_keys: string[] };
export type TemplatesPayload = { schemaReady: boolean; canWrite: boolean; platform: PlatformTemplate[]; org: OrgTemplate[] };
export const loadTemplates = (orgId: string) => send<TemplatesPayload>(`/api/org/${orgId}/contract-templates`, 'GET');
export const saveTemplate = (orgId: string, type: TemplateTypeId, body: { name: string; clauses: { id?: string; heading: string; body: string }[] }) =>
  send<{ unchanged?: boolean; version?: number | null; template?: OrgTemplate }>(`/api/org/${orgId}/contract-templates/${type}`, 'PUT', body);

// LABEL-58
export type ClauseDraft = { id?: string; heading: string; body: string };
export const previewContract = (orgId: string, id: string, body: Record<string, unknown>) =>
  send<{ document: Rendered }>(`/api/org/${orgId}/contracts/${id}/preview`, 'POST', body);
export const sendContract = (orgId: string, id: string, version: number) =>
  send<{ status: 'sent'; version: number; copy: { stored: boolean; asset_id?: string; project_id?: string } }>(`/api/org/${orgId}/contracts/${id}/send`, 'POST', { version });
export const fileContractCopy = (orgId: string, id: string) => send<{ asset_id: string; project_id: string; reused: boolean }>(`/api/org/${orgId}/contracts/${id}/document`, 'POST');
export type Suggestions = {
  fields: { key: 'master_share' | 'publishing_share'; value: string; source: string; partyId: string }[];
  artist_parties: { id: string; name: string }[];
};
export const loadSuggestions = (orgId: string, id: string) => send<Suggestions>(`/api/org/${orgId}/contracts/${id}/suggestions`, 'GET');
export const contractPdfUrl = (orgId: string, id: string) => `/api/org/${orgId}/contracts/${id}/document`;
export const storedCopyUrl = (orgId: string, copy: { asset_id: string; project_id: string }) => `/api/org/${orgId}/projects/${copy.project_id}/assets/${copy.asset_id}/download`;
