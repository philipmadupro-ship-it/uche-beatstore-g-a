'use client';

import { useMemo } from 'react';
import { Music } from 'lucide-react';
import type { Track } from '@/lib/types';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { PlayGlyph } from '@/components/player/TransportIcons';

type TrackWithInlineTags = Track & { track_tags?: Array<{ tag: string; category?: string | null }> };

/**
 * Compact card for the Library's Sections (browse) rows.
 *
 * Moved out of `app/(dashboard)/library/page.tsx` unchanged so it can be
 * tested; the ⋯ menu is the only addition. Like the list, grid and portfolio
 * menus, each item appears only when the caller wires it, so a menu with
 * nothing wired renders no trigger at all (ActionMenu's own rule).
 */
export function MiniTrackCard({
  track,
  isCurrent,
  isPlaying,
  onPlay,
  onOpen,
  onOpenLyrics,
  onOpenStudio,
}: {
  track: Track;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onOpen: () => void;
  onOpenLyrics?: (track: Track) => void;
  onOpenStudio?: (track: Track) => void;
}) {
  const reducedMotion = useReducedMotion();
  // Genre first, then mood — the gradient leads on the first entry, so a
  // Browse row of one genre comes out as one colour family.
  const artworkTags = useMemo(() => {
    const tags = (track as TrackWithInlineTags).track_tags ?? [];
    return [
      ...tags.filter((t) => t.category === 'genre').map((t) => t.tag),
      ...tags.filter((t) => t.category === 'mood').map((t) => t.tag),
    ];
  }, [track]);
  return (
    <div
      className="group relative shrink-0 w-[112px] sm:w-[132px] cursor-pointer"
      onClick={onOpen}
    >
      {/* Cover art + overlays */}
      <div className={`relative w-full aspect-square rounded-xl overflow-hidden bg-white/[0.04] border mb-2 transition-all ${isCurrent ? 'border-white/60 ring-1 ring-white/30' : 'border-white/10 group-hover:border-white/20'}`}>
        <ArtworkFallback src={track.cover_url} seed={track.id} alt={track.title} kind="track" tags={artworkTags} className="object-cover">
          <Music size={24} aria-hidden />
        </ArtworkFallback>
        {/* State badge */}
        {track.status && track.status !== 'archived' && (
          <span className={`absolute top-1.5 left-1.5 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
            track.status === 'maq'        ? 'bg-[#1f1a10] text-[#c8a47a] border-[#3d3020]/40' :
            track.status === 'finished'   ? 'bg-[#0a1f0a] text-[#8ecf9f] border-[#1f3a1f]'   :
            track.status === 'needs_work' ? 'bg-[#1f1a0a] text-white border-[#3a2f1f]'   : ''
          }`}>
            {track.status === 'maq' ? 'MAQ' : track.status === 'finished' ? '✓' : 'WIP'}
          </span>
        )}
        {/* Play overlay */}
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          className={`absolute inset-0 flex items-center justify-center transition-all ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          aria-label="Play"
        >
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
            {isPlaying
              ? <div className="flex items-end gap-[2px] h-4">{[3,5,7,5,3].map((h,i)=><span key={i} className={`w-[3px] rounded-sm bg-white ${reducedMotion ? '' : 'animate-bounce'}`} style={{height:h,animationDelay:`${i*80}ms`}}/>)}</div>
              : <PlayGlyph size={15} className="text-white ml-0.5" />}
          </div>
        </button>
        {/* ⋯ menu — above the full-cover play overlay (z-10), revealed on
            hover like the grid card, on focus-within so a keyboard user
            never tabs onto an invisible trigger, and always on touch screens,
            which have no hover to reveal it. The wrapper swallows the
            click so opening the menu neither plays nor opens the card. */}
        <div
          className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <ActionMenu
            align="right"
            width={248}
            label={`Actions for ${track.title}`}
            triggerClassName="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
            sections={[{
              id: 'open',
              items: [
                {
                  id: 'lyrics', label: 'Lyrics Studio', shortcut: 'L', shortcutKey: 'l',
                  hidden: !onOpenLyrics, onSelect: () => onOpenLyrics?.(track),
                },
                {
                  id: 'studio', label: 'Send to studio', shortcut: 'S', shortcutKey: 's',
                  hidden: !onOpenStudio, onSelect: () => onOpenStudio?.(track),
                },
              ],
            }]}
          />
        </div>
      </div>
      {/* Meta */}
      <p className={`text-[11px] font-medium truncate leading-tight ${isCurrent ? 'text-white' : 'text-white'}`}>{track.title}</p>
      <p className="text-[9px] font-mono text-white/50 mt-0.5 truncate">
        {[track.bpm && `${track.bpm}`, track.key && `${track.key}${track.scale === 'minor' ? 'm' : ''}`].filter(Boolean).join(' · ') || track.type || '—'}
      </p>
    </div>
  );
}
