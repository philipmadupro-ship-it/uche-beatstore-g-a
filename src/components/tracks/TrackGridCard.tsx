'use client';

import { Track } from '@/lib/types';
import { Music, Star, MoreHorizontal, Trash2, MinusCircle, Info, Share2 } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { Popover } from '@/components/ui/Popover';
import { usePlayer } from '@/hooks/usePlayer';
import { useRating } from '@/hooks/useRating';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { setTrackDragData } from '@/lib/dnd';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

interface TrackGridCardProps {
  track: Track;
  onClickDetails?: (track: Track) => void;
  onPlayClick?: () => void;
  onRemoveFromContext?: (track: Track) => void;
  removeLabel?: string;
  onDelete?: (track: Track) => void;
  onShare?: (track: Track) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (track: Track, selected: boolean) => void;
}

const TYPE_COLOR: Record<string, string> = {
  beat: 'text-white/80',
  instrumental: 'text-white',
  song: 'text-[#8ecf9f]',
  remix: 'text-[#eca9a9]',
};

export function TrackGridCard({
  track,
  onClickDetails,
  onPlayClick,
  onRemoveFromContext,
  removeLabel = 'Remove from project',
  onDelete,
  onShare,
  selectable = false,
  selected = false,
  onSelectChange,
}: TrackGridCardProps) {
  const { currentTrack, isPlaying, setTrack, togglePlay } = usePlayer();
  const { rate: rateTrack } = useRating(track.id, track.rating || 0);
  const reducedMotion = useReducedMotion();

  const isCurrent = currentTrack?.id === track.id;
  const isActive = isCurrent && isPlaying;
  const isMinor = track.scale === 'minor';

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrent) togglePlay();
    else if (onPlayClick) onPlayClick();
    else setTrack(track);
  };

  const handleCardClick = () => {
    if (selectable) onSelectChange?.(track, !selected);
    else onClickDetails?.(track);
  };

  const handleRating = (e: React.MouseEvent, star: number) => {
    e.stopPropagation();
    rateTrack(star);
  };

  return (
    <div
      className={`group relative flex flex-col cursor-pointer ${selected ? 'ring-2 ring-white/60 rounded-xl' : ''}`}
      onClick={handleCardClick}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setTrackDragData(e, { id: track.id, title: track.title, cover_url: track.cover_url ?? null });
      }}
    >
      {/* Cover art */}
      <div className={`relative aspect-square rounded-xl overflow-hidden border transition-all duration-200 mb-2.5 ${
        isCurrent
          ? 'border-[#D4BFA0]/45 shadow-lg shadow-[#D4BFA0]/15'
          : selected
            ? 'border-white/20'
            : 'border-white/10 group-hover:border-white/20'
      }`}>
        {/* No cover falls back to the producer's default artwork, and past
            that to a gradient built from their brand palette and seeded by
            this track's id — so a coverless catalogue still looks deliberate
            rather than like forty grey music glyphs. */}
        <ArtworkFallback
          src={track.cover_url}
          seed={track.id}
          gradientOnly
          sizes="(max-width: 640px) 50vw, 220px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        >
          <Music size={28} aria-hidden />
        </ArtworkFallback>

        {/* Playing equalizer overlay */}
        {isActive && (
          <div className="absolute inset-0 bg-black/30 flex items-end justify-center pb-3">
            <div className="flex gap-0.5 items-end h-5" aria-hidden>
              {[
                { h: '60%', d: '0ms' },
                { h: '100%', d: '120ms' },
                { h: '40%', d: '240ms' },
                { h: '80%', d: '60ms' },
              ].map((bar) => (
                <div
                  key={bar.d}
                  className={`w-1 rounded-full bg-[#D4BFA0] ${reducedMotion ? '' : 'animate-pulse'}`}
                  style={{ height: bar.h, animationDelay: reducedMotion ? undefined : bar.d }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Hover overlay — play button */}
        {!selectable && (
          <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-200 ${
            isActive ? 'opacity-0 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}>
            <button
              onClick={handlePlay}
              className="glass-play glass-play-surface w-14 h-14 rounded-full flex items-center justify-center"
            >
              {isActive ? (
                <PauseGlyph size={20} />
              ) : (
                <PlayGlyph size={20} className="ml-0.5" />
              )}
            </button>
          </div>
        )}

        {/* Selection checkbox */}
        {selectable && (
          <div className={`absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center backdrop-blur-md border transition-colors ${
            selected ? 'bg-white border-white/30' : 'bg-black/50 border-white/20'
          }`}>
            {selected && <span className="text-black text-[10px] font-bold leading-none">✓</span>}
          </div>
        )}

        {/* BPM + Key badges — bottom left on hover */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {track.bpm && (
            <span className="text-[8px] font-mono font-bold bg-black/70 backdrop-blur-sm text-white px-1.5 py-0.5 rounded tabular-nums">
              {track.bpm}
            </span>
          )}
          {track.key && (
            <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded backdrop-blur-sm ${
              isMinor
                ? 'text-[#c8a47a] bg-[#1f1a10]/80 border border-[#3d3020]/40'
                : 'text-[#c8a47a] bg-[#1f1a10]/80 border border-[#3d3020]/50'
            }`}>
              {track.key}{isMinor ? 'm' : ''}
            </span>
          )}
        </div>

        {/* More button — top right on hover. Portaled via Popover so the menu
            escapes the artwork's overflow-hidden clip (was invisible before). */}
        {!selectable && (
          <div
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <Popover
              align="right"
              width={192}
              trigger={({ toggle, ref }) => (
                <button
                  ref={ref as (el: HTMLButtonElement | null) => void}
                  onClick={(e) => { e.stopPropagation(); toggle(); }}
                  className="w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-colors"
                  aria-label="Track actions"
                >
                  <MoreHorizontal size={13} />
                </button>
              )}
            >
              {(close) => (
                <>
                  {onClickDetails && (
                    <button
                      onClick={() => { close(); onClickDetails(track); }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A]"
                    >
                      <Info size={12} className="text-white" /> View details
                    </button>
                  )}
                  {onShare && (
                    <button
                      onClick={() => { close(); onShare(track); }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A]"
                    >
                      <Share2 size={12} className="text-white" /> Share track
                    </button>
                  )}
                  {onRemoveFromContext && (
                    <button
                      onClick={() => { close(); onRemoveFromContext(track); }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A]"
                    >
                      <MinusCircle size={12} className="text-white/80" /> {removeLabel}
                    </button>
                  )}
                  {onDelete && (
                    <>
                      <div className="my-1 border-t border-white/10" />
                      <button
                        onClick={() => { close(); onDelete(track); }}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-red-400 hover:bg-red-950/30"
                      >
                        <Trash2 size={12} /> Delete from library
                      </button>
                    </>
                  )}
                </>
              )}
            </Popover>
          </div>
        )}
      </div>

      {/* Meta below art */}
      <div className="px-0.5">
        <h4 className={`text-[13px] font-semibold truncate leading-tight mb-1 transition-colors ${
          isCurrent ? 'text-white' : 'text-white group-hover:text-white'
        }`}>
          {track.title}
        </h4>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[9px] font-mono uppercase tracking-wider ${TYPE_COLOR[track.type] || 'text-white/60'}`}>
            {track.type}
          </span>
          {/* Star rating inline */}
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={(e) => handleRating(e, star)} className="p-0.5">
                <Star
                  size={9}
                  fill={track.rating && track.rating >= star ? '#FFFFFF' : 'none'}
                  strokeWidth={1.5}
                  className={track.rating && track.rating >= star ? 'text-white' : 'text-white/30 hover:text-white transition-colors'}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
