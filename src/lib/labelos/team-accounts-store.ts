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
