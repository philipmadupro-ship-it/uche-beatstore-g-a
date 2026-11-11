'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { TrackCard, type RowPlayback } from '@/components/tracks/TrackCard';
import { TrackListHeader } from '@/components/library/TrackListHeader';
import { LibraryToolbar } from '@/components/library/LibraryToolbar';
import { FilterBar, activeFilterCount, hasActiveFilters } from '@/components/library/FilterBar';
import { Dropdown } from '@/components/ui/Dropdown';
import { useShareTransport } from '@/components/share/ShareTransport';
import { useListKeyboardNavigation } from '@/hooks/useListKeyboardNavigation';
import { resolveColumns } from '@/lib/library/columns';
import { RowCallbackCache } from '@/lib/ui/stable-row-callbacks';
import { buildTagFacetOptions } from '@/lib/library/tag-filter';
import type { Track } from '@/lib/types';
import {
  DEFAULT_SHARE_VIEW,
  SHARE_SORT_OPTIONS,
  SHARE_TOOLBAR_MIN_TRACKS,
  decodeShareView,
  encodeShareView,
  filterAndSortShareTracks,
  isShareSort,
  shareCountLabel,
  type ShareViewState,
  type ShareViewTrack,
} from '@/lib/share/track-list';

/** What a share page's track carries (the share API's public shape). */
export interface ShareListItem extends ShareViewTrack {
  title: string;
  type?: string | null;
  audio_url?: string | null;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  scale?: string | null;
}

/** The share's download option. The server's gate still decides. */
export interface ShareRowDownload {
  allowed: boolean;
  onDownload: (track: { id: string; title: string }) => void;
  /** Track id whose download is in flight. */
  downloadingId?: string | null;
}

interface Props<T extends ShareListItem> {
  tracks: T[];
  playingId?: string | null;
  isPlaying?: boolean;
  onPlay: (track: T) => void;
  download?: ShareRowDownload;
  /** Client variant: the licence / Buy control, drawn in the row's last column. */
  buy?: (track: T) => ReactNode;
  /** Width of the last column when `buy` is given. */
  buyWidth?: string;
  /** A narrow column (a variant's sidebar): title and length only. */
  compact?: boolean;
  emptyMessage?: string;
}

const WIDE_COLUMNS = ['title', 'tags', 'waveform', 'duration'];
const COMPACT_COLUMNS = ['title', 'duration'];
const DOWNLOAD_WIDTH = '40px';

/**
 * The track list of a share page: the Library's own row (`TrackCard`, in its
 * recipient mode), its column header, its toolbar and its `FilterBar`. A
 * recipient clicks a row to play it, uses ↑/↓ to move between rows, and
 * searches, filters (Type, Genre, Tags, BPM, key) and sorts the way the
 * producer does in /library.
 *
 * The page's one audio engine plays the track; the row is told whether it is
 * current, playing and how far in (`playback`). Per-row Download appears only
 * when the share allows it, in the place of the owner's ⋯ menu.
 */
