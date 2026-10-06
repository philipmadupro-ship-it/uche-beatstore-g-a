/**
 * GET /api/org/[orgId]/invitations — the pending invitations (LABEL-09: the
 * members page lists them with Revoke). Capability `members.manage`, the
 * same as 136's read policy. Never the token or its hash.
 *
 * POST /api/org/[orgId]/invitations — invite someone to the org (LABEL-08,
 * 04-core-workflows.md W1). Capability `members.manage`.
 *
 *  - Only the roles and functions this org's KIND offers can be invited
 *    (06 §2.4b); anything else is 400. `owner` is never invitable.
 *  - `contact_ids` (the roster artists a member is limited to) must all be
 *    on THIS org's roster (LABEL-10); anything else is 400.
 *  - The email is normalised (lib/contacts/email.ts). A second pending
 *    invitation to the same address is 409: revoke the first, then invite.
 *  - 32 random bytes; only their sha-256 is stored. The token leaves this
 *    route in exactly one place, the email, and is never logged or returned.
 *  - 7-day expiry. Rate-limited per org and per address (rate_limits, 074).
 *  - `invitation.created` is an audit event, written by the database function
 *    that inserts the invitation (LABEL-19, migration 146): one transaction,
 *    and the same function enforces one pending invitation per address under
 *    a lock, so two simultaneous requests cannot both create one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability, scopedOrgQuery } from '@/lib/auth/org-access';
import { OrgInvitationCreateBodySchema } from '@/lib/contracts';
import { normalizeEmail } from '@/lib/contacts/email';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { AUDIT_RPC_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { inviterDisplayName, sendInvitationEmail } from '@/lib/labelos/invitation-email';
import { INVITATION_TTL_MS, newInvitationToken, validateInvitationGrant } from '@/lib/labelos/invitations';
import { missingRosterContacts } from '@/lib/labelos/org-contacts';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.invitations');

/** What a manager sees of an invitation. Never the token or its hash. */
const VIEW_COLUMNS = 'id, email, role, functions, artist_ids, expires_at, accepted_at, revoked_at, created_at';

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  functions: string[];
  artist_ids: string[];
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function toView(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    functions: row.functions ?? [],
    contact_ids: row.artist_ids ?? [],
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;
  try {
    const { data, error } = await scopedOrgQuery(access.admin, 'org_invitations', access, VIEW_COLUMNS)
      // Project invitations (LABEL-21) are listed on their project, not here.
      .is('project_id', null)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as InvitationRow[];
    return NextResponse.json({ invitations: rows.map(toView) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('list invitations failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not list invitations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgInvitationCreateBodySchema);
  if (!parsed.ok) return parsed.res;

  const grant = validateInvitationGrant(access.orgKind, {
    role: parsed.data.role,
    functions: parsed.data.functions,
    contactIds: parsed.data.contact_ids,
  });
  if (!grant.ok) return NextResponse.json({ error: grant.error }, { status: 400 });

  const email = normalizeEmail(parsed.data.email);
  const { admin } = access;

  try {
    const missing = await missingRosterContacts(admin, access, grant.contactIds);
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Some of these are not artists in this organization', contact_ids: missing }, { status: 400 });
    }

    const pendingFor = () =>
      scopedOrgQuery(admin, 'org_invitations', access, 'id, created_at')
        .eq('email', email)
        .is('project_id', null)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    const conflict = (invitationId: string) =>
      NextResponse.json(
        { error: 'This address already has a pending invitation. Revoke it to send a new one.', invitationId },
        { status: 409 },
      );

    // `organizations` is keyed by `id` (the org the helper just authorised).
    const [pendingRes, orgRes, inviterName] = await Promise.all([
      pendingFor(),
      admin.from('organizations').select('name').eq('id', access.orgId).maybeSingle(),
      inviterDisplayName(admin, access.userId),
    ]);
    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (orgRes.error) throw new Error(orgRes.error.message);
    const pending = (pendingRes.data ?? []) as unknown as { id: string }[];
    if (pending.length > 0) return conflict(pending[0].id);
    const orgName = (orgRes.data as { name?: string } | null)?.name ?? 'your organization';

    // Counted only for invitations that will actually be written, so a 400
    // or 409 never spends the address's budget.
    const [orgOk, addressOk] = await Promise.all([
      rateLimitDurable(`org-invite:${access.orgId}`, 30, 60 * 60 * 1000),
      rateLimitDurable(`org-invite:${access.orgId}:${email}`, 5, 24 * 60 * 60 * 1000),
    ]);
    if (!orgOk || !addressOk) {
      return NextResponse.json({ error: 'Too many invitations. Try again later.' }, { status: 429 });
    }

    const { token, tokenHash } = newInvitationToken();
    const { data: result, error: rpcErr } = await auditRpc(admin, 'invitationCreate', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_email: email,
      p_role: grant.role,
      p_functions: grant.functions,
      p_artist_ids: grant.contactIds,
      p_token_hash: tokenHash,
      p_expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
      p_payload: { email, role: grant.role, functions: grant.functions, contact_ids: grant.contactIds, scope: grant.scope },
    });
    if (isMissingAuditRpc(rpcErr)) return NextResponse.json({ error: AUDIT_RPC_NOT_READY }, { status: 503 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'pending') return conflict(String(result.id ?? ''));
    const invitation = (result?.invitation ?? null) as InvitationRow | null;
    if (!invitation) throw new Error('invitation insert returned nothing');

    const sent = await sendInvitationEmail({
      to: email,
      orgName,
      inviterName,
      role: grant.role,
      functions: grant.functions,
      url: `${getAppUrl()}/join/${token}`,
    });

    return NextResponse.json(
      { invitation: toView(invitation), emailSent: sent.sent, ...(sent.sent ? {} : { emailError: sent.reason }) },
      { status: 201 },
    );
  } catch (err) {
    log.error('create invitation failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not create the invitation' }, { status: 500 });
  }
}
