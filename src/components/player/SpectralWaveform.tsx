'use client';

/**
 * DAW-style spectral waveform lane for the beat preview.
 *
 * Its own horizontal lane — deliberately NOT painted over the cover art, which
 * is what the previous CoverWaveform did. Artwork and waveform are two
 * different jobs: one sells the beat, the other lets you read it.
 *
 * Colour comes from real low/mid/high band energy (see useSpectralPeaks), so
 * you can see the 808 versus the hats. Falls back to neutral amplitude bars
 * when the audio can't be analysed, rather than inventing bands.
 *
 * Interaction is Spotify-like: click or drag anywhere to seek, a thumb rides
 * the playhead, and the whole lane is one keyboard-operable slider.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpectralPeaks } from '@/hooks/useSpectralPeaks';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import {
  buildAmplitudeBars,
  buildSpectralBars,
  type SpectralBar,
} from '@/lib/audio/spectral-peaks';
import { keyboardSeekFraction } from '@/lib/audio/seek-accessibility';
import { cn } from '@/lib/utils';

const BAR_COUNT = 96;

interface Props {
  trackId: string;
  audioUrl?: string | null;
  peaksUrl?: string | null;
  /** 0..1 playhead position. */
  progress: number;
  isPlaying: boolean;
  canSeek: boolean;
  onSeek: (fraction: number) => void;
  /** Accessible name for the slider, normally the track title. */
  label: string;
  /** Needed for time-based keyboard seek steps (5s / 30s). */
  durationSeconds: number;
  className?: string;
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0;
}

export function SpectralWaveform({
  trackId, audioUrl, peaksUrl, progress, isPlaying, canSeek, onSeek, label,
  durationSeconds, className,
}: Props) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  const { bands, status } = useSpectralPeaks(trackId, audioUrl, BAR_COUNT);
  // Amplitude peaks are the fallback shape — already cached and cheap, and
  // they give us something to draw immediately while analysis runs.
  const { peaks } = useVisualPeaks(trackId, peaksUrl, BAR_COUNT);

  const bars: SpectralBar[] = useMemo(() => {
    if (bands) return buildSpectralBars(bands);
    if (peaks?.length) return buildAmplitudeBars(peaks);
    return [];
  }, [bands, peaks]);

  const pos = clamp01(progress);

  const seekFromClientX = useCallback((clientX: number) => {
    const el = laneRef.current;
    if (!el || !canSeek) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    onSeek(clamp01((clientX - r.left) / r.width));
  }, [canSeek, onSeek]);

  // Drag-to-scrub. Listeners live on window so the gesture survives the
  // pointer leaving the lane, which is how every real scrubber behaves.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => seekFromClientX(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, seekFromClientX]);

  // Uses the shared, tested helper rather than a local implementation, so
  // keyboard seek here matches every other scrubber in the app: 5s arrows,
  // 30s page steps, Home/End to the ends.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canSeek) return;
    const next = keyboardSeekFraction(e.key, pos, durationSeconds);
    if (next == null) return;
    e.preventDefault();
    onSeek(next);
  };

  const showThumb = isPlaying || hovering || dragging;

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={laneRef}
        role="slider"
        tabIndex={0}
        aria-label={`Seek ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
        aria-valuetext={`${fmt(pos * durationSeconds)} elapsed of ${fmt(durationSeconds)}`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (!canSeek) return;
          e.preventDefault();
          setDragging(true);
          seekFromClientX(e.clientX);
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          'group relative flex h-[68px] w-full items-center gap-[2px] overflow-hidden rounded-xl',
          'bg-white/[0.03] px-2 outline-none',
          'focus-visible:ring-1 focus-visible:ring-white/40',
          canSeek ? 'cursor-pointer' : 'cursor-not-allowed opacity-70',
        )}
      >
        {bars.length === 0 ? (
          <div className="h-[2px] w-full rounded-full bg-white/10" />
        ) : (
          bars.map((bar, i) => {
            const played = (i + 0.5) / bars.length <= pos;
            return (
              <span
                key={i}
                aria-hidden
                className="min-w-0 flex-1 rounded-[1px]"
                style={{
                  height: `${Math.max(3, bar.height * 100)}%`,
                  backgroundColor: bar.color,
                  // Unplayed audio is dimmed rather than recoloured, so the
                  // spectral information stays readable across the whole lane.
                  opacity: played ? 1 : 0.32,
                  transition: 'opacity 120ms linear',
                }}
              />
            );
          })
        )}

        {/* Playhead + Spotify-style dot */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 w-px bg-white/70"
          style={{ left: `${pos * 100}%` }}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white',
            'transition-[width,height,opacity] duration-150',
            showThumb ? 'opacity-100' : 'opacity-0',
            dragging ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5',
          )}
          style={{ left: `${pos * 100}%` }}
        />
      </div>

      {/* Legend — only meaningful once real band data exists. */}
      <div className="mt-1.5 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2.5">
          {status === 'ready' ? (
            <>
              <LegendDot color="rgb(232, 122, 90)" label="Low" />
              <LegendDot color="rgb(138, 200, 132)" label="Mid" />
              <LegendDot color="rgb(214, 226, 245)" label="High" />
            </>
          ) : (
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30">
              {status === 'analyzing' ? 'Analysing spectrum…' : 'Amplitude only'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/40">{label}</span>
    </span>
  );
}
