'use client';

import type { ReactNode } from 'react';
import { Lock, MessageSquare, Edit3, Headphones } from 'lucide-react';
import { playbackLabel } from '@/lib/share/playback';

interface Props {
  /** share.allow_downloads: the server's download gate decides; this only words the notice. */
  allowDownloads: boolean;
  /** share.full_playback: tells the listener whether they are hearing the whole beat. */
  fullPlayback: boolean;
  /**
   * Project shares only: the recipient's role unlocks comments (commenter)
   * or comments + editing (editor). Opens the collaboration view.
   */
  collaboration?: { role: 'commenter' | 'editor'; commentCount: number; onOpen: () => void } | null;
  /** More actions that belong in the same strip (Copy link, Buy). */
  children?: ReactNode;
}

const PILL = 'inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-white transition-all hover:border-white/[0.12] hover:bg-white/[0.08] sm:gap-2 sm:px-4';

/**
 * The share options that are not per track, as the action strip of the share
 * header: the playback-mode label, the downloads-off notice, the collaboration
 * entry for commenter and editor roles, and whatever the page adds (Copy link,
 * Buy).
 *
 * The downloads themselves are NOT here. Each track's Download button is on
 * its own row; this block used to repeat every track under a "Downloads"
 * heading, which on a 50-beat share was a second 50-line list to scroll past.
 * (And until 2026-09-29 no variant had a download control at all, so "Allow
 * downloads" did nothing on any share.)
 */
export function ShareActions({ allowDownloads, fullPlayback, collaboration, children }: Props) {
  return (
    <div data-testid="share-actions" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      {children}
      {collaboration && (
        <button type="button" onClick={collaboration.onOpen} className={PILL}>
          {collaboration.role === 'editor' ? <Edit3 size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}
          {collaboration.role === 'editor' ? 'Comment & edit' : 'Leave feedback'}
          {collaboration.commentCount > 0 && <span className="text-white/40">({collaboration.commentCount})</span>}
        </button>
      )}
      <span
        data-testid="share-playback-mode"
        className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.02] px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-white/60 sm:text-[10px]"
      >
        <Headphones size={11} aria-hidden="true" />
        {playbackLabel(fullPlayback)}
      </span>
      {!allowDownloads && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.02] px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] text-white/60 sm:text-[10px]">
          <Lock size={11} aria-hidden="true" />
          Downloads are off for this link.
        </span>
      )}
    </div>
  );
}
