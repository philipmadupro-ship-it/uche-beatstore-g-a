'use client';

import { useEffect, useRef, useState } from 'react';
import { Track } from '@/lib/types';
import { Music, Star, MoreHorizontal, Trash2, MinusCircle, Info, Share2 } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { usePlayer } from '@/hooks/usePlayer';
import { useRating } from '@/hooks/useRating';
import { setTrackDragData } from '@/lib/dnd';

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
  beat: 'text-[#D0C3AF]',
  instrumental: 'text-[#F3E6D1]',
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { rate: rateTrack } = useRating(track.id, track.rating || 0);

  const isCurrent = currentTrack?.id === track.id;
  const isActive = isCurrent && isPlaying;
  const isMinor = track.scale === 'minor';

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

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
      className={`group relative flex flex-col cursor-pointer ${selected ? 'ring-2 ring-[#E7D7BE]/60 rounded-xl' : ''}`}
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
          ? 'border-[#E7D7BE]/40 shadow-lg shadow-[#E7D7BE]/10'
          : selected
            ? 'border-[#E7D7BE]/50'
            : 'border-[#211F1A] group-hover:border-[#3B372F]'
      }`}>
        {track.cover_url ? (
          <img
            loading="lazy"
            src={track.cover_url}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#342F27] to-[#090907] flex items-center justify-center">
            <Music size={28} className="text-[#3B372F]" />
          </div>
        )}

        {/* Playing equalizer overlay */}
        {isActive && (
          <div className="absolute inset-0 bg-black/30 flex items-end justify-center pb-3">
            <div className="flex gap-0.5 items-end h-5">
              <div className="w-1 bg-[#E7D7BE] rounded-full animate-pulse" style={{ height: '60%' }} />
              <div className="w-1 bg-[#E7D7BE] rounded-full animate-pulse" style={{ height: '100%', animationDelay: '120ms' }} />
              <div className="w-1 bg-[#E7D7BE] rounded-full animate-pulse" style={{ height: '40%', animationDelay: '240ms' }} />
              <div className="w-1 bg-[#E7D7BE] rounded-full animate-pulse" style={{ height: '80%', animationDelay: '60ms' }} />
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
              className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-2xl"
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
            selected ? 'bg-[#E7D7BE] border-[#F3E6D1]' : 'bg-black/50 border-white/20'
          }`}>
            {selected && <span className="text-black text-[10px] font-bold leading-none">✓</span>}
          </div>
        )}

        {/* BPM + Key badges — bottom left on hover */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {track.bpm && (
            <span className="text-[8px] font-mono font-bold bg-black/70 backdrop-blur-sm text-[#F3E6D1] px-1.5 py-0.5 rounded tabular-nums">
              {track.bpm}
            </span>
          )}
          {track.key && (
            <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded backdrop-blur-sm ${
              isMinor
                ? 'text-[#9d95e8] bg-[#1a1833]/80 border border-[#534AB7]/40'
                : 'text-[#c8a47a] bg-[#1f1a10]/80 border border-[#3d3020]/50'
            }`}>
              {track.key}{isMinor ? 'm' : ''}
            </span>
          )}
        </div>

        {/* More button — top right on hover */}
        {!selectable && (
          <div
            ref={menuRef}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-30 w-48 bg-[#090907] border border-[#2B2821] rounded-lg shadow-2xl py-1 animate-in fade-in slide-in-from-top-1">
                {onClickDetails && (
                  <button
                    onClick={() => { setMenuOpen(false); onClickDetails(track); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-[#F7EBDD] hover:bg-[#1A1813]"
                  >
                    <Info size={12} className="text-[#E7D7BE]" /> View details
                  </button>
                )}
                {onShare && (
                  <button
                    onClick={() => { setMenuOpen(false); onShare(track); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-[#F7EBDD] hover:bg-[#1A1813]"
                  >
                    <Share2 size={12} className="text-[#E7D7BE]" /> Share track
                  </button>
                )}
                {onRemoveFromContext && (
                  <button
                    onClick={() => { setMenuOpen(false); onRemoveFromContext(track); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-[#F7EBDD] hover:bg-[#1A1813]"
                  >
                    <MinusCircle size={12} className="text-[#D0C3AF]" /> {removeLabel}
                  </button>
                )}
                {onDelete && (
                  <>
                    <div className="my-1 border-t border-[#211F1A]" />
                    <button
                      onClick={() => { setMenuOpen(false); onDelete(track); }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-red-400 hover:bg-red-950/30"
                    >
                      <Trash2 size={12} /> Delete from library
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Meta below art */}
      <div className="px-0.5">
        <h4 className={`text-[13px] font-semibold truncate leading-tight mb-1 transition-colors ${
          isCurrent ? 'text-[#F3E6D1]' : 'text-[#F7EBDD] group-hover:text-white'
        }`}>
          {track.title}
        </h4>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[9px] font-mono uppercase tracking-wider ${TYPE_COLOR[track.type] || 'text-[#B4AA99]'}`}>
            {track.type}
          </span>
          {/* Star rating inline */}
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={(e) => handleRating(e, star)} className="p-0.5">
                <Star
                  size={9}
                  fill={track.rating && track.rating >= star ? '#D6BE7A' : 'none'}
                  strokeWidth={1.5}
                  className={track.rating && track.rating >= star ? 'text-[#D6BE7A]' : 'text-[#3B372F] hover:text-[#D6BE7A] transition-colors'}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
