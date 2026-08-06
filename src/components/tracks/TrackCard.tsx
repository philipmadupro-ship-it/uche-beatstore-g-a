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
import { gridTemplate, type LibraryColumn, type TrackWithTags } from '@/lib/library/columns';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

interface TrackCardProps {
  /** When set, the row renders these data columns instead of its fixed
   *  tags/time/rating trio. Only the library passes this — playlists and
   *  projects keep the standard row, which is why it is optional rather
   *  than a required shape every caller has to construct. */
  columns?: LibraryColumn[];
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

/**
 * Column template for a track row and for any header that labels it.
 *
 * Exported and shared because it was previously written out by hand in three
 * files — this component, the library header and the project header. Widening
 * two columns here to stop the rating stars colliding with the date left both
 * headers labelling the wrong columns, which is the failure mode a duplicated
 * layout constant guarantees eventually.
 *
 *   40px  index / play
 *   1.45fr title + metadata
 *   1fr    tags + store state
 *   84px   duration + added date
 *   148px  rating + offline/stems badge
 *   32px   row menu
 *
 * The `md:` prefix is baked into the value, not applied at the use site. A
 * class name assembled at runtime (`md:${...}`) is invisible to Tailwind's
 * scanner, which reads source text rather than evaluating it — the CSS would
 * never be generated and every row would collapse to a single column.
 */
export const TRACK_ROW_GRID = 'md:grid-cols-[40px_minmax(0,1.45fr)_minmax(0,1fr)_84px_148px_32px]';

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
  columns,
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
      style={columns ? ({ '--track-row-cols': gridTemplate(columns) } as React.CSSProperties) : undefined}
      className={`group relative grid min-h-[56px] grid-cols-[40px_minmax(0,1fr)_32px] items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors cursor-pointer ${columns ? 'track-row-dynamic' : TRACK_ROW_GRID} md:gap-4 md:px-3 ${
        isCurrent
          ? 'border-[#D4BFA0]/35 bg-[#D4BFA0]/[0.07] shadow-[inset_3px_0_0_#D4BFA0]'
          : selected
            ? 'border-white/[0.24] bg-white/[0.08]'
            : 'border-white/[0.07] hover:border-white/[0.16] hover:bg-white/[0.04]'
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
            selected ? 'bg-white border border-white/30 text-black' : 'border border-white/20 bg-[#090907]/70 text-white/30 hover:border-white/30 hover:text-white/80'
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
            {/* Same resolution as the grid: own cover, then the producer's
                default artwork, then a gradient seeded by this track. The list
                is the library's default view, so leaving it on a bare glyph
                meant most people never saw their own artwork at all. */}
            <ArtworkFallback src={track.cover_url} seed={track.id} sizes="40px" className="object-cover">
              <Music size={13} aria-hidden />
            </ArtworkFallback>
            <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {isActive ? <PauseGlyph size={13} /> : <PlayGlyph size={13} className="ml-0.5" />}
            </span>
          </button>
        )}
      </div>

      {/* Title + core metadata */}
      <div className="relative z-10 min-w-0">
        <h4 className={`truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] transition-colors ${
          isCurrent ? 'text-white' : 'text-white/95 group-hover:text-white'
        }`}>
          {track.title}
        </h4>
        {/* Metadata as discrete cells rather than a ' · ' string: BPM and key
            are the two values a producer scans for, and a run-on line makes
            them hunt. Separators are rendered, not typed, so a missing value
            cannot leave a dangling dot. */}
        <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.14em] text-white/40">
          {track.bpm ? (
            <span className="tabular-nums text-white/55">{track.bpm}<span className="text-white/30"> BPM</span></span>
          ) : null}
          {track.bpm && track.key ? <span aria-hidden className="h-2 w-px bg-white/15" /> : null}
          {track.key ? (
            <span className="text-white/55">{track.key}{track.scale === 'minor' ? 'm' : ''}</span>
          ) : null}
          {(track.bpm || track.key) && track.type ? <span aria-hidden className="h-2 w-px bg-white/15" /> : null}
          {track.type ? <span className="truncate">{track.type}</span> : null}
          {!track.bpm && !track.key && !track.type ? <span>—</span> : null}
        </div>

        {/* Mobile-only continuation of the row.
            Below `md` the tags, time and rating columns are all hidden, which
            left a phone showing a title and nothing else — while the project's
            stated direction is that mobile mirrors web. Rather than cram five
            columns into 375px, the same information continues on a second line:
            duration and date (the Time column), the store/price marker, and the
            rating as a single numeral instead of five tap targets too small to
            hit accurately anyway. */}
        <div className="mt-1 flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.12em] text-white/35 md:hidden">
          <span className="tabular-nums">{durationLabel}</span>
          <span aria-hidden className="h-2 w-px bg-white/15" />
          <span className="tabular-nums">{uploadDate}</span>
          {track.rating ? (
            <>
              <span aria-hidden className="h-2 w-px bg-white/15" />
              <span className="flex items-center gap-0.5 text-[#c8a84b]">
                <Star size={8} fill="#c8a84b" strokeWidth={0} aria-hidden />
                <span className="tabular-nums">{track.rating}</span>
              </span>
            </>
          ) : null}
          {track.store_listed ? (
            <>
              <span aria-hidden className="h-2 w-px bg-white/15" />
              <span className="text-[#D4BFA0]">
                {track.lease_price_usd != null ? `$${track.lease_price_usd}` : 'Listed'}
              </span>
            </>
          ) : null}
          {isCached ? (
            <>
              <span aria-hidden className="h-2 w-px bg-white/15" />
              <span className="text-white/45">Offline</span>
            </>
          ) : null}
        </div>
      </div>

      {columns ? (
        /* Configured columns. Title is skipped: it is already rendered above
           as the row's primary cell with its own metadata line, and drawing
           it twice would waste the widest track in the grid. Rating keeps its
           interactive stars; everything else is read-only text. */
        columns.map((col) => {
          if (col.id === 'title') return null;
          if (col.id === 'rating') {
            return (
              <div
                key={col.id}
                className="relative z-10 hidden items-center justify-end gap-2 md:flex"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
                  track.rating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                }`}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const on = Boolean(track.rating && track.rating >= star);
                    return (
                      <button
                        key={star}
                        onClick={(e) => handleRating(e, star)}
                        className="cursor-pointer p-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#c8a84b] rounded-sm"
                        aria-label={`Rate ${star} star${star === 1 ? '' : 's'}`}
                        aria-pressed={on}
                      >
                        <Star
                          size={11}
                          fill={on ? '#c8a84b' : 'none'}
                          strokeWidth={1.5}
                          className={on ? 'text-[#c8a84b]' : 'text-white/25 transition-colors hover:text-[#c8a84b]'}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
          const value = col.value(track as TrackWithTags);
          return (
            <div
              key={col.id}
              className={`relative z-10 hidden min-w-0 md:block ${col.align === 'right' ? 'text-right' : ''}`}
            >
              <p className={`truncate text-[11px] ${
                value
                  ? 'font-mono tabular-nums text-white/60'
                  : 'text-white/20'
              }`}>
                {/* An em dash rather than an empty cell: a blank reads as a
                    rendering fault, a dash reads as "no value". */}
                {value || '—'}
              </p>
            </div>
          );
        })
      ) : (
        <>
      {/* Tags + commerce state — secondary support, same hierarchy as Store list.
          The store/price markers are here because they were previously only
          visible by opening each track one at a time, which is the wrong way to
          answer "what have I actually listed?" across a 50-track library. */}
      <div className="relative z-10 hidden min-w-0 items-center gap-2 md:flex">
        {track.store_listed ? (
          <span
            title={track.lease_price_usd != null ? `Listed from $${track.lease_price_usd}` : 'Listed on the store'}
            className="shrink-0 rounded border border-[#D4BFA0]/25 bg-[#D4BFA0]/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[#D4BFA0]"
          >
            {track.lease_price_usd != null ? `$${track.lease_price_usd}` : 'Listed'}
          </span>
        ) : null}
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
        <p className="whitespace-nowrap text-[11px] font-mono tabular-nums text-white/60">{durationLabel}</p>
        <p className="mt-0.5 whitespace-nowrap text-[9px] font-mono uppercase tracking-[0.14em] text-white/30">{uploadDate}</p>
      </div>

      {/* Rating stars */}
      <div className="relative z-10 hidden items-center justify-end gap-2 md:flex" onClick={(e) => e.stopPropagation()}>
        <div
          className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
            track.rating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          }`}
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const on = Boolean(track.rating && track.rating >= star);
            return (
              <button
                key={star}
                onClick={(e) => handleRating(e, star)}
                className="cursor-pointer p-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#c8a84b] rounded-sm"
                aria-label={`Rate ${star} star${star === 1 ? '' : 's'}`}
                aria-pressed={on}
              >
                <Star
                  size={11}
                  fill={on ? '#c8a84b' : 'none'}
                  strokeWidth={1.5}
                  className={on ? 'text-[#c8a84b]' : 'text-white/25 transition-colors hover:text-[#c8a84b]'}
                />
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 justify-end">
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
        </>
      )}

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
