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
 *   connectionRequest        connection.requested (154, LABEL-41; recorded in BOTH orgs)
 *   connectionAccept         connection.accepted  (both orgs)
 *   connectionEnd            connection.ended     (both orgs)
 *   connectionShare          share.created | share.revoked (the artist org)
 *   creditDecide             credit.confirmed | credit.disputed (153, LABEL-27)
 *   creditWithdraw           credit.withdrawn (174, LABEL-54; the credit is removed with its event)
 *   contractVoid             contract.voided (176, LABEL-57; the contract is voided with its event)
 *   splitCirculate           split_sheet.circulated (+ .superseded for the version it replaces) (155, LABEL-28)
 *   splitSign                split_sheet.signed (155, LABEL-28)
 *   platformCreateLicensee   org.created + org.entitlements_changed in the new org (170, LABEL-47)
 *   platformSetEntitlements  org.entitlements_changed in the licensee org (170, LABEL-47)
 *   orgSettings              org.settings_changed (172, LABEL-51; owner only, checked again in SQL)
 *
 * Accepting an invitation (`member.joined`) is 138's
 * `labelos_accept_invitation` (lib/labelos/invitations.ts), which already
 * did both writes in one transaction. Split transitions landed with
 * LABEL-28 and approvals with LABEL-30; delivery has no mutating route yet and lands its
 * function with its route.
 *
 * `auditRpc` is the one caller. The route does the authorisation and the
 * planning (requireOrgCapability, planMemberChange); the function does only
 * what the database can know for itself, and the route reads its answer:
 * `{ error: 'not_found' | 'not_scoped' | 'pending' | 'not_pending' | 'changed' }` for the expected
 * refusals, a thrown error for everything else.
 *
 * `src/app/api/org/coverage.test.ts` requires every mutating org handler to
 * reference `recordEvent`, `auditRpc(` or the accept function.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventPayload } from './activity';