export function ShareTrackList<T extends ShareListItem>({
  tracks, playingId, isPlaying, onPlay, download, buy, buyWidth = '148px', compact, emptyMessage = 'No tracks in this selection yet.',
}: Props<T>) {
  // The list mounts after the share has loaded in the browser, never on the
  // server, so reading the URL in the initial state cannot mismatch.
  const [view, setView] = useState<ShareViewState>(() =>
    typeof window === 'undefined' ? DEFAULT_SHARE_VIEW : decodeShareView(window.location.search));
  const [showFilters, setShowFilters] = useState(() => hasActiveFilters(view.filters));
  const toolbar = tracks.length >= SHARE_TOOLBAR_MIN_TRACKS && !compact;

  const effectiveView = toolbar ? view : DEFAULT_SHARE_VIEW;
  const visible = useMemo(() => filterAndSortShareTracks(tracks, effectiveView), [tracks, effectiveView]);
  const tagOptions = useMemo(() => buildTagFacetOptions(tracks), [tracks]);

  // Keep the URL in step so a refresh or a pasted link keeps the view.
  useEffect(() => {
    if (!toolbar) return;
    const next = encodeShareView(view, window.location.search.replace(/^\?/, ''));
    const current = window.location.search.replace(/^\?/, '');
    if (next !== current) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`);
    }
  }, [view, toolbar]);

  const columns = useMemo(() => resolveColumns(compact ? COMPACT_COLUMNS : WIDE_COLUMNS), [compact]);
  const trailingWidth = buy ? buyWidth : download?.allowed ? DOWNLOAD_WIDTH : '8px';

  // Rows are memoised: idle rows get a constant `playback`, so only the
  // playing row re-renders on each progress tick.
  const onPlayRef = useRef(onPlay);
  useEffect(() => { onPlayRef.current = onPlay; });
  const [playCache] = useState(() => new RowCallbackCache<T>());
  const playHandler = useCallback(
    (t: T) => playCache.get(t.id, 'play', t, (x) => () => onPlayRef.current(x)),
    [playCache],
  );
  const idle = useMemo(() => {
    const map = new Map<string, RowPlayback>();
    for (const t of tracks) {
      map.set(t.id, { current: false, playing: false, progress: 0, onToggle: playHandler(t), onSeek: () => {} });
    }
    return map;
  }, [tracks, playHandler]);
  const transport = useShareTransport();
  const playbackFor = (t: T): RowPlayback => {
    if (t.id !== playingId) return idle.get(t.id)!;
    const duration = transport?.duration || t.duration_seconds || 0;
    return {
      current: true,
      playing: !!isPlaying,
      progress: transport && duration > 0 ? Math.min(1, Math.max(0, transport.currentTime / duration)) : 0,
      onToggle: playHandler(t),
      onSeek: (f) => transport?.seekToFraction(f),
    };
  };

  const audition = useCallback((t: T) => { if (t.id !== playingId) onPlayRef.current(t); }, [playingId]);
  const listNav = useListKeyboardNavigation({ items: visible, onMove: audition, onActivate: (t) => onPlayRef.current(t) });

  const rowTrailing = (t: T) => (
    <>
      {buy?.(t)}
      {download?.allowed && (
        <button
          type="button"
          onClick={() => download.onDownload({ id: t.id, title: t.title })}
          disabled={download.downloadingId === t.id}
          aria-label={`Download ${t.title}`}
          title="Download"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
        >
          {download.downloadingId === t.id
            ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            : <Download size={14} aria-hidden="true" />}
        </button>
      )}
    </>
  );

  return (
    <div data-testid="share-track-list">
      {toolbar && (
        <>
          <LibraryToolbar
            search={view.search}
            onSearch={(search) => setView((v) => ({ ...v, search }))}
            showFilters={showFilters}
            onToggleFilters={() => setShowFilters((v) => !v)}
            filtersActive={hasActiveFilters(view.filters)}
            filterCount={activeFilterCount(view.filters)}
          >
            <Dropdown
              value={view.sort}
              onChange={(v) => { if (isShareSort(v)) setView((s) => ({ ...s, sort: v })); }}
              options={SHARE_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              label="Sort"
              aria-label="Sort tracks"
            />
          </LibraryToolbar>
          {showFilters && (
            <FilterBar recipient filters={view.filters} onChange={(filters) => setView((v) => ({ ...v, filters }))} tagOptions={tagOptions} />
          )}
          <p data-testid="share-list-count" role="status" aria-live="polite" className="mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
            {shareCountLabel(visible.length, tracks.length)}
          </p>
        </>
      )}

      <div className="space-y-1.5">
        <TrackListHeader
          columns={columns}
          trailingWidth={trailingWidth}
          sortMode={view.sort}
          onSort={(sort) => { if (isShareSort(sort)) setView((s) => ({ ...s, sort })); }}
        />
        {tracks.length === 0 ? (
          <div className="px-5 py-12 text-center text-[11px] text-white/60">{emptyMessage}</div>
        ) : visible.length === 0 ? (
          <div data-testid="share-list-empty" className="px-5 py-10 text-center text-[11px] text-white/60">
            No tracks match.{' '}
            <button
              type="button"
              onClick={() => setView(DEFAULT_SHARE_VIEW)}
              className="rounded-lg px-1.5 py-0.5 text-white/80 underline underline-offset-2 transition-colors hover:bg-white/[0.10] hover:text-white"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div
            role="group"
            aria-label="Tracks. Use the up and down arrow keys to audition, Enter to play."
            tabIndex={0}
            onKeyDown={listNav.onKeyDown}
            className="rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            {visible.map((t, i) => (
              <div
                key={t.id}
                data-row-index={i}
                data-testid="share-track-row"
                aria-current={listNav.activeIndex === i ? 'true' : undefined}
                className={`mb-1.5 ${listNav.activeIndex === i ? 'rounded-xl ring-1 ring-white/30' : ''}`}
              >
                <TrackCard
                  track={t as unknown as Track}
                  index={i + 1}
                  columns={columns}
                  rowAction="play"
                  readOnly
                  playback={playbackFor(t)}
                  rowTrailing={rowTrailing(t)}
                  trailingWidth={trailingWidth}
                  onPlayClick={playHandler(t)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
