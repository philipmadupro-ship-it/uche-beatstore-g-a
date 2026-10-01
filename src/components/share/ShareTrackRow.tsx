'use client';

import { Download, Loader2, Music, Pause, Play } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

export interface ShareRowTrack {
  id: string;
  title: string;
  type?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

/** The share's download option, as the rows need it. The server's gate still decides. */
export interface ShareRowDownload {
  allowed: boolean;
  onDownload: (track: { id: string; title: string }) => void;
  /** Track id whose download is in flight. */
  downloadingId?: string | null;
}

interface Props {
  track: ShareRowTrack;
  index: number;
  active: boolean;
  isPlaying: boolean;
  onPlay: (track: ShareRowTrack) => void;
  download?: ShareRowDownload;
}

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/**
 * One track on a share page, laid out like a library row: cover, title,
 * type · BPM · key · length, and the Download button on the row itself.
 *
 * Previously each variant drew its own list (a bare title in one, a key in
 * another) and the only Download buttons were in a separate block at the
 * bottom of the page, a scroll away from the beat they belonged to.
 *
 * The row is a `div` holding two sibling buttons, never one inside the other
 * (a button inside a button is invalid HTML): Play wraps the content and
 * Download sits beside it.
 */
export function ShareTrackRow({ track, index, active, isPlaying, onPlay, download }: Props) {
  const showPause = active && isPlaying;
  const keyLabel = track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null;
  const busy = download?.downloadingId === track.id;

  return (
    <div
      data-testid="share-track-row"
      data-active={active || undefined}
      className={`flex items-center gap-1 pr-2 transition-colors hover:bg-white/[0.04] ${
        active ? 'bg-white/[0.04]' : ''
      }`}
    >
      <button
        type="button"
        data-testid="share-track-play"
        onClick={() => onPlay(track)}
        aria-pressed={showPause}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="w-5 shrink-0 text-[9px] font-mono tabular-nums text-white/30">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#090907]">
          <ArtworkFallback src={track.cover_url} seed={track.id} kind="track" sizes="36px" className="object-cover">
            <Music size={12} aria-hidden="true" />
          </ArtworkFallback>
          {active && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50">
              {showPause
                ? <Pause size={10} fill="currentColor" className="text-white" aria-hidden="true" />
                : <Play size={10} fill="currentColor" className="ml-0.5 text-white" aria-hidden="true" />}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[11px] font-medium ${active ? 'text-white' : 'text-white/80'}`}>{track.title}</span>
          <span className="mt-0.5 block truncate text-[9px] font-mono uppercase tracking-wider text-white/40">
            {[
              track.type,
              track.bpm ? `${track.bpm} bpm` : null,
              keyLabel,
              track.duration_seconds ? fmt(track.duration_seconds) : null,
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>

      {download?.allowed && (
        <button
          type="button"
          onClick={() => download.onDownload({ id: track.id, title: track.title })}
          disabled={busy}
          aria-label={`Download ${track.title}`}
          title="Download"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.10] hover:text-white disabled:opacity-40"
        >
          {busy
            ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            : <Download size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
