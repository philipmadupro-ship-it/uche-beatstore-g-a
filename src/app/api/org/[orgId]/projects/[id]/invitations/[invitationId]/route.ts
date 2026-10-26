/**
 * DELETE /api/org/[orgId]/projects/[id]/invitations/[invitationId]
 * (LABEL-21) — withdraw a pending PROJECT invitation. Capability
 * `share.external` on the project (requireObjectAccess). The invitation must
 * be this project's (a different project's, an org invitation or a missing
 * one is 404, so the id never confirms anything).
 *
 *  - pending  → revoked (200), `invitation.revoked` audit event, written by
 *               146's function in the same transaction;
 *  - revoked  → 200 again, nothing written (idempotent);
 *  - accepted → 409: the person is a member now; remove the member instead.
 * The row is kept with `revoked_at` set, so the join page says "withdrawn".
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { AUDIT_RPC_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.invitations.revoke');

type Params = { params: Promise<{ orgId: string; id: string; invitationId: string }> };
type Row = { id: string; email: string; accepted_at: string | null; revoked_at: string | null };

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, id, invitationId } = await params;
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'share.external', orgId });
  if (!access.ok) return access.res;
  if (!isUUID(invitationId)) return notFound();
  const { admin } = access;

  try {
    const read = async () => {
      // Keyed by org and project (the project was authorised above, scope included).
      const { data, error } = await admin
        .from('org_invitations')
        .select('id, email, accepted_at, revoked_at')
        .eq('org_id', access.orgId)
        .eq('id', invitationId)
        .eq('project_id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Row | null;
    };

    const before = await read();
    if (!before) return notFound();
    if (before.revoked_at) return NextResponse.json({ revoked: true, revoked_at: before.revoked_at });
    if (before.accepted_at) {
      return NextResponse.json({ error: 'This invitation was already accepted. Remove the member instead.' }, { status: 409 });
    }

    const { data: result, error: rpcErr } = await auditRpc(admin, 'invitationRevoke', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_id: invitationId,
      p_payload: { email: before.email, project_id: id },
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
    log.error('revoke project invitation failed', { orgId: access.orgId, projectId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not revoke the invitation' }, { status: 500 });
  }
}
