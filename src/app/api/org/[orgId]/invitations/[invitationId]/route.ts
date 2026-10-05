/**
 * DELETE /api/org/[orgId]/invitations/[invitationId] — revoke an invitation
 * (LABEL-08). Capability `members.manage`. The row is kept, with
 * `revoked_at` set, so the audit trail and the "withdrawn" answer on the
 * join page both have something to point at.
 *
 *  - pending  → revoked (200), `invitation.revoked` audit event;
 *  - revoked  → 200 again, nothing written (idempotent);
 *  - accepted → 409: the person is a member now; remove the member instead.
 * An invitation in another org, or that does not exist, is 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, scopedOrgQuery } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { AUDIT_RPC_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { createLogger } from '@/lib/log';

const log = createLogger('api.org.invitations.revoke');

type Row = { id: string; email: string; accepted_at: string | null; revoked_at: string | null };

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; invitationId: string }> },
) {
  const { orgId, invitationId } = await params;
  const access = await requireObjectAccess({ table: 'org_invitations', id: invitationId, cap: 'members.manage', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const id = access.object.id;

  try {
    const read = async () => {
      const { data, error } = await scopedOrgQuery(admin, 'org_invitations', access, 'id, email, accepted_at, revoked_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Row | null;
    };

    const before = await read();
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (before.revoked_at) return NextResponse.json({ revoked: true, revoked_at: before.revoked_at });
    if (before.accepted_at) {
      return NextResponse.json({ error: 'This invitation was already accepted. Remove the member instead.' }, { status: 409 });
    }

    // Only a still-pending row, and `invitation.revoked`, in one transaction:
    // an accept racing this request wins or loses on the row lock, never
    // both, and a revocation with no audit row cannot exist.
    const { data: result, error: rpcErr } = await auditRpc(admin, 'invitationRevoke', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_id: id,
      p_payload: { email: before.email },
    });
    if (isMissingAuditRpc(rpcErr)) return NextResponse.json({ error: AUDIT_RPC_NOT_READY }, { status: 503 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'not_pending') {
      const after = await read();
      if (after?.revoked_at) return NextResponse.json({ revoked: true, revoked_at: after.revoked_at });
      return NextResponse.json({ error: 'This invitation was already accepted. Remove the member instead.' }, { status: 409 });
    }
    return NextResponse.json({ revoked: true, revoked_at: result?.revoked_at ?? null });
  } catch (err) {
    log.error('revoke invitation failed', { orgId: access.orgId, invitationId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not revoke the invitation' }, { status: 500 });
  }
}
