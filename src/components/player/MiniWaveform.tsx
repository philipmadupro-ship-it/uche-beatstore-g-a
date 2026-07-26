'use client';

/**
 * MiniWaveform — compact waveform display for the store grid cards.
 *
 * Design goals:
 *   • Zero extra WaveSurfer / audio instances. Playback always routes through
 *     the global PlayerBar. This component is purely visual.
 *   • Real waveform shape: fetches peaks_url when available via Intersection
 *     Observer (lazy — only loads when the card enters the viewport).
 *     Falls back to a seeded-random synthetic shape so every card has a
 *     unique-looking waveform without decoding audio.
 *   • Progress: reads `progress` (0..1) from the global usePlayer store to
 *     paint the "played" portion. Only the active (current) track shows
 *     progress.
 *   • Seek: on click, calculates the fractional position and writes to
 *     `seekTo()` in the store. WavePlayer consumes `seekTarget` and seeks
 *     its WaveSurfer instance. Works even though the two components are
 *     siblings mounted in different parts of the tree.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePlayer } from '@/hooks/usePlayer';
import { buildDawWaveformBars, loadVisualPeaks, resampleVisualPeaks, syntheticVisualPeaks } from '@/lib/audio/visual-peaks';
import { keyboardSeekFraction } from '@/lib/audio/seek-accessibility';

/* ─── Constants ────────────────────────────────────────────── */

const BAR_COUNT = 72;          // number of bars rendered in the SVG
/* ─── Component ─────────────────────────────────────────────── */

interface Props {
  trackId: string;
  peaksUrl?: string | null;
  /** Height in pixels. */
  height?: number;
  /** Whether this track is the currently active track in the global player. */
  isActive: boolean;
  /**
   * Optional callback fired when the user clicks the waveform on a track that
   * isn't currently active. The caller should start playback of this track.
   * When isActive is true the click seeks instead (via seekTo in the store).
   */
  onPlay?: () => void;
}

export function MiniWaveform({ trackId, peaksUrl, height = 40, isActive, onPlay }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackBars = useMemo(() => syntheticVisualPeaks(trackId, BAR_COUNT), [trackId]);
  const loadKey = `${trackId}:${peaksUrl ?? ''}`;
  const [loadedBars, setLoadedBars] = useState<{ key: string; bars: number[] } | null>(null);
  const bars = loadedBars?.key === loadKey ? loadedBars.bars : fallbackBars;
  const dawBars = useMemo(() => buildDawWaveformBars(bars), [bars]);
  const peaksLoaded = loadedBars?.key === loadKey;

  const { currentTrack, progress, seekTo } = usePlayer();

  // Lazy-load peaks via IntersectionObserver — fires only when the card
  // enters the viewport so we don't hammer the CDN on initial mount.
  useEffect(() => {
    if (peaksLoaded || !peaksUrl) return;
    const el = containerRef.current;
    if (!el) return;

    const controller = new AbortController();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        loadVisualPeaks(peaksUrl, controller.signal).then((rawPeaks) => {
          if (!rawPeaks) return;
          setLoadedBars({ key: loadKey, bars: resampleVisualPeaks(rawPeaks, BAR_COUNT) });
        });
      },
      { rootMargin: '100px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [loadKey, peaksLoaded, peaksUrl]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isActive) {
        // Non-active track: clicking anywhere on the waveform starts playback.
        onPlay?.();
        return;
      }
      // Active track: clicking seeks to that position.
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTo(fraction);
    },
    [isActive, onPlay, seekTo],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isActive) return;
      const nextFraction = keyboardSeekFraction(e.key, progress, currentTrack?.duration_seconds);
      if (nextFraction == null) return;
      e.preventDefault();
      seekTo(nextFraction);
    },
    [currentTrack?.duration_seconds, isActive, progress, seekTo],
  );

  const fillPct = isActive ? progress * 100 : 0;
  const currentSeconds = currentTrack?.duration_seconds ? Math.round(currentTrack.duration_seconds * progress) : 0;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={isActive ? 0 : undefined}
      style={{ height }}
      className={`relative w-full overflow-hidden rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30/70 ${isActive ? 'cursor-col-resize' : onPlay ? 'cursor-pointer' : 'cursor-default'}`}
      role={isActive ? 'slider' : undefined}
      aria-label={isActive ? `Seek ${currentTrack?.title ?? 'current track'}` : undefined}
      aria-valuenow={isActive ? Math.round(progress * 100) : undefined}
      aria-valuemin={isActive ? 0 : undefined}
      aria-valuemax={isActive ? 100 : undefined}
      aria-valuetext={isActive ? `${currentSeconds} seconds elapsed` : undefined}
    >
      <svg
        viewBox={`0 0 ${BAR_COUNT * 3 - 1} 100`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        {dawBars.map((bar) => {
          if (!bar.isBeat) return null;
          const x = bar.index * 3 + 1;
          return (
            <line
              key={`grid-${bar.index}`}
              x1={x}
              x2={x}
              y1={bar.isDownbeat ? 4 : 18}
              y2={bar.isDownbeat ? 96 : 82}
              stroke={bar.isDownbeat ? 'rgba(231,215,190,0.20)' : 'rgba(231,215,190,0.10)'}
              strokeWidth={bar.isDownbeat ? 0.45 : 0.3}
            />
          );
        })}
        {dawBars.map((bar) => {
          const x = bar.index * 3;
          const barH = bar.height * 100;
          const y = (100 - barH) / 2;
          const playedFrac = bar.index / BAR_COUNT;
          const isPlayed = isActive && playedFrac < progress;
          return (
            <rect
              key={bar.index}
              x={x}
              y={y}
              width={bar.isDownbeat ? 2.35 : 2}
              height={barH}
              rx={1.2}
              // Frosted unplayed bars (warm off-white, low alpha) read clearly
              // on dark cards; played bars glow in the warm accent. Idle cards
              // sit a touch dimmer so the active track stands out.
              className={`transition-[fill] duration-150 ${
                isPlayed ? 'fill-[#FFFFFF]' : isActive ? 'fill-[#FFFFFF]/30' : 'fill-[#FFFFFF]/15'
              }`}
              style={isPlayed || bar.isTransient ? { filter: `drop-shadow(0 0 ${bar.isTransient ? 2.4 : 1.5}px rgba(231,215,190,0.45))` } : undefined}
            />
          );
        })}
      </svg>

      {/* Playhead on the active track — a slim warm line with a soft glow. */}
      {isActive && (
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-[#F0E6D2] rounded-full pointer-events-none shadow-[0_0_6px_rgba(240,230,210,0.7)]"
          style={{ left: `${fillPct}%`, transform: 'translateX(-50%)' }}
        />
      )}
    </div>
  );
}
