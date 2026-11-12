/**
 * Saved views, read and written with the service role (migration 161 has no
 * policy for the API roles on purpose). The org filter is on every query; who
 * may do what is the route's, by the pure rules in `saved-views.ts`. Before
 * migration 161 every call here throws `SavedViewsNotReadyError`, which the
 * routes answer as `schemaReady: false`.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { isUUID } from '@/lib/validate';
import type { Definition, Subject } from './filters';
import { MAX_VIEWS_PER_ORG, VIEW_COLUMNS, type ViewRow } from './saved-views';

export class SavedViewsNotReadyError extends Error {
  constructor() {
    super('Saved views need migration 161 applied on Supabase.');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingSchema(error as { message: string; code?: string })) throw new SavedViewsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

export const isUniqueViolation = (error: DbError): boolean => error?.code === '23505';

/** Every view of the org (one subject, or both), newest first; the caller filters by what each viewer may see. */
export async function listViews(admin: AdminClient, org: string, subject?: Subject): Promise<ViewRow[]> {
  let q = admin.from('org_saved_views').select(VIEW_COLUMNS).eq('org_id', org);
  if (subject) q = q.eq('subject', subject);
  const res = await q.order('created_at', { ascending: false }).order('id').limit(MAX_VIEWS_PER_ORG);
  check('view list', res.error);
  return (res.data ?? []) as unknown as ViewRow[];
}

export async function readView(admin: AdminClient, org: string, viewId: string): Promise<ViewRow | null> {
  if (!isUUID(viewId)) return null;
  const res = await admin.from('org_saved_views').select(VIEW_COLUMNS).eq('org_id', org).eq('id', viewId).maybeSingle();
  check('view read', res.error);
  return (res.data as unknown as ViewRow | null) ?? null;
}

export async function countViews(admin: AdminClient, org: string, author?: string): Promise<number> {
  let q = admin.from('org_saved_views').select('id', { count: 'exact', head: true }).eq('org_id', org);
  if (author) q = q.eq('created_by', author);
  const res = await q;
  check('view count', res.error);
  return res.count ?? 0;
}

export async function insertView(
  admin: AdminClient,
  v: { org: string; author: string; subject: Subject; name: string; definition: Definition; shared: boolean },
): Promise<{ view: ViewRow } | { duplicate: true }> {
  const res = await admin
    .from('org_saved_views')
    .insert({ org_id: v.org, created_by: v.author, subject: v.subject, name: v.name, definition: v.definition, shared: v.shared })
    .select(VIEW_COLUMNS)
    .single();
  if (isUniqueViolation(res.error)) return { duplicate: true };
  check('view insert', res.error);
  return { view: res.data as unknown as ViewRow };
}

export async function updateView(
  admin: AdminClient,
  org: string,
  viewId: string,
  patch: { name?: string; definition?: Definition; shared?: boolean },
): Promise<{ view: ViewRow } | { duplicate: true } | { missing: true }> {
  // JSON drops undefined keys on the wire; build the patch without them so a fake that merges objects agrees.
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const res = await admin
    .from('org_saved_views')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('org_id', org)
    .eq('id', viewId)
    .select(VIEW_COLUMNS)
    .maybeSingle();
  if (isUniqueViolation(res.error)) return { duplicate: true };
  check('view update', res.error);
  return res.data ? { view: res.data as unknown as ViewRow } : { missing: true };
}

export async function deleteView(admin: AdminClient, org: string, viewId: string): Promise<boolean> {
  const res = await admin.from('org_saved_views').delete().eq('org_id', org).eq('id', viewId).select('id');
  check('view delete', res.error);
  return ((res.data ?? []) as unknown[]).length > 0;
}
