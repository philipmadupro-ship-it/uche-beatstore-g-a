/**
 * The platform console's reads and writes (LABEL-47), for the routes under
 * /api/platform once requirePlatformAdmin has passed. Service role.
 *
 * Writes go through migration 170's functions (each with its audit event in
 * the affected org) and, for the owner invitation, 146's
 * labelos_audit_invitation_create — the same function and the same email the
 * members page uses, so accepting is the ordinary /join/<token> flow.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail } from '@/lib/contacts/email';
import { getAppUrl } from '@/lib/env';
import { auditRpc, isMissingAuditRpc } from './audit-rpc';
import { inviterDisplayName, sendInvitationEmail } from './invitation-email';
import { INVITATION_TTL_MS, newInvitationToken } from './invitations';
import { inChunks, pageAll, ReadError } from './paged-read';
import { ENTITLEMENT_COLUMNS, isMissingEntitlements } from './entitlements-store';
import type { EntitlementRow } from './entitlements';
import {
  LICENSEE_KINDS,
  licenseeViews,
  type LicenseeContactRow,
  type LicenseeInviteRow,
  type LicenseeMemberRow,
  type LicenseeOrgRow,
  type LicenseeView,
} from './platform';

type Admin = Pick<SupabaseClient, 'from' | 'rpc'>;

export const PLATFORM_NOT_READY = 'The platform console needs migration 170 applied on Supabase.';

/** Migration 170 is not applied: its functions or tables are missing. */
export function isMissingPlatform(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message ?? '';
  if (isMissingEntitlements(error)) return true;
  if (!/labelos_platform_|platform_admins|org_entitlements/.test(msg)) return false;
  return ['PGRST202', '42883', 'PGRST205', '42P01'].includes(error.code ?? '') || /could not find|does not exist/i.test(msg);
}

/** Every live licensee (artist and label orgs) with its licence and counts. Paged; no long `.in()` lists. */
export async function listLicensees(admin: Admin): Promise<LicenseeView[]> {
  const orgs = await pageAll<LicenseeOrgRow>(
    (from, to) =>
      admin
        .from('organizations')
        .select('id, name, slug, kind, created_at')
        .in('kind', [...LICENSEE_KINDS])
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    'licensee orgs',
  );
  const ids = orgs.map((o) => o.id);
  if (ids.length === 0) return [];
  const now = new Date().toISOString();
  const [entitlements, members, contacts, ownerInvites] = await Promise.all([
    inChunks<EntitlementRow & { org_id: string }>(
      ids,
      (part, from, to) => admin.from('org_entitlements').select(`org_id, ${ENTITLEMENT_COLUMNS}`).in('org_id', part).order('org_id').range(from, to),
      'licences',
    ).catch((err) => {
      // Before 170 every org reads as the default licence.
      if (err instanceof ReadError && isMissingEntitlements(err.raw)) return [];
      throw err;
    }),
    inChunks<LicenseeMemberRow>(
      ids,
      (part, from, to) => admin.from('org_members').select('org_id, role').in('org_id', part).order('org_id').order('user_id').range(from, to),
      'licensee members',
    ),
    inChunks<LicenseeContactRow>(
      ids,
      (part, from, to) => admin.from('contacts').select('org_id, category, secondary_category').in('org_id', part).order('org_id').order('id').range(from, to),
      'licensee contacts',
    ),
    inChunks<LicenseeInviteRow>(
      ids,
      (part, from, to) =>
        admin
          .from('org_invitations')
          .select('org_id, email, expires_at')
          .in('org_id', part)
          .eq('role', 'owner')
          .is('project_id', null)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .gt('expires_at', now)
          .order('org_id')
          .order('id')
          .range(from, to),
      'owner invitations',
    ),
  ]);
  return licenseeViews({ orgs, entitlements, members, contacts, ownerInvites });
}

/** One live licensee org by id (not the producer's own org), or null. */
export async function readLicenseeOrg(admin: Admin, orgId: string): Promise<LicenseeOrgRow | null> {
  const { data, error } = await admin
    .from('organizations')
    .select('id, name, slug, kind, created_at')
    .eq('id', orgId)
    .in('kind', [...LICENSEE_KINDS])
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ReadError('licensee org', error);
  return (data as LicenseeOrgRow | null) ?? null;
}

/** The org's current licence row (null = the default), for the audit payload's `previous`. */
export async function readLicenceRow(admin: Admin, orgId: string): Promise<EntitlementRow | null> {
  const { data, error } = await admin.from('org_entitlements').select(ENTITLEMENT_COLUMNS).eq('org_id', orgId).maybeSingle();
  if (error) throw new ReadError('licence', error);
  return (data as EntitlementRow | null) ?? null;
}

export type OwnerInviteResult =
  | { ok: true; invitationId: string; emailSent: boolean; emailError?: string }
  | { ok: false; status: 409 | 503; error: string };

/**
 * Invite the licensee's owner: an `owner` invitation sent by the operator,
 * through 146's function (its `invitation.created` audit event lands in the
 * org), then the ordinary invitation email. 170's accept function honours an
 * owner invitation only while its sender is still an operator.
 */
export async function inviteOwner(admin: Admin, operatorId: string, org: { id: string; name: string }, rawEmail: string): Promise<OwnerInviteResult> {
  const email = normalizeEmail(rawEmail);
  const { token, tokenHash } = newInvitationToken();
  const { data, error } = await auditRpc(admin, 'invitationCreate', {
    p_org: org.id,
    p_actor: operatorId,
    p_email: email,
    p_role: 'owner',
    p_functions: [],
    p_artist_ids: [],
    p_token_hash: tokenHash,
    p_expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    p_payload: { email, role: 'owner', functions: [], contact_ids: [], scope: 'org', source: 'platform' },
  });
  if (isMissingAuditRpc(error)) return { ok: false, status: 503, error: 'Invitations are not set up yet (migration 146 has not been applied).' };
  if (error) throw new Error(error.message);
  if (data?.error === 'pending') {
    return { ok: false, status: 409, error: 'This address already has a pending invitation to this organization.' };
  }
  const invitation = data?.invitation as { id?: string } | undefined;
  if (!invitation?.id) throw new Error('owner invitation insert returned nothing');
  const sent = await sendInvitationEmail({
    to: email,
    orgName: org.name,
    inviterName: await inviterDisplayName(admin, operatorId),
    role: 'owner',
    functions: [],
    url: `${getAppUrl()}/join/${token}`,
  });
  return sent.sent ? { ok: true, invitationId: invitation.id, emailSent: true } : { ok: true, invitationId: invitation.id, emailSent: false, emailError: sent.reason };
}
