'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ShareTrackRow, ShareTrackListHeader, type ShareRowDownload, type ShareRowTrack } from '@/components/share/ShareTrackRow';
import { ShareRowWaveform } from '@/components/share/ShareRowWaveform';
import { ShareTrackListControls } from '@/components/share/ShareTrackListControls';
import {
  DEFAULT_SHARE_FILTERS,
  buildShareFacets,
  filterAndSortShareTracks,
  shareControlsVisibility,
  type ShareListFilters,
  type ShareListTrack,
} from '@/lib/share/track-list';

export interface ShareListItem extends ShareRowTrack, ShareListTrack {
  peaks_url?: string | null;
}

export interface ShareRowExtras {
  titleBadge?: ReactNode;
  trailing?: ReactNode;
  onOpenDetails?: (track: ShareListItem) => void;
}

interface Props<T extends ShareListItem> {
  tracks: T[];
  playingId?: string | null;
  isPlaying?: boolean;
  onPlay: (track: T) => void;
  /** Per-row download; shown only when `allowed` (the server's gate still decides). */
  download?: ShareRowDownload;
  /** Client variant: the licence pill, the "In cart" badge, the details drawer. */
  rowExtras?: (track: T) => ShareRowExtras;
  /** The rows carry a trailing slot; this is its column head (may be empty). */
  hasTrailing?: boolean;
  trailingLabel?: string;
  /** Narrow lists (a sidebar): no column head, the waveform on its own line. */
  compact?: boolean;
  emptyMessage?: string;
  /** Extra classes for the rows' scroll box in a bounded panel. */
  listClassName?: string;
}

/** The genre then mood chips a row shows. */
function rowTags(t: ShareListTrack): string[] {
  const tags = t.tags ?? [];
  const pick = (cat: string) => tags.filter((x) => x.category === cat).map((x) => x.tag);
  return [...pick('genre'), ...pick('mood')].slice(0, 2);
}

/**
 * The one track list every share variant renders: the store's row (artwork,
 * title, BPM | key | type, genre and mood chips, length), a waveform you can
 * click to play or seek, and a Download button on the row itself when the
 * share allows it. Above it, search / filters / sort for a long share.
 *
 * Filtering is `lib/share/track-list`; this component only holds the state and
 * lays it out. The page's single audio engine plays the active row, so nothing
 * here mounts an audio instance.
 */
export function ShareTrackList<T extends ShareListItem>({
  tracks, playingId, isPlaying, onPlay, download, rowExtras, hasTrailing, trailingLabel, compact,
  emptyMessage = 'No tracks in this selection yet.', listClassName,
}: Props<T>) {
  const [filters, setFilters] = useState<ShareListFilters>(DEFAULT_SHARE_FILTERS);
  const facets = useMemo(() => buildShareFacets(tracks), [tracks]);
  const visibility = useMemo(() => shareControlsVisibility(tracks.length, facets), [tracks.length, facets]);
  const visible = useMemo(
    () => (visibility.any ? filterAndSortShareTracks(tracks, filters) : tracks),
    [tracks, filters, visibility.any],
  );

  // Stable handler so the memoised rows are not re-rendered by every page tick.
  const onPlayRef = useRef(onPlay);
  useEffect(() => { onPlayRef.current = onPlay; });
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const handlePlay = useCallback((row: ShareRowTrack) => {
    const t = byId.get(row.id);
    if (t) onPlayRef.current(t);
  }, [byId]);

  return (
    <div data-testid="share-track-list">
      {visibility.any && (
        <ShareTrackListControls
          filters={filters}
          onChange={setFilters}
          facets={facets}
          visibility={visibility}
          shown={visible.length}
          total={tracks.length}
          compact={compact}
        />
      )}

      <div className="space-y-2">
        <ShareTrackListHeader hasDownload={download?.allowed} hasTrailing={hasTrailing} trailingLabel={trailingLabel} compact={compact} hasWaveform />
        <div className={listClassName}>
          <div className="space-y-2">
            {tracks.length === 0 ? (
              <div className="px-5 py-12 text-center text-[11px] text-white/60">{emptyMessage}</div>
            ) : visible.length === 0 ? (
              <div data-testid="share-list-empty" className="px-5 py-10 text-center text-[11px] text-white/60">
                No tracks match.{' '}
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_SHARE_FILTERS)}
                  className="rounded-lg px-1.5 py-0.5 text-white/80 underline underline-offset-2 transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              visible.map((t) => {
                const active = playingId === t.id;
                const extras = rowExtras?.(t);
                return (
                  <ShareTrackRow
                      key={t.id}
                      track={t}
                      active={active}
                      isPlaying={!!isPlaying}
                      onPlay={handlePlay}
                      download={download}
                      compact={compact}
                      tags={rowTags(t)}
                      titleBadge={extras?.titleBadge}
                      trailing={extras?.trailing}
                      onOpenDetails={extras?.onOpenDetails ? (row) => extras.onOpenDetails?.(byId.get(row.id) ?? t) : undefined}
                      waveform={<ShareRowWaveform track={t} active={active} onPlay={() => handlePlay(t)} />}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
