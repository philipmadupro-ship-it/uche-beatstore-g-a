import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Coarse admission to Label OS (`/api/org/*`, `/o/*`) for src/proxy.ts:
 * does this signed-in user belong to ANY org? It decides only whether the
 * request reaches a Label OS route at all. Which org, which capability and
 * which artist/project scope are the route's checks (lib/auth/org-access.ts).
 *
 * Read LIVE on every request, never cached in the JWT or a cookie, like
 * org-access.ts: removing someone's last membership shuts them out on their
 * next request.
 *
 * It runs on the caller's own session (the anon client), so RLS decides what
 * it can see: `org_members_member_read` shows a user their rows only in orgs
 * that are not soft-deleted (`org_role`), which is exactly "a usable
 * membership". Any error (including migration 136 not being applied) reads
 * as "no membership" — the gate fails closed.
 *
 * LABEL-21 extends THIS function to `project_members` (an outside
 * collaborator belongs to a project, not an org). Until that table exists,
 * membership means an `org_members` row.
 */

export async function hasAnyLabelOsMembership(
  supabase: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
