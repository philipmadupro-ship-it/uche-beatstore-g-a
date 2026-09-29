/**
 * What a share recipient hears: the whole beat, or the 75 s preview clip.
 *
 * A per-share choice (`share_links.full_playback` / `project_shares.full_playback`,
 * migration 121), and FULL is the default. A rapper writing to a beat, a friend
 * listening, a collaborator: all need the whole track. The 75 s clip exists for
 * the public storefront (lib/audio/preview-clip), and the share pages only
 * inherited it by accident. PR #17 generated a clip for every beat, the share
 * stream preferred the clip whenever one existed, and every share quietly
 * dropped to 1:15.
 *
 * `undefined` / `null` mean FULL as well. That covers rows written before
 * migration 121 and a database where it has not been applied yet, and it is
 * what a producer who never touched the setting expects.
 */

export interface PlaybackShareRow {
  full_playback?: boolean | null;
}

export interface PlaybackTrack {
  id: string;
  audio_url?: string | null;
  preview_url?: string | null;
}

/** True unless the producer explicitly limited this share to the preview clip. */
export function isFullPlayback(row: PlaybackShareRow | null | undefined): boolean {
  return row?.full_playback !== false;
}

/**
 * The storage source the gated stream route serves.
 *
 * Full: the master (`audio_url`), falling back to the clip only when there is
 * no master. Preview: the clip, falling back to the master when no clip was
 * generated. That fallback is the route's long-standing behaviour, so a beat
 * whose clip failed still plays rather than going silent.
 */
export function sharePlaybackSource(track: Omit<PlaybackTrack, 'id'>, full: boolean): string | null {
  const master = track.audio_url || null;
  const clip = track.preview_url || null;
  return full ? master ?? clip : clip ?? master;
}

/** Recipient-facing label for the playback mode. */
export function playbackLabel(full: boolean): string {
  return full ? 'Full track' : 'Preview · 1:15';
}

/** Shown when a producer picks "1:15 preview" on a database without mig 121. */
export const PLAYBACK_MIGRATION_MESSAGE =
  'The 1:15 preview option needs database migration 121 (share_full_playback). Until it is applied, shares play the full track.';

/**
 * PostgREST's answer when a write names a column the schema cache does not
 * have (PGRST204), or Postgres's (42703). supabase-js RESOLVES with this error
 * rather than throwing, so callers must check `.error`.
 */
export function isMissingPlaybackColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code !== 'PGRST204' && error.code !== '42703') return false;
  return (error.message ?? '').includes('full_playback');
}

/**
 * Run a share insert/update that may carry `full_playback`, on a database that
 * may not have the column yet.
 *
 * - Column present: one write, as asked.
 * - Column missing and the producer asked for FULL (or did not say): write
 *   again without it. Full is what a missing column means, so nothing is lost.
 * - Column missing and the producer asked for the PREVIEW: fail with
 *   PLAYBACK_MIGRATION_MESSAGE. Saving without it would publish the full track
 *   they chose not to share.
 */
export async function writeWithPlayback<R extends { error: { code?: string; message?: string } | null }>(
  fullPlayback: boolean | undefined,
  write: (fields: { full_playback?: boolean }) => PromiseLike<R>,
): Promise<R | { error: { code: 'PLAYBACK_MIGRATION'; message: string }; data: null }> {
  const fields = typeof fullPlayback === 'boolean' ? { full_playback: fullPlayback } : {};
  const first = await write(fields);
  if (!('full_playback' in fields) || !isMissingPlaybackColumn(first.error)) return first;
  if (fullPlayback === false) {
    return { error: { code: 'PLAYBACK_MIGRATION', message: PLAYBACK_MIGRATION_MESSAGE }, data: null };
  }
  return write({});
}

/**
 * A project_shares / share_links row as the OWNER's own listing returns it:
 * everything except the password hash, plus `full_playback` resolved to a
 * boolean. Listings select `*` rather than naming full_playback, so they keep
 * working on a database where migration 121 has not been applied.
 */
export function ownerShareRow<T extends Record<string, unknown>>(row: T): Omit<T, 'password_hash'> & { full_playback: boolean } {
  const rest: Record<string, unknown> = { ...row };
  delete rest.password_hash;
  return { ...(rest as Omit<T, 'password_hash'>), full_playback: isFullPlayback(row as PlaybackShareRow) };
}
