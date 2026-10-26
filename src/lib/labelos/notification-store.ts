/**
 * The reads and the one write behind `/api/org/[orgId]/notifications`
 * (LABEL-23). Every query is scoped by the ORG *and* by the RECIPIENT: a
 * notification is addressed to one person within one org (migration 151), so
 * org alone would hand a member their colleagues' asks and recipient alone
 * would mix an org's rows into the producer's bell (064) and across orgs.
 * Authorisation is the route's (`requireOrgMember`); service-role client.
 */
import type { AdminClient } from '@/lib/auth/ownership';

/** Rows the panel renders. The badge is NOT bounded by this. */
export const ORG_NOTIFICATION_PAGE_SIZE = 20;

export type OrgNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  data: unknown;
  read: boolean;
  created_at: string;
};

type Row = { id: string; kind: string; title: string; body: string | null; data: unknown; read: boolean | null; created_at: string };

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** One page of the recipient's notifications of this org (newest first) and their true unread count. */
export async function listOrgNotifications(
  admin: AdminClient,
  who: { orgId: string; userId: string },
): Promise<{ notifications: OrgNotification[]; unread: number; hasMore: boolean }> {
  const [page, count] = await Promise.all([
    admin
      .from('notifications')
      .select('id, kind, title, body, data, read, created_at')
      .eq('user_id', who.userId)
      .eq('org_id', who.orgId)
      .order('created_at', { ascending: false })
      .limit(ORG_NOTIFICATION_PAGE_SIZE),
    admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', who.userId)
      .eq('org_id', who.orgId)
      .eq('read', false),
  ]);
  if (page.error) fail('notification list', page.error);
  const rows = (page.data ?? []) as Row[];
  // If only the count fails, a low badge beats no panel.
  const unread = count.error ? rows.filter((n) => !n.read).length : count.count ?? 0;
  return {
    // Field by field: the row is never spread into the response.
    notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, data: n.data, read: n.read === true, created_at: n.created_at })),
    unread,
    hasMore: rows.length === ORG_NOTIFICATION_PAGE_SIZE,
  };
}

/** Mark the recipient's unread notifications of this org read: the ids named, or every one when `ids` is null. */
export async function markOrgNotificationsRead(admin: AdminClient, who: { orgId: string; userId: string }, ids: readonly string[] | null): Promise<void> {
  let q = admin.from('notifications').update({ read: true }).eq('user_id', who.userId).eq('org_id', who.orgId).eq('read', false);
  if (ids) q = q.in('id', [...ids]);
  const { error } = await q;
  if (error) fail('notification read', error);
}
