'use client';

import { useEffect, useRef, useState } from 'react';
import { audioSrc } from '@/lib/audio/url';
import { cn } from '@/lib/utils';

interface Props {
  /** Audio URL to visualize. Same shape as track.audio_url. */
  url: string | null | undefined;
  /** Precomputed peaks JSON (Float[]). Skips client-side decoding. */
  peaksUrl?: string | null;
  /** 0..duration seconds. Used to render the playhead + played fill. */
  currentTime: number;
  /** Total duration in seconds. */
  duration: number;
  /** Click-to-seek callback. Receives target time in seconds. */
  onSeek: (t: number) => void;
  /** Pixel height of the strip. Bars extend +/- half this from the
   *  midline (mirrored). Defaults to 64px. */
  height?: number;
  /** Played-portion color. Defaults to the app purple. */
  accent?: string;
  className?: string;
}

/**
 * Studio waveform — mirrored amplitude render with click-to-seek + hover
 * time tooltip. Built specifically for the studio scrub area where the
 * waveform IS the surface the user thinks they're touching, not just
 * chrome around a slider.
 *
 * Visual: bars extend symmetrically above + below a center line. The
 * portion before `currentTime` is filled with the accent color; the
 * rest is rendered in a muted gray. A 1px vertical playhead line sits
 * exactly at the current time. Hovering anywhere shows a time tooltip
 * at the cursor.
 *
 * Peaks pipeline:
 *   1. If `peaksUrl` is given, fetch the precomputed JSON (cheap).
 *   2. Otherwise fetch the audio bytes and decode via Web Audio API,
 *      downsample channel 0 to N peaks (N = canvas width / 2). The
 *      resulting peaks array gets cached in a module-level Map so the
 *      same URL doesn't re-decode on every mount.
 */
const PEAKS_CACHE = new Map<string, number[]>();

export function StudioWaveform({
  url,
  peaksUrl,
  currentTime,
  duration,
  onSeek,
  height = 64,
  accent = '#E7D7BE',
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // ── Resize observer ─────────────────────────────────────────────────
  // The canvas backing store has to match the device-pixel ratio for the
  // bars to render crisp. We track the wrapper's CSS width via
  // ResizeObserver and re-render whenever it changes.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Peaks load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!url) { setPeaks(null); return; }
    const key = url;
    const cached = PEAKS_CACHE.get(key);
    if (cached) { setPeaks(cached); return; }

    let aborted = false;
    (async () => {
      // Try precomputed peaks first — same JSON shape WaveSurfer expects.
      if (peaksUrl) {
        try {
          const r = await fetch(peaksUrl);
          if (r.ok) {
            const j = await r.json();
            const arr = Array.isArray(j) ? j : j?.data?.[0] ?? null;
            if (Array.isArray(arr) && arr.length > 0) {
              PEAKS_CACHE.set(key, arr as number[]);
              if (!aborted) setPeaks(arr as number[]);
              return;
            }
          }
        } catch {
          // Fall through to client-side decode.
        }
      }

      // Client-side decode fallback. We fetch the audio, decode via
      // Web Audio, and downsample channel 0 to ~512 peaks (enough for
      // a 1024px-wide canvas with 2px per bar). Decoding a full track
      // on the main thread blocks for ~100ms once; the result is then
      // cached for the lifetime of the page.
      try {
        const r = await fetch(audioSrc(url));
        if (!r.ok) return;
        const buf = await r.arrayBuffer();
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        const channel = decoded.getChannelData(0);
        const samples = 512;
        const block = Math.max(1, Math.floor(channel.length / samples));
        const out: number[] = [];
        for (let i = 0; i < samples; i++) {
          let max = 0;
          const start = i * block;
          const end = Math.min(channel.length, start + block);
          for (let j = start; j < end; j++) {
            const v = Math.abs(channel[j]);
            if (v > max) max = v;
          }
          out.push(max);
        }
        await ctx.close();
        PEAKS_CACHE.set(key, out);
        if (!aborted) setPeaks(out);
      } catch {
        // Silent fail — the bar list just stays empty, no crash.
      }
    })();
    return () => { aborted = true; };
  }, [url, peaksUrl]);

  // ── Canvas paint ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Bar layout: 2px-wide bars, 1px gap. Bar count = floor(width / 3).
    const barWidth = 2;
    const gap = 1;
    const barCount = Math.max(1, Math.floor(width / (barWidth + gap)));
    const mid = height / 2;
    // The fraction of the waveform that's "played" — drives the color
    // split between accent (played) and muted gray (unplayed).
    const playedFrac = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const playedX = playedFrac * width;

    // Bars themselves. Each bar samples a window of the peaks array
    // proportionally, taking the max of that window so transients
    // pop. If we haven't loaded peaks yet, draw a flat midline.
    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + gap);
      const norm = peaks
        ? peaks[Math.floor((i / barCount) * peaks.length)] ?? 0
        : 0;
      // Tiny minimum so the strip never collapses to a single line —
      // gives the empty-state a faint horizon to anchor on.
      const halfH = Math.max(1, norm * (height / 2 - 2));
      const isPlayed = x + barWidth / 2 <= playedX;
      ctx.fillStyle = isPlayed ? accent : 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, mid - halfH, barWidth, halfH * 2);
    }

    // Playhead — 1px vertical line at the current time. White at half
    // opacity so it reads but doesn't compete with the bars.
    if (duration > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(Math.max(0, Math.min(width - 1, playedX)), 0, 1, height);
    }
  }, [peaks, width, height, currentTime, duration, accent]);

  // ── Pointer interactions ────────────────────────────────────────────
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!wrapRef.current || duration <= 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setHoverX(e.clientX - rect.left);
  };
  const handleLeave = () => setHoverX(null);
  const hoverTime = hoverX != null && wrapRef.current && duration > 0
    ? (hoverX / wrapRef.current.getBoundingClientRect().width) * duration
    : null;

  return (
    <div
      ref={wrapRef}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={cn(
        'relative w-full cursor-pointer select-none rounded-lg overflow-hidden',
        'bg-gradient-to-b from-[#090907] to-[#070707] border border-white/[0.04]',
        className,
      )}
      style={{ height }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Hover tooltip — only when the cursor is inside the strip AND
          we know the duration. Positioned at the cursor x with a small
          offset so the bubble doesn't sit directly under the pointer. */}
      {hoverX != null && hoverTime != null && (
        <div
          className="absolute top-1 -translate-x-1/2 pointer-events-none px-1.5 py-0.5 rounded bg-[#211F1A] border border-[#3B372F] text-[9px] font-mono text-[#F7EBDD] whitespace-nowrap shadow-lg"
          style={{ left: hoverX }}
        >
          {fmtTime(hoverTime)}
        </div>
      )}
    </div>
  );
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
