'use client';

import { Download, Loader2, Lock, MessageSquare, Edit3, Headphones } from 'lucide-react';
import { playbackLabel } from '@/lib/share/playback';

interface ActionTrack {
  id: string;
  title: string;
}

interface Props {
  tracks: ActionTrack[];
  /** share.allow_downloads — the server's download gate decides; this only hides the buttons. */
  allowDownloads: boolean;
  onDownload: (track: ActionTrack) => void;
  /** Track id whose download is in flight. */
  downloadingId?: string | null;
  /** share.full_playback: tells the listener whether they are hearing the whole beat. */
  fullPlayback: boolean;
  /**
   * Project shares only: the recipient's role unlocks comments (commenter)
   * or comments + editing (editor). Opens the collaboration view.
   */
  collaboration?: { role: 'commenter' | 'editor'; commentCount: number; onOpen: () => void } | null;
}

/**
 * The share options the producer set, honoured in every recipient variant.
 *
 * The variants (client / producer / rapper / friend) are skins. Downloads,
 * the playback mode and the collaboration entry are the same everywhere, so
 * they live here once. They used to exist only in the page's default layout,
 * which no share ever reaches: `recipient_kind` is NOT NULL DEFAULT 'client'.
 * So "Allow downloads" did nothing on any share.
 */
export function ShareActions({ tracks, allowDownloads, onDownload, downloadingId, fullPlayback, collaboration }: Props) {
  return (
    <section
      aria-label="Share options"
      data-testid="share-actions"
      className="w-full mt-10 rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5 text-left"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
          {allowDownloads ? 'Downloads' : 'This link'}
        </p>
        <span
          data-testid="share-playback-mode"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60"
        >
          <Headphones size={11} aria-hidden="true" />
          {playbackLabel(fullPlayback)}
        </span>
      </div>

      {allowDownloads ? (
        <ul className="mt-3 divide-y divide-white/10">
          {tracks.map((t) => {
            const busy = downloadingId === t.id;
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-[11px] text-white/80">{t.title}</span>
                <button
                  type="button"
                  onClick={() => onDownload(t)}
                  disabled={busy}
                  aria-label={`Download ${t.title}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:opacity-40"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />}
                  {busy ? 'Downloading' : 'Download'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-white/60">
          <Lock size={11} aria-hidden="true" />
          Downloads are off for this link.
        </p>
      )}

      {collaboration && (
        <button
          type="button"
          onClick={collaboration.onOpen}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white"
        >
          {collaboration.role === 'editor' ? <Edit3 size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}
          {collaboration.role === 'editor' ? 'Comment & edit' : 'Leave feedback'}
          {collaboration.commentCount > 0 && (
            <span className="text-white/40">({collaboration.commentCount})</span>
          )}
        </button>
      )}
    </section>
  );
}
