'use client';

import Link from 'next/link';
import { Music } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import type { BuyerLibraryTrackSummary } from '@/lib/store/buyer-library';

function formatTrackMeta(track: BuyerLibraryTrackSummary | null): string {
  if (!track) return 'Unavailable';
  const parts = [
    track.bpm ? `${track.bpm} BPM` : null,
    track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null,
    track.type,
  ].filter(Boolean);
  return parts.join(' · ') || 'Beat';
}

export function BuyerLibraryTile({
  track,
  subline,
}: {
  track: BuyerLibraryTrackSummary | null;
  subline?: string;
}) {
  const href = track ? `/store/${track.id}` : '/store';
  const title = track?.title?.trim() || (track ? 'Untitled beat' : 'Beat unavailable');

  return (
    <Link
      href={href}
      aria-label={track ? `Open ${title}` : 'Browse available beats'}
      className="group flex min-h-[72px] gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2 transition-colors hover:border-white/20 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-[#090907] text-white/40">
        {track?.cover_url ? (
          <CoverImage
            src={track.cover_url}
            alt=""
            className="object-cover"
            sizes="48px"
          />
        ) : (
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
  );
}

export function buyerTrackTitles(tracks: BuyerLibraryTrackSummary[], limit = 3): string {
  const titles = tracks
    .map((track) => track.title?.trim() || 'Untitled beat')
    .filter(Boolean)
    .slice(0, limit);
  return titles.length > 0 ? titles.join(' · ') : 'No saved tracks yet';
}
