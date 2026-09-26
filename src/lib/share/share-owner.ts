import { isProducerUserId } from '@/lib/auth/producer';

/**
 * Who owns a share, and may it grant a given track?
 *
 * Buyers hold Supabase sessions, and RLS let a session insert its own
 * `share_links` row (and, before mig 119, its own playlist/project + share)
 * listing ANY track ids. The share routes resolved "is this track in the
 * share" from the share's own track list and never asked who owned the
 * track — so a buyer-made share streamed/downloaded the producer's audio,
 * and share checkout used the buyer as seller (their license tiers, their
 * prices) for the producer's beats.
 *
 * Rule: a share grants a track only when the share's owner is the producer
 * AND owns that track.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface ProjectShareRef {
  content_type?: string | null;
  project_id?: string | null;
  playlist_id?: string | null;
  track_id?: string | null;
}

/** Owner of a project_shares row — it has no user_id; the parent's owner is it. */
export async function projectShareOwnerId(admin: Admin, row: ProjectShareRef): Promise<string | null> {
  const kind = row.content_type ?? 'project';
  let table: string | null = null;
  let id: string | null | undefined = null;
  if (kind === 'playlist' && row.playlist_id) { table = 'playlists'; id = row.playlist_id; }
  else if (kind === 'track' && row.track_id) { table = 'tracks'; id = row.track_id; }
  else if (row.project_id) { table = 'projects'; id = row.project_id; }
  if (!table || !id) return null;
  const { data } = await admin.from(table).select('user_id').eq('id', id).maybeSingle();
  return (data as { user_id?: string | null } | null)?.user_id ?? null;
}

/** The subset of `trackIds` a share owned by `ownerId` may grant. */
export async function grantableTrackIds(
  admin: Admin,
  ownerId: string | null | undefined,
  trackIds: string[],
): Promise<string[]> {
  if (!ownerId || trackIds.length === 0) return [];
  if (!(await isProducerUserId(admin, ownerId))) return [];
  const { data } = await admin.from('tracks').select('id').eq('user_id', ownerId).in('id', trackIds);
  const owned = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
  return trackIds.filter((id) => owned.has(id));
}

export async function shareGrantsTrack(
  admin: Admin,
  ownerId: string | null | undefined,
  trackId: string,
): Promise<boolean> {
  return (await grantableTrackIds(admin, ownerId, [trackId])).length === 1;
}
