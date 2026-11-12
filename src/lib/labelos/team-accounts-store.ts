/**
 * Reads for team accounts (migration 190) that are about the SIGNED-IN
 * person, not an org: their own managed row. Kept out of src/app/api/org so
 * the org routes stay free of user_id filters (org-api-source-guard).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTeamAccounts } from './team-accounts';

export type OwnManagedAccount = { orgId: string; mustChangePassword: boolean; disabled: boolean };

export type OwnManagedResult =
  | { status: 'managed'; account: OwnManagedAccount }
  | { status: 'none' }
  | { status: 'schema_missing' };

/**
 * The managed row of `userId` — always the session's own id, passed by a
 * route or page that read it from the session. Throws on a real error.
 */
export async function ownManagedAccount(admin: Pick<SupabaseClient, 'from'>, userId: string): Promise<OwnManagedResult> {
  const { data, error } = await admin
    .from('org_managed_accounts')
    .select('org_id, must_change_password, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingTeamAccounts(error)) return { status: 'schema_missing' };
    throw new Error(error.message);
  }
  const row = data as { org_id: string; must_change_password: boolean; disabled_at: string | null } | null;
  if (!row) return { status: 'none' };
  return { status: 'managed', account: { orgId: row.org_id, mustChangePassword: row.must_change_password, disabled: row.disabled_at !== null } };
}

/**
 * What the org's own record says about this signed-in person (review G12):
 * still on the org-given password, and/or switched off. The org routes ask
 * this on every request so a switched-off account is refused by the record
 * itself and not only by the auth ban plus the session delete (which a
 * database that will not let `labelos_revoke_auth_sessions` run leaves
 * undone, and which never touches a token that is already issued). Any
 * error reads as "neither": access is still the membership.
 */
export async function sessionAccountState(
  userId: string | null,
  admin: Pick<SupabaseClient, 'from'>,
): Promise<{ mustChangePassword: boolean; disabled: boolean }> {
  const none = { mustChangePassword: false, disabled: false };
  if (!userId) return none;
  try {
    const own = await ownManagedAccount(admin, userId);
    if (own.status !== 'managed') return none;
    return {
      mustChangePassword: own.account.mustChangePassword && !own.account.disabled,
      disabled: own.account.disabled,
    };
  } catch {
    return none;
  }
}

/**
 * Must the signed-in person set their own password before using the org
 * shell? (A team account on its first password, or after a reset.) Read on
 * the server by the org layouts; any failure answers false — this is a
 * prompt to choose a password, not an access check (access is the
 * membership, and a switched-off account cannot sign in at all).
 */
export async function sessionMustChangePassword(
  userId: string | null,
  admin: Pick<SupabaseClient, 'from'>,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const own = await ownManagedAccount(admin, userId);
    return own.status === 'managed' && own.account.mustChangePassword && !own.account.disabled;
  } catch {
    return false;
  }
}

/**
 * The proxy's check, on the CALLER's own session: 190's
 * `labelos_my_password_pending` answers only about auth.uid(). Any error —
 * 190 not applied included — reads as false; the org routes check again with
 * the service role (lib/auth/org-access), so this is the first line, not the only one.
 */
export async function callerMustChangePassword(supabase: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('labelos_my_password_pending');
    return !error && data === true;
  } catch {
    return false;
  }
}
