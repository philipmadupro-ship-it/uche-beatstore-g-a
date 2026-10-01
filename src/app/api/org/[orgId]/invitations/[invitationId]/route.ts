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
import { recordEvent } from '@/lib/labelos/activity';
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

    // Only a still-pending row: an accept racing this request wins or loses
    // on the row lock, never both.
    const { data: updated, error: updateErr } = await admin
      .from('org_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('org_id', access.orgId)
      .eq('id', id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .select('revoked_at');
    if (updateErr) throw new Error(updateErr.message);
    const row = Array.isArray(updated) ? (updated[0] as { revoked_at: string } | undefined) : undefined;
    if (!row) {
      const after = await read();
      if (after?.revoked_at) return NextResponse.json({ revoked: true, revoked_at: after.revoked_at });
      return NextResponse.json({ error: 'This invitation was already accepted. Remove the member instead.' }, { status: 409 });
    }

    try {
      await recordEvent(
        admin,
        { orgId: access.orgId, userId: access.userId },
        'invitation.revoked',
        { type: 'invitation', id },
        { email: before.email },
      );
    } catch (err) {
      // A revocation with no audit row must not stand, or a retry would see
      // `revoked_at` and answer 200 without ever recording it. Undo exactly
      // this revocation; the retry then revokes and records together.
      await admin
        .from('org_invitations')
        .update({ revoked_at: null })
        .eq('org_id', access.orgId)
        .eq('id', id)
        .eq('revoked_at', row.revoked_at);
      throw err;
    }
    return NextResponse.json({ revoked: true, revoked_at: row.revoked_at });
  } catch (err) {
    log.error('revoke invitation failed', { orgId: access.orgId, invitationId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not revoke the invitation' }, { status: 500 });
  }
}