import type { MemberExpectation } from './members';

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
  // Migration 154 (LABEL-41): the artist ↔ label connection.
  connectionRequest: 'labelos_audit_connection_request',
  connectionAccept: 'labelos_audit_connection_accept',
  connectionEnd: 'labelos_audit_connection_end',
  connectionShare: 'labelos_audit_connection_share',
  // Migration 153 (LABEL-27): a credit is confirmed or disputed, with its event.
  creditDecide: 'labelos_audit_credit_decide',
  // Migration 174 (LABEL-54): a credit is withdrawn (the credited person, or a rights writer), with its event.
  creditWithdraw: 'labelos_audit_credit_withdraw',
  // Migration 176 (LABEL-57): a contract is voided, with its event.
  contractVoid: 'labelos_audit_contract_void',
  // Migration 155 (LABEL-28): a split sheet is circulated (superseding the live one) or signed, with its event.
  splitCirculate: 'labelos_audit_split_circulate',
  splitSign: 'labelos_audit_split_sign',
  // Migration 157 (LABEL-30): an approval is requested of one member, or decided, with its event.
  approvalRequest: 'labelos_audit_approval_request',
  approvalDecide: 'labelos_audit_approval_decide',
  // Migration 170 (LABEL-47): the platform console. The event lands in the AFFECTED org, the operator as actor.
  platformCreateLicensee: 'labelos_platform_create_licensee',
  platformSetEntitlements: 'labelos_platform_set_entitlements',
  // Migration 172 (LABEL-51): the owner's organization settings, with `org.settings_changed`.
  orgSettings: 'labelos_audit_org_settings',
  // Migration 190 (doc 25): team accounts an org creates — membership + managed row + event, and reset / switch-off.
  teamAccountCreate: 'labelos_audit_team_account_create',
  teamAccountReset: 'labelos_audit_team_account_reset',
  teamAccountSetDisabled: 'labelos_audit_team_account_set_disabled',
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
    /**
     * Migration 167: the row the plan was made from (lib/labelos/members
     * `memberExpectation`). The function compares it under its row lock and
     * answers `{ error: 'changed' }`, writing nothing, when it moved. Left
     * out only by the members route's fallback while 167 is unapplied.
     */
    p_expect?: MemberExpectation;
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
  connectionRequest: {
    /** The REQUESTING org, of kind `p_side`. */
    p_org: string;
    p_actor: string;
    p_side: 'label' | 'artist';
    p_target_slug: string | null;
    p_target_email: string | null;
    p_contact: string | null;
    p_payload: EventPayload;
  };
  /** `p_org` is the ACCEPTING org, the side that did not ask. */
  connectionAccept: { p_org: string; p_actor: string; p_connection: string; p_payload: EventPayload };
  /** `p_org` is a party; either side may end. */
  connectionEnd: { p_org: string; p_actor: string; p_connection: string; p_payload: EventPayload };
  /** `p_org` is the ARTIST org. `p_patch`: share_mode, allow_copies; `p_project_ids` null = leave the list. */
  connectionShare: {
    p_org: string;
    p_actor: string;
    p_connection: string;
    p_patch: Record<string, unknown>;
    p_project_ids: string[] | null;
    p_payload: EventPayload;
  };
  creditDecide: {
    p_org: string;
    p_actor: string;
    p_credit: string;
    p_decision: 'confirmed' | 'disputed';
    /** The reason given with a dispute; null for a confirmation. */
    p_note: string | null;
    /** The song's context keys the event is filed under: { artist_id, project_id, song_id }. */
    p_subject: { artist_id: string | null; project_id: string | null; song_id: string | null };
    p_payload: EventPayload;
  };
  creditWithdraw: {
    p_org: string;
    p_actor: string;
    p_credit: string;
    /** The song's context keys the event is filed under: { artist_id, project_id, song_id }. */
    p_subject: { artist_id: string | null; project_id: string | null; song_id: string | null };
    p_payload: EventPayload;
  };
  contractVoid: {
    p_org: string;
    p_actor: string;
    p_contract: string;
    p_reason: string | null;
    p_payload: EventPayload;
  };
  splitCirculate: {
    p_org: string;
    p_actor: string;
    p_sheet: string;
    /** The song's context keys the events are filed under: { artist_id, project_id, song_id }. */
    p_subject: { artist_id: string | null; project_id: string | null; song_id: string | null };
    p_payload: EventPayload;
  };
  splitSign: {
    p_org: string;
    p_actor: string;
    p_sheet: string;
    /** The line signed; null = every unsigned line (a signed PDF covering the sheet). */
    p_line: string | null;
    p_method: 'upload' | 'acknowledged';
    /** The restricted split_sheet file (required for 'upload'). */
    p_asset: string | null;
    p_subject: { artist_id: string | null; project_id: string | null; song_id: string | null };
    p_payload: EventPayload;
  };
  approvalRequest: {
    p_org: string;
    p_actor: string;
    p_kind: 'song' | 'release';
    p_subject: string;
    p_gate: string;
    /** The one member asked. */
    p_approver: string;
    p_note: string | null;
    /** What the approver is looking at (lib/labelos/approvals.ts `Snapshot`). */
    p_snapshot: Record<string, unknown>;
    /** The context keys the event is filed under: { artist_id, project_id, song_id, release_id }. */
    p_ctx: { artist_id: string | null; project_id: string | null; song_id: string | null; release_id: string | null };
    p_payload: EventPayload;
  };
  approvalDecide: {
    p_org: string;
    p_actor: string;
    p_kind: 'song' | 'release';
    p_subject: string;
    p_gate: string;
    p_decision: 'approved' | 'changes_requested';
    p_note: string | null;
    /** What was approved: stored with the row, compared with the facts later (`isStale`). */
    p_snapshot: Record<string, unknown>;
    /** Owner or admin, from the live membership: the one exception to "a requester does not approve their own request". */
    p_may_self_approve: boolean;
    p_ctx: { artist_id: string | null; project_id: string | null; song_id: string | null; release_id: string | null };
    p_payload: EventPayload;
  };
  /** A new licensee org + its licence: `org.created` and `org.entitlements_changed` in the new org. */
  platformCreateLicensee: {
    p_actor: string;
    p_name: string;
    p_slug: string;
    p_kind: 'artist' | 'label';
    p_modules: string[];
    p_max_seats: number | null;
    p_max_artists: number | null;
    p_payload: EventPayload;
  };
  /** Replace a licensee's licence: `org.entitlements_changed` in that org. */
  platformSetEntitlements: {
    p_actor: string;
    p_org: string;
    p_modules: string[];
    p_max_seats: number | null;
    p_max_artists: number | null;
    p_payload: EventPayload;
  };
  /** Merge `p_patch` (only the keys that change) into `organizations.settings`; answers `{ settings }` or `{ error: 'not_found' | 'not_owner' }`. */
  orgSettings: { p_org: string; p_actor: string; p_patch: Record<string, unknown>; p_payload: EventPayload };
  teamAccountCreate: {
    p_org: string;
    p_actor: string;
    p_user: string;
    p_role: string;
    p_functions: string[];
    p_artist_ids: string[];
    p_payload: EventPayload;
  };
  teamAccountReset: { p_org: string; p_actor: string; p_user: string };
  teamAccountSetDisabled: { p_org: string; p_actor: string; p_user: string; p_disabled: boolean };
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
export const CREDITS_NOT_READY = 'Credits and parties are not set up yet (migration 153 has not been applied).';
export const SPLITS_NOT_READY = 'Split sheets are not set up yet (migration 155 has not been applied).';
export const ORG_SETTINGS_NOT_READY = 'Organization settings are not set up yet (migration 172 has not been applied).';
export const APPROVALS_NOT_READY = 'Approvals are not set up yet (migration 157 has not been applied).';
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

export const CONNECTIONS_NOT_READY = 'Artist ↔ label connections are not set up yet (migration 154 has not been applied).';

/**
 * Migration 154 is not applied: PostgREST cannot find a connection function or
 * the `org_connections` / `connection_projects` tables. "Not ready", never a
 * raw 500.
 */
export function isMissingConnections(error: { message: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return /org_connections|connection_projects/.test(error.message);
  if (!/labelos_audit_connection_|org_connections|connection_projects/.test(error.message)) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the (function|table)|does not exist/i.test(error.message);
}
