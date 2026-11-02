/**
 * The browser's side of marketing plans (LABEL-65): every call answers in words
 * a toast can show. Pure of React. The server decides everything; nothing here
 * holds a rule.
 */
import type { AssetKind, AssetStatus, BudgetStatus, PlanPhase, PlanView, Platform, PlatformStep } from './marketing-plan';

export type MarketingResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export type MarketingState =
  | { schemaReady: false }
  | { schemaReady: true; required: boolean; plan: PlanView['plan'] | null; me: PlanView['me'] & { canSetRequired?: boolean }; gate: PlanView['gate']; items?: PlanView['items']; checklist?: PlanView['checklist']; assets?: PlanView['assets']; budget?: PlanView['budget'] };

const JSON_HEADERS = { 'content-type': 'application/json' };
const base = (orgId: string, releaseId: string) => `/api/org/${orgId}/releases/${releaseId}/marketing`;

async function call<T>(url: string, init: RequestInit | undefined, failed: string, pick: (b: Record<string, unknown>) => T): Promise<MarketingResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : failed };
    return { ok: true, ...pick(body) };
  } catch {
    return { ok: false, error: failed };
  }
}

const send = (method: string, body?: unknown): RequestInit => ({ method, headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const fetchMarketing = (orgId: string, releaseId: string) =>
  call(base(orgId, releaseId), { cache: 'no-store' }, 'Could not load the marketing plan.', (b) => ({ state: b as unknown as MarketingState }));

export const addMilestone = (orgId: string, releaseId: string, body: { phase: PlanPhase; title: string; due_on: string }) =>
  call(`${base(orgId, releaseId)}/items`, send('POST', body), 'Could not add the milestone.', () => ({}));
export const patchMilestone = (orgId: string, releaseId: string, id: string, body: { phase?: PlanPhase; title?: string; due_on?: string; done?: boolean }) =>
  call(`${base(orgId, releaseId)}/items/${id}`, send('PATCH', body), 'Could not change the milestone.', () => ({}));
export const removeMilestone = (orgId: string, releaseId: string, id: string) =>
  call(`${base(orgId, releaseId)}/items/${id}`, send('DELETE'), 'Could not remove the milestone.', () => ({}));

export const setPlatformStep = (orgId: string, releaseId: string, body: { platform: Platform; step: PlatformStep; done: boolean }) =>
  call(`${base(orgId, releaseId)}/platform`, send('PUT', body), 'Could not update the checklist.', () => ({}));

export const addBudgetLine = (orgId: string, releaseId: string, body: { label: string; amount_minor: string; currency: string; status?: BudgetStatus; note?: string | null }) =>
  call(`${base(orgId, releaseId)}/budget`, send('POST', body), 'Could not add the budget line.', () => ({}));
export const patchBudgetLine = (orgId: string, releaseId: string, id: string, body: { label?: string; amount_minor?: string; currency?: string; status?: BudgetStatus; note?: string | null }) =>
  call(`${base(orgId, releaseId)}/budget/${id}`, send('PATCH', body), 'Could not change the budget line.', () => ({}));
export const removeBudgetLine = (orgId: string, releaseId: string, id: string) =>
  call(`${base(orgId, releaseId)}/budget/${id}`, send('DELETE'), 'Could not remove the budget line.', () => ({}));

export const requestAsset = (orgId: string, releaseId: string, body: { kind: AssetKind; note?: string | null }) =>
  call(`${base(orgId, releaseId)}/assets`, send('POST', body), 'Could not record the request.', (b) => ({ delivery: (typeof b.delivery === 'string' ? b.delivery : 'nobody_reachable') as 'notified' | 'nobody_reachable' | 'failed' }));
export const setAssetRequestStatus = (orgId: string, releaseId: string, id: string, status: AssetStatus) =>
  call(`${base(orgId, releaseId)}/assets/${id}`, send('PATCH', { status }), 'Could not update the request.', () => ({}));

export const setPlanRequired = (orgId: string, required: boolean) =>
  call(`/api/org/${orgId}/settings/marketing-plan`, send('PUT', { required }), 'Could not save the setting.', (b) => ({ required: b.required === true }));
