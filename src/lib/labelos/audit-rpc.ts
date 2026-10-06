/**
 * Audit-class mutations that commit WITH their event (LABEL-19, 08 §B3,
 * 10-technical-architecture). Migration 146 holds one SECURITY DEFINER
 * function per verb family — the mutation and the `activity_events` insert
 * in one transaction, EXECUTE for `service_role` only. If the audit insert
 * fails the mutation is not there afterwards; no compensating write exists
 * to fail in its turn.
 *
 *   memberUpdate        member.role_changed | capabilities_changed | scope_changed
 *   memberRemove        member.removed
 *   memberArtistsSet    member.artists_changed
 *   invitationCreate    invitation.created
 *   invitationRevoke    invitation.revoked
 *   projectInvitationCreate  invitation.created for ONE project (148, LABEL-21)
 *   projectMemberUpdate      project.member_changed
 *   projectMemberRemove      project.member_removed
 *
 * Accepting an invitation (`member.joined`) is 138's
 * `labelos_accept_invitation` (lib/labelos/invitations.ts), which already
 * did both writes in one transaction. Split transitions, approvals and
 * delivery have no mutating route yet; each lands its function with its route.
 *
 * `auditRpc` is the one caller. The route does the authorisation and the
 * planning (requireOrgCapability, planMemberChange); the function does only
 * what the database can know for itself, and the route reads its answer:
 * `{ error: 'not_found' | 'not_scoped' | 'pending' | 'not_pending' }` for the expected
 * refusals, a thrown error for everything else.
 *
 * `src/app/api/org/coverage.test.ts` requires every mutating org handler to
 * reference `recordEvent`, `auditRpc(` or the accept function.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventPayload } from './activity';

export const AUDIT_RPCS = {
  memberUpdate: 'labelos_audit_member_update',
  memberRemove: 'labelos_audit_member_remove',
  memberArtistsSet: 'labelos_audit_member_artists_set',
  invitationCreate: 'labelos_audit_invitation_create',
  invitationRevoke: 'labelos_audit_invitation_revoke',
  // Migration 148 (LABEL-21): external project members.
  projectInvitationCreate: 'labelos_audit_project_invitation_create',
  projectMemberUpdate: 'labelos_audit_project_member_update',
  projectMemberRemove: 'labelos_audit_project_member_remove',
} as const;
export type AuditRpcKey = keyof typeof AUDIT_RPCS;

export type AuditRpcArgs = {
  memberUpdate: {
    p_org: string;
    p_actor: string;
    p_user: string;
    /** Only the keys that change. */
    p_patch: Record<string, unknown>;
    p_verb: 'member.role_changed' | 'member.capabilities_changed' | 'member.scope_changed';
    p_payload: EventPayload;
  };
  memberRemove: { p_org: string; p_actor: string; p_user: string; p_payload: EventPayload };
  memberArtistsSet: { p_org: string; p_actor: string; p_user: string; p_contact_ids: string[]; p_payload: EventPayload };
  invitationCreate: {
    p_org: string;
    p_actor: string;
    p_email: string;
    p_role: string;
    p_functions: string[];
    p_artist_ids: string[];
    p_token_hash: string;
    p_expires_at: string;
    p_payload: EventPayload;
  };
  invitationRevoke: { p_org: string; p_actor: string; p_id: string; p_payload: EventPayload };
  projectInvitationCreate: {
    p_org: string;
    p_actor: string;
    p_project: string;
    p_email: string;
    p_role: string;
    p_allow_downloads: boolean;
    p_token_hash: string;
    p_expires_at: string;
    p_payload: EventPayload;
  };
  projectMemberUpdate: {
    p_org: string;
    p_actor: string;
    p_project: string;
    p_user: string;
    /** Only the keys that change: role, allow_downloads, expires_at. */
    p_patch: Record<string, unknown>;
    p_payload: EventPayload;
  };
  projectMemberRemove: { p_org: string; p_actor: string; p_project: string; p_user: string; p_payload: EventPayload };
};

export type AuditRpcError = { message: string; code?: string };
export type AuditRpcAdmin = Pick<SupabaseClient, 'rpc'>;

/** Call one audit function. Never throws on a database error: the caller maps it. */
export async function auditRpc<K extends AuditRpcKey>(
  admin: AuditRpcAdmin,
  key: K,
  args: AuditRpcArgs[K],
): Promise<{ data: Record<string, unknown> | null; error: AuditRpcError | null }> {
  const { data, error } = await admin.rpc(AUDIT_RPCS[key], args as Record<string, unknown>);
  if (error) return { data: null, error: { message: error.message, code: error.code } };
  return { data: (data ?? null) as Record<string, unknown> | null, error: null };
}

/**
 * Migration 146 is not applied: PostgREST cannot find one of THESE functions
 * (PGRST202, or 42883 naming it). Answered as "not ready", like every other
 * route whose migration is missing, instead of a raw 500. The error must name
 * an audit function: a 42883 raised from inside an applied function's body
 * (some other missing function or operator) is a real failure, not a missing
 * migration, and stays a 500.
 */
export function isMissingAuditRpc(error: AuditRpcError | null): boolean {
  if (!error) return false;
  if (!/labelos_audit_/.test(error.message)) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message);
}

export const AUDIT_RPC_NOT_READY = 'Auditing is not set up yet (migration 146 has not been applied).';
export const PROJECT_MEMBERS_NOT_READY = 'External project members are not set up yet (migration 148 has not been applied).';

/**
 * Migration 148 is not applied: PostgREST cannot find a project-member
 * function, or the `project_members` table (42P01 / PGRST205). Answered as
 * "not ready", never a raw 500.
 */
export function isMissingProjectMembers(error: { message: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return /project_members/.test(error.message);
  if (!/labelos_audit_project_|project_members|labelos_user_has_cap/.test(error.message)) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the (function|table)|does not exist/i.test(error.message);
}
