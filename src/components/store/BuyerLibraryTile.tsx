'use client';

import Link from 'next/link';
import { Music, Pause, Play } from 'lucide-react';
import type { BuyerLibraryTrackSummary } from '@/lib/store/buyer-library';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

function formatTrackMeta(track: BuyerLibraryTrackSummary | null): string {
  if (!track) return 'Unavailable';
  const parts = [
    track.bpm ? `${track.bpm} BPM` : null,
    track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null,
    track.type,
  ].filter(Boolean);
  return parts.join(' · ') || 'Beat';
}

/**
 * Icon-only play/pause for a beat in the buyer's account. It drives the
 * global player (the caller owns that), so it only reports the click.
 */
export function BuyerPlayButton({
  title,
  playing,
  onToggle,
  className = '',
}: {
  title: string;
  playing: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${playing ? 'Pause' : 'Play'} ${title}`}
      className={`flex items-center justify-center text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${className}`}
    >
      {playing
        ? <Pause size={13} fill="currentColor" aria-hidden="true" />
        : <Play size={13} fill="currentColor" aria-hidden="true" className="ml-0.5" />}
    </button>
  );
}

export function BuyerLibraryTile({
  track,
  subline,
  playing = false,
  onPlay,
}: {
  track: BuyerLibraryTrackSummary | null;
  subline?: string;
  /** This beat is the one the global player is playing right now. */
  playing?: boolean;
  /** Present = the cover carries a play button. Absent (or no track) = none. */
  onPlay?: () => void;
}) {
  const href = track ? `/store/${track.id}` : '/store';
  const title = track?.title?.trim() || (track ? 'Untitled beat' : 'Beat unavailable');

  return (
    // The play button is a SIBLING of the link, never inside it: a <button>
    // in an <a> is invalid and the browser decides which one a click hits.
    <div className="relative">
    <Link
      href={href}
      aria-label={track ? `Open ${title}` : 'Browse available beats'}
      className="group flex min-h-[72px] gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2 transition-colors hover:border-white/20 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-[#090907] text-white/40">
        {track ? (
          <ArtworkFallback src={track.cover_url} seed={track.id} kind="track" sizes="48px" className="object-cover">
            <Music size={13} aria-hidden="true" />
          </ArtworkFallback>
        ) : (
          // No track at all — this is the "browse beats" placeholder tile,
          // which should stay a glyph rather than impersonate a release.
          <Music size={13} />
        )}
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block truncate text-[11px] font-medium text-white group-hover:text-white">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[9px] font-mono text-white/45">
          {subline ?? formatTrackMeta(track)}
        </span>
        {subline && (
          <span className="mt-0.5 block truncate text-[9px] font-mono text-white/35">
            {formatTrackMeta(track)}
          </span>
        )}
      </span>
    </Link>
    {track && onPlay && (
      <BuyerPlayButton
        title={title}
        playing={playing}
        onToggle={onPlay}
        className="absolute left-2 top-2 size-12 rounded-md bg-black/40 hover:bg-black/60"
      />
    )}
    </div>
  );
}

export function buyerTrackTitles(tracks: BuyerLibraryTrackSummary[], limit = 3): string {
  const titles = tracks
    .map((track) => track.title?.trim() || 'Untitled beat')
    .filter(Boolean)
    .slice(0, limit);
  return titles.length > 0 ? titles.join(' · ') : 'No saved tracks yet';
}
