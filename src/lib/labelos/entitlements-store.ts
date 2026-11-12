/**
 * Reads of `org_entitlements` (migration 170) for the service-role code that
 * builds an access context. The rules are lib/labelos/entitlements.ts.
 *
 * Before 170 is applied the table does not exist: that reads as "no row",
 * i.e. the default (everything the face allows), so Label OS behaves exactly
 * as it did before LABEL-47. Any other error throws, and the caller fails
 * closed (org-access answers 500, never "entitled").
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { orgEntitlements, type EntitlementRow, type Entitlements } from './entitlements';

export const ENTITLEMENT_COLUMNS = 'modules, max_seats, max_artists, setup_done';

const MISSING = new Set(['PGRST205', '42P01']);

export function isMissingEntitlements(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && MISSING.has(error.code)) return /org_entitlements/.test(error.message ?? '') || error.code === '42P01';
  return /org_entitlements/.test(error.message ?? '') && /does not exist|schema cache|could not find/i.test(error.message ?? '');
}

/** The org's raw entitlement row, or null (none, or 170 not applied). Throws on any other error. */
export async function readEntitlementRow(admin: Pick<SupabaseClient, 'from'>, orgId: string): Promise<EntitlementRow | null> {
  const { data, error } = await admin.from('org_entitlements').select(ENTITLEMENT_COLUMNS).eq('org_id', orgId).maybeSingle();
  if (error) {
    if (isMissingEntitlements(error)) return null;
    throw new Error(error.message);
  }
  return (data as EntitlementRow | null) ?? null;
}

export async function loadEntitlements(admin: Pick<SupabaseClient, 'from'>, org: { id: string; kind: string }): Promise<Entitlements> {
  return orgEntitlements(org, await readEntitlementRow(admin, org.id));
}

type CountRead = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function count(read: CountRead, what: string): Promise<number> {
  const { count: n, error } = await read;
  if (error) throw new Error(`${what}: ${error.message}`);
  return n ?? 0;
}

/**
 * Staff seats in use, for the seat cap at invitation time: members whose role
 * takes a seat (not `artist`) plus pending org invitations for such a role, so
 * a full org cannot hand out more invitations than it has seats. Joining
 * re-checks under a lock in the database (170's accept function).
 */
export async function seatsInUse(admin: Pick<SupabaseClient, 'from'>, orgId: string): Promise<number> {
  const [members, pending] = await Promise.all([
    count(admin.from('org_members').select('role', { count: 'exact', head: true }).eq('org_id', orgId).neq('role', 'artist'), 'seat count'),
    count(
      admin
        .from('org_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('project_id', null)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .neq('role', 'artist'),
      'pending seat count',
    ),
  ]);
  return members + pending;
}
