/**
 * Server-side reads and writes for one artist's message thread. Every call is
 * owner-filtered: both callers use the service-role client (the portal after
 * its token gate, the workspace after `requireRowOwnership`).
 */

import { selectIn } from '@/lib/db/chunked-in';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { ARTIST_MESSAGE_COLUMNS, toArtistMessage, type ArtistMessage, type MessageAuthor, type MessageRow } from './messages';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const THREAD_LIMIT = 300;

export async function threadNames(admin: Admin, userId: string, contactId: string) {
  const [contact, profile] = await Promise.all([
    admin.from('contacts').select('name').eq('id', contactId).eq('user_id', userId).maybeSingle(),
    admin.from('creator_profiles').select('display_name').eq('user_id', userId).maybeSingle(),
  ]);
  return {
    artistName: (contact.data as { name?: string | null } | null)?.name ?? '',
    producerName: (profile.data as { display_name?: string | null } | null)?.display_name ?? '',
  };
}

/**
 * The newest `THREAD_LIMIT` messages, oldest first. `schemaReady: false` when
 * migration 130 is not applied, so callers can degrade instead of failing.
 */
export async function loadThread(
  admin: Admin,
  opts: { userId: string; contactId: string; audience: 'portal' | 'producer'; projectIds?: readonly string[] },
): Promise<{ schemaReady: boolean; messages: ArtistMessage[] }> {
  const { data, error } = await admin
    .from('artist_messages')
    .select(ARTIST_MESSAGE_COLUMNS)
    .eq('contact_id', opts.contactId)
    .eq('user_id', opts.userId)
    .order('created_at', { ascending: false })
    .limit(THREAD_LIMIT);
  if (error) {
    if (isMissingSchema(error)) return { schemaReady: false, messages: [] };
    throw error;
  }
  const rows = ((data ?? []) as MessageRow[]).reverse();
  // The portal may only name projects that are in it; the producer sees all of theirs.
  const wanted = [...new Set(rows.map((r) => r.project_id).filter((p): p is string => !!p))]
    .filter((p) => !opts.projectIds || opts.projectIds.includes(p));
  const projects = wanted.length
    ? await selectIn<{ id: string; name: string | null }>((ids) => admin.from('projects').select('id, name').in('id', ids).eq('user_id', opts.userId), wanted)
    : [];
  const projectNames = new Map(projects.map((p) => [p.id, p.name ?? 'Untitled project']));
  const names = await threadNames(admin, opts.userId, opts.contactId);
  return {
    schemaReady: true,
    messages: rows.map((r) => {
      const m = toArtistMessage(r, { audience: opts.audience, ...names, projectNames });
      // A project that has left the portal is not named there.
      if (opts.audience === 'portal' && m.projectId && !projectNames.has(m.projectId)) {
        m.projectId = null;
        m.projectName = null;
      }
      return m;
    }),
  };
}

/** Stamp `read_at` on the other side's unread messages. Best-effort; returns how many. */
export async function markRead(admin: Admin, opts: { userId: string; contactId: string; author: MessageAuthor; now: string }): Promise<number> {
  const { data, error } = await admin
    .from('artist_messages')
    .update({ read_at: opts.now })
    .eq('contact_id', opts.contactId)
    .eq('user_id', opts.userId)
    .eq('author', opts.author)
    .is('read_at', null)
    .select('id');
  if (error) return 0;
  return (data ?? []).length;
}
