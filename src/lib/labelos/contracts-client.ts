/**
 * Browser calls to the contract routes (LABEL-57). Each answers a tagged
 * result so a screen shows the server's own words.
 */
import type { ContractView } from './contracts/context';
import type { Rendered } from './contracts/render';
import type { PartySlot, TemplateClause } from './contracts/templates';
import type { TemplateTypeId } from './contracts/types';

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

async function send<T extends object>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: unknown };
    if (!res.ok) return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}` };
    return { ok: true, ...json };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

export type ContractsPayload = { schemaReady: boolean; canWrite: boolean; contracts: ContractView[] };
export const loadContracts = (orgId: string) => send<ContractsPayload>(`/api/org/${orgId}/contracts`, 'GET');

export type ContractDetail = { contract: ContractView; document: Rendered; canWrite: boolean };
export const loadContract = (orgId: string, id: string) => send<ContractDetail>(`/api/org/${orgId}/contracts/${id}`, 'GET');

export const createContract = (orgId: string, body: Record<string, unknown>) => send<{ id: string }>(`/api/org/${orgId}/contracts`, 'POST', body);
export const updateContract = (orgId: string, id: string, body: Record<string, unknown>) => send<{ ok: true }>(`/api/org/${orgId}/contracts/${id}`, 'PATCH', body);
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
