'use client';

import type { ReactNode } from 'react';
import { Download, Loader2, Music } from 'lucide-react';
import { PauseGlyph, PlayGlyph } from '@/components/player/TransportIcons';
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
  active: boolean;
  isPlaying: boolean;
  onPlay: (track: ShareRowTrack) => void;
  download?: ShareRowDownload;
  /**
   * When given, the library's split applies: the cover plays and the title
   * opens details (the client variant's licence drawer). Without it the whole
   * row plays.
   */
  onOpenDetails?: (track: ShareRowTrack) => void;
  /** Small marker after the title, e.g. "In cart". */
  titleBadge?: ReactNode;
  /** Right-hand slot, e.g. the client variant's licence / price pill. */
  trailing?: ReactNode;
  /**
   * For narrow lists (a sidebar): no separate Time column, the length rides on
   * the BPM | key | type line instead, so the title keeps the width.
   */
  compact?: boolean;
}

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** Column heads for a list of {@link ShareTrackRow}s; same widths as the row. */
export function ShareTrackListHeader({ hasDownload, hasTrailing, trailingLabel, compact }: {
  hasDownload?: boolean;
  /** The rows have a trailing slot; reserve its width even when it has no label. */
  hasTrailing?: boolean;
  trailingLabel?: string;
  compact?: boolean;
}) {
  if (compact) return null;
  return (
    <div
      aria-hidden="true"
      className="hidden h-8 items-center gap-4 border border-transparent px-3 text-[9px] font-mono uppercase tracking-wider text-white/40 md:flex"
    >
      <span className="w-12 shrink-0" />
      <span className="min-w-0 flex-1">Title</span>
      <span className="w-[72px] shrink-0 text-right">Time</span>
      {hasDownload && <span className="w-8 shrink-0" />}
      {(hasTrailing || trailingLabel) && <span className="w-[140px] shrink-0 text-right">{trailingLabel}</span>}
    </div>
  );
}

/**
 * One track on a share page, laid out like a row in the library's All tracks
 * list: the same bordered row, 48px cover with the play glyph over it, a
 * semibold title, and the BPM | key | type line beneath, with the length in a
 * right-hand column. The playing row takes the same white wash.
 *
 * Download is on the row itself, when the share allows it. Previously each
 * variant drew its own list (a bare title in one, a key chip in another) and
 * the only Download buttons were in a block at the bottom of the page, a
 * scroll away from the beat they belonged to.
 *
 * The row is a `div` holding sibling buttons, never one inside another (a
 * button inside a button is invalid HTML).
 */
export function ShareTrackRow({
  track, active, isPlaying, onPlay, download, onOpenDetails, titleBadge, trailing, compact,
}: Props) {
  const showPause = active && isPlaying;
  const keyLabel = track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null;
  const busy = download?.downloadingId === track.id;
  const duration = track.duration_seconds ? fmt(track.duration_seconds) : null;

  const cover = (
    <span className="relative block h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#090907] ring-1 ring-inset ring-white/[0.06]">
      <ArtworkFallback src={track.cover_url} seed={track.id} kind="track" sizes="48px" className="object-cover">
        <Music size={13} aria-hidden="true" />
      </ArtworkFallback>
      <span className={`absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] transition-opacity ${
        active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {showPause ? <PauseGlyph size={13} /> : <PlayGlyph size={13} className="ml-0.5" />}
      </span>
    </span>
  );

  // Where the Time column is hidden (phones, or a compact list) the length
  // rides on this line, ahead of the type so a long type truncates, not it.
  const cells: { id: string; node: ReactNode; className?: string }[] = [];
  if (track.bpm) cells.push({ id: 'bpm', className: 'shrink-0', node: <span className="tabular-nums text-white/55">{track.bpm}<span className="text-white/30"> BPM</span></span> });
  if (keyLabel) cells.push({ id: 'key', className: 'shrink-0', node: <span className="text-white/55">{keyLabel}</span> });
  if (duration) cells.push({ id: 'time', className: `shrink-0 ${compact ? '' : 'md:hidden'}`, node: <span className="tabular-nums">{duration}</span> });
  if (track.type) cells.push({ id: 'type', node: <span className="truncate">{track.type}</span> });

  const text = (
    <span className="block min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] transition-colors ${
          active ? 'text-white' : 'text-white/95 group-hover:text-white'
        }`}>
          {track.title}
        </span>
        {titleBadge}
      </span>
      <span className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap text-[9px] font-mono uppercase tracking-[0.14em] text-white/40">
        {cells.map((cell, i) => (
          <span key={cell.id} className={`flex min-w-0 items-center gap-1.5 ${cell.className ?? ''}`}>
            {i > 0 ? <span aria-hidden className="h-2 w-px shrink-0 bg-white/15" /> : null}
            {cell.node}
          </span>
        ))}
        {cells.length === 0 ? <span>—</span> : null}
      </span>
    </span>
  );

  return (
    <div
      data-testid="share-track-row"
      data-active={active || undefined}
      className={`group relative flex min-h-[64px] items-center gap-3 rounded-xl border px-2 py-2 transition-colors md:gap-4 md:px-3 ${
        active
          ? 'border-white/30 bg-white/[0.08]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
      }`}
    >
      {onOpenDetails ? (
        <>
          <button
            type="button"
            data-testid="share-track-play"
            onClick={() => onPlay(track)}
            aria-label={`${showPause ? 'Pause' : 'Play'} ${track.title}`}
            aria-pressed={showPause}
            className="shrink-0"
          >
            {cover}
          </button>
          <button
            type="button"
            onClick={() => onOpenDetails(track)}
            className="min-w-0 flex-1 text-left"
          >
            {text}
          </button>
        </>
      ) : (
        <button
          type="button"
          data-testid="share-track-play"
          onClick={() => onPlay(track)}
          aria-pressed={showPause}
          className="flex min-w-0 flex-1 items-center gap-3 text-left md:gap-4"
        >
          {cover}
          {text}
        </button>
      )}

      {!compact && (
        <span className="hidden w-[72px] shrink-0 text-right text-[11px] font-mono tabular-nums text-white/40 md:block">
          {duration ?? '—'}
        </span>
      )}

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

      {trailing && <div className="flex shrink-0 items-center justify-end md:w-[140px]">{trailing}</div>}
    </div>
  );
}
