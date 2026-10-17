/**
 * POST /api/org/account/password — a team account sets its own password
 * (docs/bstudio-label-os/25-team-accounts.md; migration 190).
 *
 * For an account an org created (`org_managed_accounts`): the first sign-in,
 * or the one after a reset, lands on /account/password until this succeeds.
 * Anyone else is 404 here — their password is theirs to manage through the
 * normal reset flow, not an org route. The user is the session's own; the
 * new password goes to Supabase's admin API and nowhere else, then 190's
 * `labelos_team_account_password_changed` clears the flag and the org's log
 * gets `member.password_changed` (no secret in it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { sessionIdentity } from '@/lib/auth/org-access';
import { createServiceClient } from '@/lib/auth/ownership';
import { AccountPasswordBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import { TEAM_ACCOUNTS_NOT_READY, passwordProblem } from '@/lib/labelos/team-accounts';
import { ownManagedAccount } from '@/lib/labelos/team-accounts-store';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.account.password');

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function POST(req: NextRequest) {
  const session = await sessionIdentity();
  if (!session) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });

  const admin = createServiceClient();
  try {
    // Only a team account (and a live one) uses this route; anyone else is 404 before the body is read.
    const own = await ownManagedAccount(admin, session.userId);
    if (own.status === 'schema_missing') return NextResponse.json({ error: TEAM_ACCOUNTS_NOT_READY }, { status: 503 });
    if (own.status === 'none' || own.account.disabled) return NOT_FOUND();

    const parsed = await readBody(req, AccountPasswordBodySchema);
    if (!parsed.ok) return parsed.res;
    const weak = passwordProblem(parsed.data.password, session.email);
    if (weak) return NextResponse.json({ error: weak, code: 'weak_password' }, { status: 400 });

    if (!(await rateLimitDurable(`account-password:${session.userId}`, 10, 60 * 60 * 1000))) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const updated = await admin.auth.admin.updateUserById(session.userId, { password: parsed.data.password });
    if (updated.error) throw new Error(updated.error.message);

    const cleared = await admin.rpc('labelos_team_account_password_changed', { p_user: session.userId });
    if (cleared.error) throw new Error(cleared.error.message);

    // Everyday event, best effort: the password is changed either way.
    try {
      await recordEvent(admin, { orgId: own.account.orgId, userId: session.userId }, 'member.password_changed', { type: 'member', id: session.userId }, {});
    } catch (err) {
      log.warn('member.password_changed not recorded', { orgId: own.account.orgId, error: errorMessage(err) });
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('password change failed', { userId: session.userId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not change the password' }, { status: 500 });
  }
}
