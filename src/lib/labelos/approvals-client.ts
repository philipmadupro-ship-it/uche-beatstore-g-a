/**
 * Browser calls to the approval routes (LABEL-30). Each answers a tagged
 * result instead of throwing, so a screen shows the server's own words
 * ("You cannot approve a request you made yourself") rather than a generic
 * failure. The shapes are the route's `GateState` (lib/labelos/approvals-route),
 * restated here so a client component imports no server code.
 */
import type { ApprovalView } from './approvals-store';

export type GateStateView = {
  gate: string;
  label: string;
  status: 'none' | 'requested' | 'approved' | 'changes_requested';
  stale: boolean;
  changed: string[];
  chip: { label: string; tone: 'neutral' | 'waiting' | 'good' | 'warn' };
  decision: ApprovalView | null;
  pending: ApprovalView | null;
  canDecide: boolean;
  selfApprovalBlocked: boolean;
  canRequest: boolean;
  /** Sent back as `seen` when approving, so the approval records what was on screen. Null for a viewer who cannot decide. */
  snapshotKey?: string | null;
  /** `tasks.write`: "Send to legal" may also create a task for the person asked. */
  canTask?: boolean;
  approvers: { userId: string; name: string }[];
};

export type ApprovalsPayload = { schemaReady: boolean; gates: GateStateView[] };
export type ApprovalSubject = { kind: 'song' | 'release'; id: string };
export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

async function send<T extends object>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}` };
    return { ok: true, ...(json as T) };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

export const fetchApprovals = (orgId: string, subject: ApprovalSubject) =>
  send<ApprovalsPayload>(`/api/org/${orgId}/approvals?${subject.kind}=${subject.id}`, 'GET');

export const requestApproval = (orgId: string, input: { subject: ApprovalSubject; gate: string; approverId: string; note?: string; withTask?: boolean }) =>
  send<ApprovalsPayload>(`/api/org/${orgId}/approvals`, 'POST', {
    subject: input.subject,
    gate: input.gate,
    approver_id: input.approverId,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.withTask ? { with_task: true } : {}),
  });

export const decideApproval = (orgId: string, input: { subject: ApprovalSubject; gate: string; decision: 'approved' | 'changes_requested'; note?: string; seen?: string | null }) =>
  send<ApprovalsPayload>(`/api/org/${orgId}/approvals/decide`, 'POST', {
    subject: input.subject,
    gate: input.gate,
    decision: input.decision,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.seen ? { seen: input.seen } : {}),
  });
