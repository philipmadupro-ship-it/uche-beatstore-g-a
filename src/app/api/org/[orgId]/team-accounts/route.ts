/**
 * POST /api/org/[orgId]/team-accounts — create a login for a person directly
 * (docs/bstudio-label-os/25-team-accounts.md, phase 1; migration 190).
 *
 * Capability `members.manage`. Body: email, name, the password the creator
 * chose, and what an invitation would grant (role, functions, artist list —
 * the same `validateInvitationGrant`, so `owner` is never offered). Then:
 *
 *  1. the auth user is created with the Supabase admin API, email confirmed.
 *     An address that already has an account is 409 "invite them instead":
 *     an org never sets the password of somebody's existing account;
 *  2. ONE database function writes the membership, the artist list, the
 *     managed-account row and `member.account_created` (seat cap under 170's
 *     lock). If it refuses or fails, the auth user from step 1 is deleted
 *     again, so nothing is left half-made.
 *
 * The password is never logged, stored by the app or put in an event; the
 * person is asked to change it at first sign-in (`must_change_password`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { TeamAccountCreateBodySchema } from '@/lib/contracts';
import { normalizeEmail } from '@/lib/contacts/email';
import { errorMessage } from '@/lib/errors';
import { auditRpc } from '@/lib/labelos/audit-rpc';
import { seatLimitError, takesSeat } from '@/lib/labelos/entitlements';
import { seatsInUse } from '@/lib/labelos/entitlements-store';
import { validateInvitationGrant } from '@/lib/labelos/invitations';
import { missingRosterContacts } from '@/lib/labelos/org-contacts';
import {
  EMAIL_TAKEN,
  TEAM_ACCOUNTS_NOT_READY,
  interpretCreate,
  isEmailTaken,
  isMissingTeamAccounts,
  passwordProblem,
} from '@/lib/labelos/team-accounts';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.team-accounts');

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'members.manage');
  if (!access.ok) return access.res;

  const parsed = await readBody(req, TeamAccountCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const email = normalizeEmail(parsed.data.email);
  const weak = passwordProblem(parsed.data.password, email);
  if (weak) return NextResponse.json({ error: weak, code: 'weak_password' }, { status: 400 });

  const grant = validateInvitationGrant(access.orgKind, {
    role: parsed.data.role,
    functions: parsed.data.functions,
    contactIds: parsed.data.contact_ids,
  });
  if (!grant.ok) return NextResponse.json({ error: grant.error }, { status: 400 });

  const { admin } = access;
  try {
    const missing = await missingRosterContacts(admin, access, grant.contactIds);
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Some of these are not artists in this organization', contact_ids: missing }, { status: 400 });
    }
    // The licence's seat cap, checked early for a plain answer; the function re-checks under a lock.
    if (takesSeat(grant.role) && access.entitlements?.maxSeats != null) {
      const full = seatLimitError(await seatsInUse(admin, access.orgId), access.entitlements.maxSeats);
      if (full) return NextResponse.json({ error: full, code: 'seat_limit' }, { status: 409 });
    }
    if (!(await rateLimitDurable(`org-team-account:${access.orgId}`, 30, 60 * 60 * 1000))) {
      return NextResponse.json({ error: 'Too many accounts created. Try again later.' }, { status: 429 });
    }

    const created = await admin.auth.admin.createUser({
      email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { name: parsed.data.name, created_by_org: access.orgId },
    });
    if (isEmailTaken(created.error)) return NextResponse.json({ error: EMAIL_TAKEN, code: 'email_taken' }, { status: 409 });
    if (created.error || !created.data?.user?.id) throw new Error(created.error?.message ?? 'createUser returned no user');
    const userId = created.data.user.id;

    const undo = async (why: string) => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) log.error('team account left behind after a failed create', { orgId: access.orgId, userId, why, error: error.message });
    };

    const { data, error } = await auditRpc(admin, 'teamAccountCreate', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_user: userId,
      p_role: grant.role,
      p_functions: grant.functions,
      p_artist_ids: grant.contactIds,
      p_payload: { email, role: grant.role, functions: grant.functions, contact_ids: grant.contactIds, scope: grant.scope },
    });
    if (error) {
      await undo('rpc error');
      if (isMissingTeamAccounts(error)) return NextResponse.json({ error: TEAM_ACCOUNTS_NOT_READY }, { status: 503 });
      throw new Error(error.message);
    }
    const outcome = interpretCreate(data);
    if (!outcome) {
      await undo('unexpected answer');
      throw new Error('unexpected labelos_audit_team_account_create answer');
    }
    if (!outcome.ok) {
      await undo(outcome.code);
      return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    }

    // The name the members list shows (lib/labelos/member-identity reads user_profiles first). Best effort.
    const named = await admin.from('user_profiles').upsert({ user_id: userId, display_name: parsed.data.name }, { onConflict: 'user_id' });
    if (named.error) log.warn('team account name not saved', { orgId: access.orgId, userId, error: named.error.message });

    return NextResponse.json(
      { member: { user_id: userId, email, name: parsed.data.name, role: grant.role, functions: grant.functions, scope: grant.scope } },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('create team account failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not create the account' }, { status: 500 });
  }
}
