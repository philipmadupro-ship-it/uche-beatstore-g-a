'use client';

import { useEffect, useRef, useState } from 'react';
import { Track } from '@/lib/types';
import { MoreHorizontal, Star, Music, Trash2, MinusCircle, Info, Download, Loader2, Share2, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
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
  /** When provided, exposes "Share track" in the context menu. */
  onShare?: (track: Track) => void;
  /** When true the row renders a checkbox in the index column and the
   *  row's main click toggles selection instead of opening the drawer.
   *  Used by the library list when the user enters "Select" mode for
   *  batch delete / batch operations. */
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (track: Track, selected: boolean) => void;
  /** Controls what a press on the row body does. Library keeps details; project/playlist rows play. */
  rowAction?: 'details' | 'play';
  /** In music-first contexts, selection lives only on the explicit select button. */
  selectionBehavior?: 'row' | 'button';
  /** Disable track dragging where the row press should feel purely like playback. */
  draggableTrack?: boolean;
  /** Store reorder mode — show ↑/↓ arrows in the index column */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  moveControls?: 'cell' | 'menu';
  isFirstInOrder?: boolean;
  isLastInOrder?: boolean;
}

type TrackTag = {
  tag: string;
  category?: string | null;
};

type TrackWithInlineTags = Track & {
  track_tags?: TrackTag[];
};

