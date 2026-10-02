/**
 * POST /api/org/[orgId]/invitations — invite someone to the org (LABEL-08,
 * 04-core-workflows.md W1). Capability `members.manage`.
 *
 *  - Only the roles and functions this org's KIND offers can be invited
 *    (06 §2.4b); anything else is 400. `owner` is never invitable.
 *  - The email is normalised (lib/contacts/email.ts). A second pending
 *    invitation to the same address is 409: revoke the first, then invite.
 *  - 32 random bytes; only their sha-256 is stored. The token leaves this
 *    route in exactly one place, the email, and is never logged or returned.
 *  - 7-day expiry. Rate-limited per org and per address (rate_limits, 074).
 *  - `invitation.created` is an audit event; if it cannot be written the
 *    invitation is removed again and the request fails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability, scopedOrgQuery } from '@/lib/auth/org-access';
import { OrgInvitationCreateBodySchema } from '@/lib/contracts';
import { normalizeEmail } from '@/lib/contacts/email';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import { inviterDisplayName, sendInvitationEmail } from '@/lib/labelos/invitation-email';
import { INVITATION_TTL_MS, newInvitationToken, validateInvitationGrant } from '@/lib/labelos/invitations';
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
    const pendingFor = () =>
      scopedOrgQuery(admin, 'org_invitations', access, 'id, created_at')
        .eq('email', email)
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
    const { data: inserted, error: insertErr } = await admin
      .from('org_invitations')
      .insert({
        org_id: access.orgId,
        email,
        role: grant.role,
        functions: grant.functions,
        artist_ids: grant.contactIds,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
        invited_by: access.userId,
      })
      .select(VIEW_COLUMNS)
      .single();
    if (insertErr || !inserted) throw new Error(insertErr?.message ?? 'insert returned nothing');
    const invitation = inserted as InvitationRow;

    // Two requests for one address can both pass the check above. After
    // inserting, the oldest pending row wins and any later one removes
    // itself, so exactly one survives whatever the interleaving.
    const after = await pendingFor();
    if (after.error) throw new Error(after.error.message);
    const oldest = ((after.data ?? []) as unknown as { id: string }[])[0];
    if (oldest && oldest.id !== invitation.id) {
      await admin.from('org_invitations').delete().eq('org_id', access.orgId).eq('id', invitation.id);
      return conflict(oldest.id);
    }

    try {
      await recordEvent(
        admin,
        { orgId: access.orgId, userId: access.userId },
        'invitation.created',
        { type: 'invitation', id: invitation.id },
        { email, role: grant.role, functions: grant.functions, contact_ids: grant.contactIds, scope: grant.scope },
      );
    } catch (err) {
      // An invitation nobody can account for must not exist.
      await admin.from('org_invitations').delete().eq('org_id', access.orgId).eq('id', invitation.id);
      throw err;
    }

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
