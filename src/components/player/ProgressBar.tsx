'use client';

/**
 * ProgressBar — simple Spotify-style seekable track line for the PlayerBar.
 *
 * No waveform — a flat filled line + draggable thumb. Reads the global
 * `progress` (0..1) and writes seeks via `seekTo`. Click anywhere to jump;
 * drag the thumb to scrub. Replaces the inline WaveSurfer waveform in the
 * bottom bar (waveforms now live only on the beat page + preview drawer).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Current position 0..1. */
  progress: number;
  /** Seek to a fraction 0..1. */
  onSeek: (fraction: number) => void;
  /** Accent color for the filled portion + thumb. */
  accent?: string;
  className?: string;
}

export function ProgressBar({ progress, onSeek, accent = '#E8DCC8', className }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragFrac, setDragFrac] = useState(0);

  const frac = dragging ? dragFrac : Math.min(1, Math.max(0, progress));

  const fracFromEvent = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  // Global listeners while dragging so the scrub continues even if the
  // cursor leaves the thin track.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setDragFrac(fracFromEvent(e.clientX));
    const onUp = (e: MouseEvent) => {
      onSeek(fracFromEvent(e.clientX));
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, fracFromEvent, onSeek]);

  return (
    <div
      ref={trackRef}
      onClick={(e) => onSeek(fracFromEvent(e.clientX))}
      onMouseDown={(e) => {
        setDragFrac(fracFromEvent(e.clientX));
        setDragging(true);
      }}
      role="slider"
      aria-label="Seek"
      aria-valuenow={Math.round(frac * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      className={`group relative flex items-center cursor-pointer select-none h-4 ${className ?? ''}`}
    >
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/12" />
      {/* Filled */}
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full"
        style={{ width: `${frac * 100}%`, backgroundColor: accent }}
      />
      {/* Thumb — appears on hover / while dragging */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] transition-opacity ${dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ left: `calc(${frac * 100}% - 6px)` }}
      />
    </div>
  );
}
