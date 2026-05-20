'use client';

import { useEffect, useRef, useState } from 'react';
import { Track } from '@/lib/types';
import { Play, MoreHorizontal, Star, Music, Trash2, MinusCircle, Info, Download, Loader2 } from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { useRating } from '@/hooks/useRating';
import { setTrackDragData } from '@/lib/dnd';
import { cacheTrack, getCachedMeta, removeCached } from '@/lib/offline/audio-cache';
import { toast } from '@/hooks/useToast';

interface TrackCardProps {
  track: Track;
  index: number;
  onClickDetails?: (track: Track) => void;
  onPlayClick?: () => void;
  /** When provided, exposes "Remove from project/playlist" — does NOT delete the track. */
  onRemoveFromContext?: (track: Track) => void;
  removeLabel?: string;
  /** When provided, exposes "Delete from library" — destroys the track. */
  onDelete?: (track: Track) => void;
  /** When true the row renders a checkbox in the index column and the
   *  row's main click toggles selection instead of opening the drawer.
   *  Used by the library list when the user enters "Select" mode for
   *  batch delete / batch operations. */
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (track: Track, selected: boolean) => void;
}

export function TrackCard({
  track,
  index,
  onClickDetails,
  onPlayClick,
  onRemoveFromContext,
  removeLabel = 'Remove from project',
  onDelete,
  selectable = false,
  selected = false,
  onSelectChange,
}: TrackCardProps) {
  const { currentTrack, isPlaying, setTrack, togglePlay } = usePlayer();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Offline Caching integration
  const [isCached, setIsCached] = useState(false);
  const [syncProgress, setSyncProgress] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const meta = await getCachedMeta(track.id);
        setIsCached(!!meta);
      } catch (err) {
        console.error('IndexedDB read failed:', err);
      }
    })();
  }, [track.id]);

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!track.audio_url) return;
    setSyncProgress(0);
    try {
      const url = track.audio_url.startsWith('http')
        ? track.audio_url
        : `${window.location.origin}${track.audio_url}`;

      await cacheTrack(track.id, url, track.title, (loaded, total) => {
        setSyncProgress(loaded / total);
      });
      setIsCached(true);
      toast.success(`"${track.title.toUpperCase()}" cached for offline playback!`);
    } catch (err) {
      console.error('Offline caching failed:', err);
      toast.error('Sync failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncProgress(null);
    }
  };

  const handleRemoveSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeCached(track.id);
      setIsCached(false);
      toast.success(`"${track.title.toUpperCase()}" removed from local storage.`);
    } catch (err) {
      console.error('Failed to remove cache:', err);
      toast.error('Failed to delete cache');
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const isCurrent = currentTrack?.id === track.id;
  const isActive = isCurrent && isPlaying;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrent) togglePlay();
    else if (onPlayClick) onPlayClick();
    else setTrack(track);
  };

  const uploadDate = new Date(track.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const { rate: rateTrack } = useRating(track.id, track.rating || 0);

  const handleRating = (e: React.MouseEvent, star: number) => {
    e.stopPropagation();
    rateTrack(star);
  };

  const typeColor: Record<string, string> = {
    instrumental: 'text-[#E8D8B8]',
    song: 'text-[#8ecf9f]',
    remix: 'text-[#eca9a9]',
  };

  return (
    <div
      onClick={() => {
        if (selectable) onSelectChange?.(track, !selected);
        else onClickDetails?.(track);
      }}
      // Native HTML5 draggable so the user can drop tracks onto contact
      // rows (or future drop targets — playlists, projects). We don't
      // mount a heavy DnD library; the dataTransfer payload is encoded
      // through lib/dnd.ts and decoded on the target.
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setTrackDragData(e, {
          id: track.id,
          title: track.title,
          cover_url: track.cover_url ?? null,
        });
      }}
      className={`group grid grid-cols-[32px_32px_1fr_90px_32px] sm:grid-cols-[32px_32px_1fr_90px_110px_110px_32px] md:grid-cols-[32px_32px_1fr_110px_130px_50px_120px_110px_32px] items-center gap-4 px-4 h-[52px] border-b border-[#161310] hover:bg-[#101010] transition-colors cursor-pointer ${
        isCurrent ? 'bg-[#0e0c08]' : ''
      } ${selected ? 'bg-[#15132a]' : ''}`}
    >
      {/* Index — replaced by checkbox in selectable mode so the column
          retains its width and the row layout stays stable. */}
      <div className={`text-[11px] font-mono text-center tabular-nums ${isCurrent ? 'text-[#D4BFA0]' : 'text-[#3a3328]'}`}>
        {selectable ? (
          <div className={`w-4 h-4 mx-auto rounded flex items-center justify-center transition-colors ${
            selected ? 'bg-[#D4BFA0] border border-[#E8D8B8]' : 'border border-[#2d2620] hover:border-[#4a4338]'
          }`}>
            {selected && <span className="text-white text-[10px] leading-none">✓</span>}
          </div>
        ) : null}
        <div className={selectable ? 'hidden' : ''}>
        {isActive ? (
          <div className="flex gap-0.5 items-end h-3 justify-center">
            <div className="w-0.5 bg-[#D4BFA0] animate-pulse h-2" />
            <div className="w-0.5 bg-[#D4BFA0] animate-pulse h-3" style={{ animationDelay: '120ms' }} />
            <div className="w-0.5 bg-[#D4BFA0] animate-pulse h-1.5" style={{ animationDelay: '240ms' }} />
          </div>
        ) : (
          <span className="group-hover:hidden">{String(index).padStart(2, '0')}</span>
        )}
        <button
          onClick={handlePlay}
          className={`hidden ${isActive ? '' : 'group-hover:flex'} w-6 h-6 items-center justify-center rounded-full bg-white text-black hover:scale-110 transition-transform mx-auto`}
        >
          <Play size={10} fill="currentColor" className="ml-0.5" />
        </button>
        </div> {/* end !selectable inner wrap */}
      </div>

      {/* Thumbnail */}
      <div className="w-8 h-8 bg-[#16130e] rounded overflow-hidden border border-[#1a160f] shrink-0">
        {track.cover_url ? (
          <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#2d2620]">
            <Music size={12} />
          </div>
        )}
      </div>

      {/* Title */}
      <div className="min-w-0 flex items-center gap-2">
        <h4 className={`text-[13px] font-medium truncate ${isCurrent ? 'text-[#E8D8B8]' : 'text-[#E8DCC8]'}`}>
          {track.title}
        </h4>
        {isCached && (
          <span className="text-[8px] font-bold text-[#AFA9EC] bg-[#1a1833] border border-[#534AB7] rounded px-1.5 py-0.5 uppercase tracking-wider font-mono shrink-0">
            Offline
          </span>
        )}
      </div>

      {/* Type */}
      <div className={`text-[10px] font-panchang uppercase tracking-wider hidden sm:block ${typeColor[track.type] || 'text-[#6a5d4a]'}`}>
        {track.type}
      </div>

      {/* BPM / Key — BPM muted, key color-coded by scale */}
      <div className="flex items-center gap-1.5 font-mono truncate">
        <span className="text-[11px] text-[#6a5d4a] tabular-nums">{track.bpm || '—'}</span>
        {track.key && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
            track.scale === 'minor'
              ? 'text-[#9d95e8] bg-[#1a1833]/60 border border-[#534AB7]/20'
              : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/30'
          }`}>
            {track.key}{track.scale === 'minor' ? 'm' : ''}
          </span>
        )}
      </div>

      {/* Duration */}
      <div className="text-[11px] text-[#5a5142] font-mono hidden md:block tabular-nums">
        {track.duration_seconds
          ? `${Math.floor(track.duration_seconds / 60)}:${String(Math.floor(track.duration_seconds % 60)).padStart(2, '0')}`
          : '—'}
      </div>

      {/* Date */}
      <div className="text-[11px] text-[#5a5142] font-mono hidden md:block">{uploadDate}</div>

      {/* Rating stars */}
      <div className="hidden sm:flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button key={star} onClick={(e) => handleRating(e, star)} className="cursor-pointer p-0.5">
            <Star
              size={11}
              fill={track.rating && track.rating >= star ? '#c8a84b' : 'none'}
              strokeWidth={1.5}
              className={track.rating && track.rating >= star ? 'text-[#c8a84b]' : 'text-[#3a3328] hover:text-[#c8a84b] transition-colors'}
            />
          </button>
        ))}
      </div>

      {/* More */}
      <div ref={menuRef} className="relative flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="text-[#3a3328] hover:text-[#E8DCC8] transition-colors flex items-center justify-center p-1 rounded hover:bg-[#1a160f]"
          aria-label="Track actions"
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-7 z-30 w-52 bg-[#0a0907] border border-[#1f1a13] rounded-lg shadow-2xl py-1 animate-in fade-in slide-in-from-top-1"
          >
            {onClickDetails && (
              <button
                onClick={() => { setMenuOpen(false); onClickDetails(track); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-[#16130e]"
              >
                <Info size={12} className="text-[#D4BFA0]" /> View details
              </button>
            )}
            
            {isCached ? (
              <button
                onClick={(e) => { setMenuOpen(false); handleRemoveSync(e); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-amber-500 hover:bg-[#16130e]"
              >
                <MinusCircle size={12} className="text-amber-500 shrink-0" /> Remove offline cache
              </button>
            ) : (
              <button
                onClick={(e) => { handleSync(e); }}
                disabled={syncProgress !== null}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-[#16130e] disabled:opacity-50"
              >
                {syncProgress !== null ? (
                  <>
                    <Loader2 size={12} className="animate-spin text-[#7F77DD] shrink-0" />
                    <span>Syncing ({Math.round(syncProgress * 100)}%)</span>
                  </>
                ) : (
                  <>
                    <Download size={12} className="text-[#7F77DD] shrink-0" />
                    <span>Sync to device</span>
                  </>
                )}
              </button>
            )}
            {onRemoveFromContext && (
              <button
                onClick={() => { setMenuOpen(false); onRemoveFromContext(track); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-[#16130e]"
              >
                <MinusCircle size={12} className="text-[#a08a6a]" /> {removeLabel}
              </button>
            )}
            {onDelete && (
              <>
                <div className="my-1 border-t border-[#1a160f]" />
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
    </div>
  );
}
