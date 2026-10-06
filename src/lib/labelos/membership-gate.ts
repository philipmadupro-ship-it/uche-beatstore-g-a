import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Coarse admission to Label OS (`/api/org/*`, `/o/*`) for src/proxy.ts:
 * does this signed-in user belong to ANY org (or, LABEL-21, any project)? It decides only whether the
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
 * LABEL-21: an outside collaborator belongs to a PROJECT, not an org, so a
 * user with no `org_members` row is also admitted when they have a
 * `project_members` row. RLS again decides what they see
 * (`project_members_self_read`: their own row, while it is live — not
 * expired, org not deleted), so an expired or removed membership shuts them
 * out on their next request. Admission is coarse and nothing more: it does
 * not reach a single org object, and it never admits to a producer path.
 * The `project_members` read failing (migration 148 not applied) reads as
 * "no project membership".
 */

async function hasRow(supabase: Pick<SupabaseClient, 'from'>, table: 'org_members' | 'project_members', column: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from(table).select(column).eq('user_id', userId).limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

export async function hasAnyLabelOsMembership(
  supabase: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<boolean> {
  if (await hasRow(supabase, 'org_members', 'org_id', userId)) return true;
  return hasRow(supabase, 'project_members', 'project_id', userId);
}
