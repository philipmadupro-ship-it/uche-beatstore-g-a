/**
 * Single source of truth for "what does a save-offline control show right
 * now" — the offline-download analogue of `lib/upload/row-actions.ts`'s
 * `uploadRowActions(status)`.
 *
 * `OfflineToggle` (the button/compact toggle) and `TrackCard`'s ⋯ menu item
 * used to each keep their own copy of `isCached`/`downloading`/`error` state
 * and derive their own label from it. That let the two surfaces disagree —
 * one said "Sync to device", the other "Save offline" for the same track in
 * the same state. Both now derive from `useOfflineTrack` (lib/hooks/useOfflineCache.ts)
 * and read the same `OfflineStatus` + label/announcement functions here.
 */

export type OfflineStatus = 'idle' | 'downloading' | 'cached' | 'error';

export interface OfflineTrackState {
  isCached: boolean;
  downloading: boolean;
  error: string | null;
}

export function deriveOfflineStatus(state: OfflineTrackState): OfflineStatus {
  if (state.downloading) return 'downloading';
  if (state.isCached) return 'cached';
  if (state.error) return 'error';
  return 'idle';
}

/** Label for the primary control — button text, compact-icon title, or the
 *  ⋯ menu item's label. `progress` is only read for the `downloading` state. */
export function offlineActionLabel(status: OfflineStatus, progress: number): string {
  switch (status) {
    case 'downloading':
      return `Saving offline… ${Math.round(progress * 100)}%`;
    case 'cached':
      return 'Remove offline copy';
    case 'error':
      return 'Retry save offline';
    case 'idle':
    default:
      return 'Save offline';
  }
}

export function formatOfflineSize(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Screen-reader text for a STATUS TRANSITION, not a percentage tick.
 *
 * Callers (the `useOfflineTrack` hook) only produce this when the derived
 * status actually changes value between renders — announcing every progress
 * update would fire the `role="status"` region dozens of times over a ten
 * second download, which is unusable. Returns `null` for `idle`: idle covers
 * both "never saved" (nothing to announce) and "just removed" (see
 * `offlineRemovedAnnouncement`, which is a distinct, explicit user action
 * rather than a status this function can distinguish from the initial state).
 */
export function offlineStatusAnnouncement(
  status: OfflineStatus,
  ctx: { title: string; sizeLabel?: string | null; error?: string | null },
): string | null {
  switch (status) {
    case 'downloading':
      return `Saving "${ctx.title}" for offline playback…`;
    case 'cached':
      return `"${ctx.title}" saved offline${ctx.sizeLabel ? ` · ${ctx.sizeLabel}` : ''}.`;
    case 'error':
      return `Couldn't save "${ctx.title}" offline${ctx.error ? `: ${ctx.error}` : ''}.`;
    case 'idle':
    default:
      return null;
  }
}

/** Announced right after an explicit removal resolves. Kept separate from
 *  `offlineStatusAnnouncement` because the resulting status (`idle`) is
 *  indistinguishable from "never saved" — this is a direct call site, not a
 *  derived transition. */
export function offlineRemovedAnnouncement(title: string): string {
  return `"${title}" removed from offline storage.`;
}
