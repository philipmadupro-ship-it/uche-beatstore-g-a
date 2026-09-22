'use client';

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { usePlayer } from '@/hooks/usePlayer';
import { loadVisualPeaks, resampleVisualPeaks } from '@/lib/audio/visual-peaks';
import {
  WAVEFORM_SEEK_STEP,
  WAVEFORM_VIEW_HEIGHT,
  WAVEFORM_VIEW_WIDTH,
  fractionFromPointer,
  svgSafeId,
  waveformPath,
} from '@/lib/audio/waveform-path';

/**
 * A waveform in the track row — splicedd's per-row preview, adapted.
 *
 * Every row shows the shape of its track; the row that is playing also shows
 * where the playhead is, and is a seek control. Clicking any other row's
 * waveform starts that track from the point clicked.
 *
 * Three things keep fifty of these cheap:
 *
 *   - Peaks load lazily, once, when the row first scrolls into view. Fifty
 *     sidecar requests on page load would cost more than the feature is worth.
 *   - The path is built once. Playback moves a gradient edge, not geometry —
 *     see `lib/audio/waveform-path`.
 *   - Each row subscribes to the player's progress through a selector that
 *     returns a constant 0 unless THIS row is playing. So only the playing
 *     row re-renders on each progress tick; the other forty-nine never
 *     notice. Selecting `progress` directly would re-render every row sixty
 *     times a second and undo the list memoisation entirely.
 *
 * A track with no peaks renders nothing. A fake waveform is worse than none:
 * it looks like information and carries none.
 */

/** Enough resolution to read a drop, few enough points to keep `d` small. */
const WAVEFORM_POINTS = 160;

interface Props {
  trackId: string;
  peaksUrl: string | null | undefined;
  title: string;
  /**
   * The row's own play handler, so seeking an idle row starts it the same way
   * its play button would. Without one, only the row already playing can seek.
   */
  onPlay?: () => void;
}

function RowWaveformImpl({ trackId, peaksUrl, title, onPlay }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const gradientId = svgSafeId(useId());

  const isCurrent = usePlayer((s) => s.currentTrack?.id === trackId);
  const progress = usePlayer((s) => (s.currentTrack?.id === trackId ? s.progress : 0));
  const seekTo = usePlayer((s) => s.seekTo);

  // Lazy, one-shot load when the row first comes near the viewport.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !peaksUrl || typeof IntersectionObserver === 'undefined') return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        loadVisualPeaks(peaksUrl, controller.signal)
          .then((raw) => {
            if (raw && raw.length > 0) setPeaks(resampleVisualPeaks(raw, WAVEFORM_POINTS));
          })
          .catch(() => {
            // Leave it empty. A missing waveform is not worth a toast per row.
          });
      },
      { rootMargin: '200px' },
    );
    observer.observe(host);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [peaksUrl]);

  if (!peaksUrl) return null;

  const seek = (fraction: number) => {
    // An idle row starts playing first, then seeks. The engine falls back to
    // the stored duration while the new track has no metadata yet, so the
    // seek lands where it was aimed rather than at zero.
    if (!isCurrent) {
      if (!onPlay) return;
      onPlay();
    }
    seekTo(fraction);
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    // The row itself opens details on click; a click here means "seek".
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    seek(fractionFromPointer(e.clientX, rect.left, rect.width));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = progress - WAVEFORM_SEEK_STEP;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = progress + WAVEFORM_SEEK_STEP;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next == null) return;
    // Claimed: the player's global ←/→ seek and ↑/↓ volume stand down, and
    // the track list's ↑/↓ row navigation already defers to a slider.
    e.preventDefault();
    seek(Math.min(1, Math.max(0, next)));
  };

  const pct = Math.round(progress * 100);
  const d = peaks ? waveformPath(peaks) : '';

  return (
    <div
      ref={hostRef}
      role="slider"
      aria-label={`Seek ${title}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={isCurrent ? `${pct}%` : 'Not playing'}
      // Only the playing row is a tab stop. Fifty waveform tab stops would
      // bury everything else on the page; the arrow keys move between rows.
      tabIndex={isCurrent ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="relative h-8 w-full cursor-pointer rounded-lg text-white outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    >
      {d ? (
        <svg
          viewBox={`0 0 ${WAVEFORM_VIEW_WIDTH} ${WAVEFORM_VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden
        >
          <defs>
            {/* Both stops at the same offset: a hard edge between played and
                unplayed. Moving it is one attribute per frame — the path is
                never rebuilt while a track plays. */}
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
              <stop offset={`${progress * 100}%`} stopColor="currentColor" stopOpacity={isCurrent ? 0.85 : 0.35} />
              <stop offset={`${progress * 100}%`} stopColor="currentColor" stopOpacity={isCurrent ? 0.25 : 0.35} />
            </linearGradient>
          </defs>
          <path d={d} fill={`url(#${gradientId})`} />
        </svg>
      ) : null}
    </div>
  );
}

export const RowWaveform = memo(RowWaveformImpl);