export function TrackCard({
  track,
  index,
  onClickDetails,
  onPlayClick,
  onRemoveFromContext,
  removeLabel = 'Remove from project',
  onDelete,
  onShare,
  selectable = false,
  selected = false,
  onSelectChange,
  rowAction = 'details',
  selectionBehavior = 'row',
  draggableTrack = true,
  onMoveUp,
  onMoveDown,
  moveControls = 'cell',
  isFirstInOrder = false,
  isLastInOrder = false,
}: TrackCardProps) {
  void index;
  const { currentTrack, isPlaying, setTrack, togglePlay } = usePlayer();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const trackTags = (track as TrackWithInlineTags).track_tags ?? [];
  const stemStatus = track.stems_status as string | null | undefined;
  const hasCompletedStems = stemStatus === 'done' || stemStatus === 'completed';

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

  const playTrack = () => {
    if (isCurrent) togglePlay();
    else if (onPlayClick) onPlayClick();
    else setTrack(track);
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    playTrack();
  };

  const handleRowPress = () => {
    if (selectable && selectionBehavior === 'row') {
      onSelectChange?.(track, !selected);
      return;
    }
    if (rowAction === 'play') playTrack();
    else onClickDetails?.(track);
  };

  const uploadDate = new Date(track.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const { rate: rateTrack } = useRating(track.id, track.rating || 0);
  const durationLabel = formatDuration(track.duration_seconds ?? null);
  const genreMoodTags = trackTags.filter((tt) => tt.category === 'genre' || tt.category === 'mood');

  const handleRating = (e: React.MouseEvent, star: number) => {
    e.stopPropagation();
    rateTrack(star);
  };

  return (
    <div
      onClick={handleRowPress}
      // Native HTML5 draggable so the user can drop tracks onto contact
      // rows (or future drop targets — playlists, projects). We don't
      // mount a heavy DnD library; the dataTransfer payload is encoded
      // through lib/dnd.ts and decoded on the target.
      draggable={draggableTrack}
      onDragStart={(e) => {
        if (!draggableTrack) return;
        e.stopPropagation();
        setTrackDragData(e, {
          id: track.id,
          title: track.title,
          cover_url: track.cover_url ?? null,
        });
      }}
      className={`group relative grid min-h-[56px] grid-cols-[40px_minmax(0,1fr)_32px] items-center gap-3 rounded-lg px-2.5 py-2 transition-colors cursor-pointer md:grid-cols-[40px_minmax(0,1.45fr)_minmax(0,1fr)_70px_112px_32px] md:gap-4 md:px-3 ${
        isCurrent
          ? 'bg-white/[0.06] shadow-[inset_2px_0_0_#FFFFFF]'
          : selected
            ? 'bg-white/[0.08]'
            : 'hover:bg-white/[0.04]'
      }`}
    >
      {/* Cover/play cell — mirrors the Store list row. In select or store
          order mode this cell becomes the control, keeping actions left. */}
      <div
        className="relative z-10"
        onClick={(e) => { if (onMoveUp || onMoveDown || selectable) e.stopPropagation(); }}
      >
        {(onMoveUp !== undefined || onMoveDown !== undefined) && moveControls === 'cell' ? (
          <div className="flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-lg border border-white/10 bg-[#090907]/80">
            <button
              type="button"
              disabled={isFirstInOrder}
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
              className={`p-0.5 rounded transition-colors ${isFirstInOrder ? 'text-white/20 cursor-default' : 'text-white/40 hover:text-white hover:bg-white/20'}`}
              aria-label="Move up"
            >
              <ChevronUp size={11} />
            </button>
            <button
              type="button"
              disabled={isLastInOrder}
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
              className={`p-0.5 rounded transition-colors ${isLastInOrder ? 'text-white/20 cursor-default' : 'text-white/40 hover:text-white hover:bg-white/20'}`}
              aria-label="Move down"
            >
              <ChevronDown size={11} />
            </button>
          </div>
        ) : selectable ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectChange?.(track, !selected); }}
            className={`h-10 w-10 rounded-lg flex items-center justify-center transition-colors ${
            selected ? 'bg-white border border-white/30 text-black' : 'border border-white/ bg-[#090907]/70 text-white/30 hover:border-white/30 hover:text-white/80'
          }`}
            aria-pressed={selected}
            aria-label={selected ? 'Deselect track' : 'Select track'}
          >
            {selected ? <Check size={14} strokeWidth={2.5} /> : <span className="h-3.5 w-3.5 rounded-[4px] border border-current" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlay}
            className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#090907] text-white"
            aria-label={isActive ? 'Pause track' : 'Play track'}
          >
            {track.cover_url ? (
              <CoverImage src={track.cover_url} sizes="40px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/30">
                <Music size={13} />
              </div>
            )}
            <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {isActive ? <PauseGlyph size={13} /> : <PlayGlyph size={13} className="ml-0.5" />}
            </span>
          </button>
        )}
      </div>

      {/* Title + core metadata */}
      <div className="relative z-10 min-w-0">
        <h4 className={`truncate text-[14px] font-semibold leading-tight ${isCurrent ? 'text-white' : 'text-white'}`}>
          {track.title}
        </h4>
        <p className="mt-1 truncate text-[9px] font-mono uppercase tracking-[0.14em] text-white/40">
          {[
            track.bpm ? `${track.bpm} BPM` : null,
            track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null,
            track.type,
          ].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>

      {/* Tags + rating — secondary support, same hierarchy as Store list. */}
      <div className="relative z-10 hidden min-w-0 items-center gap-2 md:flex">
        {genreMoodTags.slice(0, 2).map((tt) => (
          <span
            key={`${tt.category}-${tt.tag}`}
            className="truncate text-[11px] text-white/50"
          >
            #{tt.tag}
          </span>
        ))}
      </div>

      {/* Time / added */}
      <div className="relative z-10 hidden text-right md:block">
        <p className="text-[11px] font-mono tabular-nums text-white/60">{durationLabel}</p>
        <p className="mt-0.5 text-[9px] font-mono uppercase tracking-[0.14em] text-white/30">{uploadDate}</p>
      </div>

      {/* Rating stars */}
      <div className="relative z-10 hidden items-center justify-end gap-2 md:flex" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} onClick={(e) => handleRating(e, star)} className="cursor-pointer p-0.5">
              <Star
                size={11}
                fill={track.rating && track.rating >= star ? '#c8a84b' : 'none'}
                strokeWidth={1.5}
                className={track.rating && track.rating >= star ? 'text-[#c8a84b]' : 'text-white/20 transition-colors hover:text-[#c8a84b]'}
              />
            </button>
          ))}
        </div>
        <div className="flex min-w-[42px] justify-end">
          {isCached && (
            <span className="rounded border border-white/[0.14] px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-white/55">
              Offline
            </span>
          )}
          {!isCached && hasCompletedStems && (
            <span className="rounded border border-[#6DC6A4]/20 bg-[#6DC6A4]/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4]">
              Stems
            </span>
          )}
        </div>
      </div>

      {/* More */}
      <div ref={menuRef} className="relative z-20 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            menuOpen
              ? 'border-white/20 bg-white/[0.05] text-white'
              : 'border-transparent text-[#8B8273] hover:bg-white/[0.06] hover:text-white'
          }`}
          aria-label="Track actions"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full z-[80] mt-1 w-52 bg-[#090907] border border-white/10 rounded-lg shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] py-1 animate-in fade-in slide-in-from-top-1"
          >
            {onClickDetails && (
              <button
                onClick={() => { setMenuOpen(false); onClickDetails(track); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A]"
              >
                <Info size={12} className="text-white" /> View details
              </button>
            )}
            {(onMoveUp || onMoveDown) && moveControls === 'menu' && (
              <>
                <button
                  onClick={() => { setMenuOpen(false); onMoveUp?.(); }}
                  disabled={isFirstInOrder}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ChevronUp size={12} className="text-white" /> Move up
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onMoveDown?.(); }}
                  disabled={isLastInOrder}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ChevronDown size={12} className="text-white" /> Move down
                </button>
              </>
            )}
            {onShare && (
              <button
                onClick={() => { setMenuOpen(false); onShare(track); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A]"
              >
                <Share2 size={12} className="text-white" /> Share track
              </button>
            )}
            
            {isCached ? (
              <button
                onClick={(e) => { setMenuOpen(false); handleRemoveSync(e); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-amber-500 hover:bg-[#0D0D0A]"
              >
                <MinusCircle size={12} className="text-amber-500 shrink-0" /> Remove offline cache
              </button>
            ) : (
              <button
                onClick={(e) => { handleSync(e); }}
                disabled={syncProgress !== null}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A] disabled:opacity-50"
              >
                {syncProgress !== null ? (
                  <>
                    <Loader2 size={12} className="animate-spin text-white shrink-0" />
                    <span>Syncing ({Math.round(syncProgress * 100)}%)</span>
                  </>
                ) : (
                  <>
                    <Download size={12} className="text-white shrink-0" />
                    <span>Sync to device</span>
                  </>
                )}
              </button>
            )}
            {onRemoveFromContext && (
              <button
                onClick={() => { setMenuOpen(false); onRemoveFromContext(track); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[12px] text-white hover:bg-[#0D0D0A]"
              >
                <MinusCircle size={12} className="text-white/80" /> {removeLabel}
              </button>
            )}
            {onDelete && (
              <>
                <div className="my-1 border-t border-white/10" />
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

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
