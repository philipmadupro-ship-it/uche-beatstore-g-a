'use client';

import { useEffect, useMemo, useState } from 'react';
import { Track } from '@/lib/types';
import { Star, Music, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { InlineText } from '@/components/ui/InlineText';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import { usePlayer } from '@/hooks/usePlayer';
import { useRating } from '@/hooks/useRating';
import { setTrackDragData } from '@/lib/dnd';
import { cacheTrack, getCachedMeta, removeCached } from '@/lib/offline/audio-cache';
import { toast } from '@/hooks/useToast';
import { gridTemplate, type LibraryColumn, type TrackWithTags } from '@/lib/library/columns';
import type { TrackStatsMap } from '@/lib/library/track-stats';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

interface TrackCardProps {
  /** When set, the row renders these data columns instead of its fixed
   *  tags/time/rating trio. Only the library passes this — playlists and
   *  projects keep the standard row, which is why it is optional rather
   *  than a required shape every caller has to construct. */
  columns?: LibraryColumn[];
  /** Plays/downloads/revenue for the commerce columns. Only the library
   *  passes it, and only once its stats fetch resolves. */
  columnStats?: TrackStatsMap;
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
  /** Dashboard rows only. Turns on inline rename — the title cell becomes a
   *  field and the ⋯ menu grows a Rename item that focuses it. The public
   *  storefront row omits it, so a visitor never gets an editor. */
  editable?: boolean;
  /** Called after an inline edit lands, so the page can refetch. */
  onChanged?: () => void;
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
  editable = false,
  onChanged,
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
  columnStats,
}: TrackCardProps) {
  void index;
  const { currentTrack, isPlaying, setTrack, togglePlay } = usePlayer();
  const [renaming, setRenaming] = useState(false);
  // Optimistic title so the row updates the instant the field closes, without
  // waiting for the page's refetch to come back.
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
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

  const syncToDevice = async () => {
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

  const removeFromCache = async () => {
    try {
      await removeCached(track.id);
      setIsCached(false);
      toast.success(`"${track.title.toUpperCase()}" removed from local storage.`);
    } catch (err) {
      console.error('Failed to remove cache:', err);
      toast.error('Failed to delete cache');
    }
  };

  // A refetch that brings back a different title means the override is stale.
  useEffect(() => { setTitleOverride(null); }, [track.title]);

  const renameTrack = async (next: string) => {
    if (!next) return false;
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('Rename failed', j?.error || `HTTP ${res.status}`);
        return false;
      }
      setTitleOverride(next);
      onChanged?.();
      return true;
    } catch (err) {
      toast.error('Rename failed', err instanceof Error ? err.message : 'Network error');
      return false;
    }
  };

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

  const displayTitle = titleOverride ?? track.title;
  const uploadDate = new Date(track.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // `currentRating` — NOT `track.rating` — is what the stars render from.
  // Parents that fetch with plain useState (the project and playlist pages)
  // never see React Query's ['tracks'] invalidate, so their `track` prop stays
  // stale after a successful rate and the star visibly did nothing. The hook's
  // value carries the optimistic write and falls back to the prop, so it is
  // correct for React Query parents and plain-fetch parents alike.
  const { rate: rateTrack, rating: currentRating } = useRating(track.id, track.rating || 0);
  const durationLabel = formatDuration(track.duration_seconds ?? null);
  const genreMoodTags = trackTags.filter((tt) => tt.category === 'genre' || tt.category === 'mood');
  // Genre first, then mood — the gradient leads on the first entry, and genre
  // is the axis a producer actually browses by.
  const tagsForCategory = (category: string) =>
    trackTags.filter((tt) => tt.category === category).map((tt) => tt.tag);

  const artworkTags = useMemo(
    () => [
      ...trackTags.filter((tt) => tt.category === 'genre').map((tt) => tt.tag),
      ...trackTags.filter((tt) => tt.category === 'mood').map((tt) => tt.tag),
    ],
    [trackTags],
  );

  const handleRating = (e: React.MouseEvent, star: number) => {
    e.stopPropagation();
    rateTrack(star);
  };

  /**
   * Row menu, ordered by how often a producer reaches for each item rather
   * than by which subsystem owns it.
   *
   * Rename comes first and edits the row in place; the old menu's first item
   * was "View details", which opened a 420px drawer whose own title was not
   * editable. Offline sync and the two list-membership actions keep their own
   * groups so the destructive row at the bottom is never adjacent to a
   * routine one.
   */
  const rowMenuSections: MenuSection[] = [
    {
      id: 'edit',
      items: [
        {
          id: 'rename', label: 'Rename', shortcut: 'R', shortcutKey: 'r',
          hidden: !editable,
          onSelect: () => setRenaming(true),
        },
        {
          id: 'details', label: 'View details', shortcut: 'I', shortcutKey: 'i',
          hidden: !onClickDetails,
          onSelect: () => onClickDetails?.(track),
        },
      ],
    },
    {
      id: 'order',
      items: [
        {
          id: 'up', label: 'Move up', hidden: !onMoveUp || moveControls !== 'menu',
          disabled: isFirstInOrder, onSelect: () => onMoveUp?.(),
        },
        {
          id: 'down', label: 'Move down', hidden: !onMoveDown || moveControls !== 'menu',
          disabled: isLastInOrder, onSelect: () => onMoveDown?.(),
        },
      ],
    },
    {
      id: 'content',
      items: [
        { id: 'share', label: 'Share track', hidden: !onShare, onSelect: () => onShare?.(track) },
        {
          id: 'uncache', label: 'Remove offline cache', hidden: !isCached,
          onSelect: () => { void removeFromCache(); },
        },
        {
          id: 'cache',
          label: syncProgress !== null ? `Syncing (${Math.round(syncProgress * 100)}%)` : 'Sync to device',
          hidden: isCached, busy: syncProgress !== null,
          onSelect: () => { void syncToDevice(); return 'keep-open' as const; },
        },
      ],
    },
    {
      id: 'membership',
      items: [
        {
          id: 'remove', label: removeLabel, hidden: !onRemoveFromContext,
          onSelect: () => onRemoveFromContext?.(track),
        },
      ],
    },
    {
      id: 'danger',
      danger: true,
      items: [
        { id: 'delete', label: 'Delete from library', hidden: !onDelete, onSelect: () => onDelete?.(track) },
      ],
    },
  ];

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
            <ArtworkFallback src={track.cover_url} seed={track.id} tags={artworkTags} sizes="40px" className="object-cover">
              <Music size={13} aria-hidden />
            </ArtworkFallback>
            <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {isActive ? <PauseGlyph size={13} /> : <PlayGlyph size={13} className="ml-0.5" />}
            </span>
          </button>
        )}
      </div>

      {/* Title + core metadata. The title is the row's one inline editor:
          renaming a beat used to mean opening the details drawer, and the
          drawer's title was not editable either — the only rename lived on
          /library/[id]. */}
      <div className="relative z-10 min-w-0" onClick={(e) => { if (renaming) e.stopPropagation(); }}>
        {renaming ? (
          <InlineText
            label="Track title"
            value={displayTitle}
            editing
            onEditingChange={(v) => setRenaming(v)}
            onSave={renameTrack}
            maxLength={200}
            inputClassName="text-[14px] font-semibold"
          />
        ) : (
          <h4 className={`truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] transition-colors ${
            isCurrent ? 'text-white' : 'text-white/95 group-hover:text-white'
          }`}>
            {displayTitle}
          </h4>
        )}
        {/* Metadata as discrete cells rather than a ' · ' string: BPM and key
            are the two values a producer scans for, and a run-on line makes
            them hunt. Separators are rendered, not typed, so a missing value
            cannot leave a dangling dot. */}
        {/* nowrap + truncate: with the table configurable the title column can
            be narrower than it used to be, and this line was breaking "167
            BPM" across two rows, which made the row taller and read as a
            layout fault. Overflow should clip, not reflow. */}
        <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap text-[9px] font-mono uppercase tracking-[0.14em] text-white/40">
          {track.bpm ? (
            <span className="shrink-0 tabular-nums text-white/55">{track.bpm}<span className="text-white/30"> BPM</span></span>
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
          {currentRating ? (
            <>
              <span aria-hidden className="h-2 w-px bg-white/15" />
              <span className="flex items-center gap-0.5 text-[#c8a84b]">
                <Star size={8} fill="#c8a84b" strokeWidth={0} aria-hidden />
                <span className="tabular-nums">{currentRating}</span>
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
                  currentRating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                }`}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const on = Boolean(currentRating && currentRating >= star);
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
          if (col.id === 'tags') {
            /* Tags keep the presentation they had before the table became
               configurable: the store/price marker, then genre and mood as
               hashed pills. Flattening them to comma-joined text made the
               busiest column in the table the hardest to scan, and lost the
               listed/price signal entirely. Making columns configurable was
               supposed to change WHICH data shows, not how it reads. */
            return (
              <div key={col.id} className="relative z-10 hidden min-w-0 items-center gap-2 md:flex">
                {track.store_listed ? (
                  <span
                    title={track.lease_price_usd != null ? `Listed from $${track.lease_price_usd}` : 'Listed on the store'}
                    className="shrink-0 rounded border border-[#D4BFA0]/25 bg-[#D4BFA0]/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[#D4BFA0]"
                  >
                    {track.lease_price_usd != null ? `$${track.lease_price_usd}` : 'Listed'}
                  </span>
                ) : null}
                {genreMoodTags.slice(0, 2).map((tt) => (
                  <span key={`${tt.category}-${tt.tag}`} className="truncate text-[11px] text-white/50">
                    #{tt.tag}
                  </span>
                ))}
                {genreMoodTags.length === 0 && !track.store_listed ? (
                  <span className="text-[11px] text-white/20">—</span>
                ) : null}
              </div>
            );
          }
          if (col.id === 'genre' || col.id === 'mood') {
            // Same reasoning, for the single-category variants.
            const items = tagsForCategory(col.id);
            return (
              <div key={col.id} className="relative z-10 hidden min-w-0 items-center gap-2 md:flex">
                {items.length > 0
                  ? items.slice(0, 2).map((tag) => (
                      <span key={tag} className="truncate text-[11px] text-white/50">#{tag}</span>
                    ))
                  : <span className="text-[11px] text-white/20">—</span>}
              </div>
            );
          }
          const value = col.value(track as TrackWithTags, columnStats);
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
            currentRating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          }`}
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const on = Boolean(currentRating && currentRating >= star);
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

      {/* Row actions. Grouped by frequency, destructive last, keyboard
          navigable — see components/ui/ActionMenu. */}
      <div className="relative z-20 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          sections={rowMenuSections}
          align="right"
          label="Track actions"
          width={224}
          triggerClassName="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[#8B8273] transition-colors hover:bg-white/[0.06] hover:text-white"
        />
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
