/**
 * PATCH /api/org/[orgId]/team-accounts/[userId] — the org's control over an
 * account it created (docs/bstudio-label-os/25-team-accounts.md; migration 190).
 *
 * Capability `members.manage`. Body:
 *  - `{ action: 'reset_password', password }` — sets a new password the
 *    manager chose and asks the person to change it at next sign-in;
 *  - `{ action: 'disable' }` / `{ action: 'enable' }` — the auth user is
 *    banned (sign-in and token refresh refused) or let back in.
 *
 * Only an account THIS org created and that is in nothing else (no other
 * org, no shared project, not the producer, not a platform operator), never
 * the caller's own, an owner or an admin only by an owner — 190's
 * `labelos_team_account_target`, re-checked under a row lock by the audited
 * function. That function runs FIRST, writes the event and ends every
 * session the person has (a reset and a switch-off sign them out
 * everywhere); the auth change follows. 30 changes a minute per manager. If the auth change fails the answer says so (502), and a failed
 * switch-off is put back so the record matches the account.
 *
 * A password is never read back, logged or put in an event.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { TeamAccountPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { auditRpc } from '@/lib/labelos/audit-rpc';
import {
  BAN_FOREVER,
  TEAM_ACCOUNTS_NOT_READY,
  isMissingTeamAccounts,
  passwordProblem,
  targetRefusal,
} from '@/lib/labelos/team-accounts';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { isUUID, readBody } from '@/lib/validate';

const log = createLogger('api.org.team-accounts.user');

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orgId: string; userId: string }> }) {
  const { orgId, userId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;
  if (!isUUID(userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const parsed = await readBody(req, TeamAccountPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  if (body.action === 'reset_password') {
    const weak = passwordProblem(body.password);
    if (weak) return NextResponse.json({ error: weak, code: 'weak_password' }, { status: 400 });
  }
  if (!(await rateLimitDurable(`team-account-change:u:${access.userId}`, 30, 60 * 1000))) {
    return NextResponse.json({ error: 'Too many changes. Try again in a minute.' }, { status: 429 });
  }

  const { admin } = access;
  const base = { p_org: access.orgId, p_actor: access.userId, p_user: userId };
  try {
    const { data, error } =
      body.action === 'reset_password'
        ? await auditRpc(admin, 'teamAccountReset', base)
        : await auditRpc(admin, 'teamAccountSetDisabled', { ...base, p_disabled: body.action === 'disable' });
    if (isMissingTeamAccounts(error)) return NextResponse.json({ error: TEAM_ACCOUNTS_NOT_READY }, { status: 503 });
    if (error) throw new Error(error.message);
    const answer = (data ?? {}) as { ok?: boolean; error?: string; sessions_revoked?: boolean };
    if (answer.ok !== true) {
      const refused = targetRefusal(answer.error);
      if (!refused) throw new Error(`unexpected team account answer: ${String(answer.error)}`);
      return NextResponse.json({ error: refused.error, code: refused.code }, { status: refused.status });
    }
    // 190 ended their sessions in the same transaction, unless this database
    // would not let it (then the ban / new password still stops new sign-ins).
    if (answer.sessions_revoked === false) {
      log.warn('team account sessions not revoked', { orgId: access.orgId, userId, action: body.action });
    }

    const authChange =
      body.action === 'reset_password'
        ? { password: body.password }
        : { ban_duration: body.action === 'disable' ? BAN_FOREVER : 'none' };
    const updated = await admin.auth.admin.updateUserById(userId, authChange);
    if (updated.error) {
      log.error('team account auth change failed after its event', { orgId: access.orgId, userId, action: body.action, error: updated.error.message });
      if (body.action !== 'reset_password') {
        const back = await auditRpc(admin, 'teamAccountSetDisabled', { ...base, p_disabled: body.action !== 'disable' });
        if (back.error) log.error('team account flag not put back', { orgId: access.orgId, userId, error: back.error.message });
      }
      return NextResponse.json({ error: 'The account could not be changed. Try again.' }, { status: 502 });
    }

    return NextResponse.json(
      {
        user_id: userId,
        ...(body.action === 'reset_password' ? { pending_password_change: true } : { disabled: body.action === 'disable' }),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('team account change failed', { orgId: access.orgId, userId, action: body.action, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not change the account' }, { status: 500 });
  }
}
