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

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayer } from '@/hooks/usePlayer';

/* ─── Constants ────────────────────────────────────────────── */

const BAR_COUNT = 72;          // number of bars rendered in the SVG
const BAR_MIN_H = 0.08;        // minimum bar height as fraction of container
const BAR_MAX_H = 1.0;         // maximum bar height

/* ─── Seeded PRNG ───────────────────────────────────────────── */
// Mulberry32 — fast, deterministic, seedable. We seed with the track ID
// so the same track always renders the same synthetic waveform.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

function syntheticBars(trackId: string, count: number): number[] {
  const rand = mulberry32(seedFromString(trackId));
  // Envelope: rise over first 20%, sustain in the middle, fall last 15%
  return Array.from({ length: count }, (_, i) => {
    const pos = i / count;
    const envelope =
      pos < 0.2
        ? 0.3 + 0.7 * (pos / 0.2)
        : pos > 0.85
          ? 0.3 + 0.7 * ((1 - pos) / 0.15)
          : 1;
    const base = rand() * 0.7 + 0.3;
    return Math.max(BAR_MIN_H, Math.min(BAR_MAX_H, base * envelope));
  });
}

/* ─── Peaks fetch ───────────────────────────────────────────── */

interface PeaksFile {
  version: number;
  peaks: number[];
  duration: number;
  length: number;
}

async function loadPeaks(url: string, signal: AbortSignal): Promise<number[] | null> {
  try {
    const res = await fetch(url, { signal, cache: 'force-cache' });
    if (!res.ok) return null;
    const json = (await res.json()) as PeaksFile;
    if (!json?.peaks?.length) return null;
    return json.peaks;
  } catch {
    return null;
  }
}

/** Downsample or upsample `peaks` to exactly `targetCount` bars. */
function resample(peaks: number[], targetCount: number): number[] {
  if (peaks.length === 0) return Array(targetCount).fill(0.5);
  const out: number[] = [];
  for (let i = 0; i < targetCount; i++) {
    const srcIdx = (i / (targetCount - 1)) * (peaks.length - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, peaks.length - 1);
    const t = srcIdx - lo;
    const raw = Math.abs(peaks[lo]!) * (1 - t) + Math.abs(peaks[hi]!) * t;
    out.push(raw);
  }
  // Normalize to [BAR_MIN_H, BAR_MAX_H]
  const max = Math.max(...out, 1e-6);
  return out.map((v) => BAR_MIN_H + (v / max) * (BAR_MAX_H - BAR_MIN_H));
}

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
  const [bars, setBars] = useState<number[]>(() => syntheticBars(trackId, BAR_COUNT));
  const [peaksLoaded, setPeaksLoaded] = useState(false);

  const { progress, seekTo } = usePlayer();

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
        loadPeaks(peaksUrl, controller.signal).then((rawPeaks) => {
          if (!rawPeaks) return;
          setBars(resample(rawPeaks, BAR_COUNT));
          setPeaksLoaded(true);
        });
      },
      { rootMargin: '100px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [peaksUrl, peaksLoaded]);

  // Reset to synthetic shape when the trackId changes (card reuse).
  useEffect(() => {
    setBars(syntheticBars(trackId, BAR_COUNT));
    setPeaksLoaded(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

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

  const fillPct = isActive ? progress * 100 : 0;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{ height }}
      className={`relative w-full overflow-hidden ${isActive ? 'cursor-col-resize' : onPlay ? 'cursor-pointer' : 'cursor-default'}`}
      role={isActive ? 'slider' : undefined}
      aria-label={isActive ? 'Seek' : undefined}
      aria-valuenow={isActive ? Math.round(progress * 100) : undefined}
    >
      <svg
        viewBox={`0 0 ${BAR_COUNT * 3 - 1} 100`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        {bars.map((h, i) => {
          const x = i * 3;
          const barH = h * 100;
          const y = (100 - barH) / 2;
          const playedFrac = i / BAR_COUNT;
          const isPlayed = isActive && playedFrac < progress;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={2}
              height={barH}
              rx={1}
              className={`transition-colors duration-75 ${
                isPlayed ? 'fill-[#D4BFA0]' : isActive ? 'fill-[#4a3f2e]' : 'fill-[#2d2620]'
              }`}
            />
          );
        })}
      </svg>

      {/* Cursor line on the active track */}
      {isActive && (
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-[#E8DCC8]/80 rounded-full pointer-events-none"
          style={{ left: `${fillPct}%`, transform: 'translateX(-50%)' }}
        />
      )}
    </div>
  );
}
