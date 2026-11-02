/**
 * Where a Label OS notification takes you (LABEL-23): the page of the thing
 * the ask is about. Pure, so the bell (a client component) can import it
 * without the writer's server-side imports. A notification whose `data` names
 * no page of its own opens "My work" on the org Overview, where a task lives.
 */
import { isUUID } from '@/lib/uuid';
import { isTaskObjectKind, targetHref } from './tasks';
import { isDirectAskKind } from './notify-kinds';

/** The in-app path a notification opens, or null for a producer-bell notification (not an org one). */
export function notificationHref(orgSlug: string, n: { kind: string; data?: unknown }): string | null {
  if (!isDirectAskKind(n.kind)) return null;
  const data = n.data && typeof n.data === 'object' ? (n.data as { target?: unknown }) : null;
  const t = data?.target && typeof data.target === 'object' ? (data.target as { kind?: unknown; id?: unknown }) : null;
  if (t && isTaskObjectKind(t.kind) && typeof t.id === 'string' && isUUID(t.id)) {
    const href = targetHref(orgSlug, { kind: t.kind, id: t.id });
    if (href) return href;
  }
  // LABEL-54: a request to confirm one's own rights details opens the Parties page.
  if (n.kind === 'party_confirmation') return `/o/${encodeURIComponent(orgSlug)}/rights/parties`;
  // LABEL-71: the artist answers on the store listings page (a credited artist may not reach the release itself).
  if (n.kind === 'listing_proposed') return `/o/${encodeURIComponent(orgSlug)}/releases/store`;
  // LABEL-65: the artist answers on the release's Marketing section.
  if (n.kind === 'asset_requested') {
    const id = (n.data as { releaseId?: unknown } | null | undefined)?.releaseId;
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) return `/o/${encodeURIComponent(orgSlug)}/releases/${id}`;
  }
  return `/o/${encodeURIComponent(orgSlug)}`;
}
