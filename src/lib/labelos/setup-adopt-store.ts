/**
 * The operator-created org this account owns and has not set up yet
 * (LABEL-48 + review G12): the one `labelos_setup_org` ADOPTS (migration 197).
 * The page asks it so such an owner sees the wizard instead of being sent on
 * to an org that is still unconfigured. Read with the service client, after
 * the caller's session is known; only ever the caller's own rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type UnfinishedOrg = { id: string; slug: string; name: string; kind: 'artist' | 'label' };

export async function unfinishedOwnedOrg(admin: Pick<SupabaseClient, 'from'>, userId: string): Promise<UnfinishedOrg | null> {
  try {
    const { data: mine, error } = await admin.from('org_members').select('org_id').eq('user_id', userId).eq('role', 'owner');
    if (error || !Array.isArray(mine) || mine.length === 0) return null;
    const ids = mine.map((r: { org_id: string }) => r.org_id);
    const [orgs, ents] = await Promise.all([
      admin.from('organizations').select('id, slug, name, kind').in('id', ids).is('created_by', null).is('deleted_at', null).in('kind', ['artist', 'label']).order('created_at').order('id'),
      admin.from('org_entitlements').select('org_id').in('org_id', ids).eq('setup_done', false),
    ]);
    if (orgs.error || ents.error) return null;
    const open = new Set((ents.data ?? []).map((r: { org_id: string }) => r.org_id));
    const hit = (orgs.data ?? []).find((o: { id: string }) => open.has(o.id)) as UnfinishedOrg | undefined;
    return hit ?? null;
  } catch {
    return null;
  }
}
