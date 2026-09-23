import type { UploadStatus } from './manager';

/**
 * Which controls an uploads-tray row offers, and when a finished upload can be
 * edited in place.
 *
 * The tray row's buttons were five inline `{cond && <button/>}` blocks whose
 * conditions overlapped in ways nothing checked: `isActive` was computed in the
 * parent and passed down beside the status it was derived from, so the two
 * could disagree, and Cancel/Dismiss both rendered an X with different
 * meanings. Deciding this from the status alone makes the row's vocabulary
 * something a test can pin down.
 */

export type UploadRowAction = 'pause' | 'resume' | 'retry' | 'repick' | 'cancel' | 'dismiss';

/** Statuses where bytes are actually moving. */
export function isUploadActive(status: UploadStatus): boolean {
  return status === 'uploading' || status === 'preparing' || status === 'finalizing';
}

/**
 * Ordered actions for a row.
 *
 * Order is deliberate: the reversible control comes first and the destructive
 * one last, the same rule the ⋯ menus follow. A row never offers both Cancel
 * (stop work in progress) and Dismiss (forget a finished row) — they look
 * identical and mean opposite things.
 */
export function uploadRowActions(status: UploadStatus): UploadRowAction[] {
  if (isUploadActive(status)) return ['pause', 'cancel'];
  switch (status) {
    case 'queued':      return ['cancel'];
    case 'paused':      return ['resume', 'cancel'];
    case 'error':       return ['retry', 'dismiss'];
    case 'interrupted': return ['repick', 'dismiss'];
    case 'success':     return ['dismiss'];
    default:            return [];
  }
}

export interface FinishedUpload {
  status: UploadStatus;
  track: { id?: string } | null;
}

/**
 * Whether a row can offer rename/tag on the track it just created.
 *
 * Only a successful upload that came back with a row id. `/complete` can
 * succeed without returning a track (the manager types it optional), and an
 * editor bound to `undefined` would PATCH `/api/tracks/undefined`.
 */
export function canEditUploadedTrack(u: FinishedUpload): boolean {
  return u.status === 'success' && typeof u.track?.id === 'string' && u.track.id.length > 0;
}
