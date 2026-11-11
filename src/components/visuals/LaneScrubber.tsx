'use client';

/**
 * Three-lane scrolling scrubber (highs / mids / lows) with a FIXED centre
 * playhead: the waveform scrolls past it. Soft white blobs on near-black;
 * the part under the playhead swells with each band's LIVE energy from the
 * shared analyser (precomputed values when none is available).
 *
 * Drop-in for SpectralWaveform: same props. Drag/swipe scrubs, tap/click jumps,
 * arrow keys step 5 s, `role="slider"` with aria values.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpectralPeaks } from '@/hooks/useSpectralPeaks';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { keyboardSeekFraction } from '@/lib/audio/seek-accessibility';
import { cn } from '@/lib/utils';
import { clamp01, BAND_COUNT } from '@/lib/visuals/geometry';
import { DEFAULT_LANE_THEME, drawLanes, type LaneState, type LaneTheme } from '@/lib/visuals/lane-draw';
import {
  advancePosition, compactReadout, envFollow, laneEnergies, normaliseSeries, scrubFraction, seriesPeakAt, tapFraction,
} from '@/lib/visuals/lanes';
import { readBands, type LiveFrame } from '@/lib/visuals/analyser-hub';

const ANALYSIS_SLICES = 4096;
const DEFAULT_VISIBLE_SECONDS = 14;
const TAP_SLOP_PX = 5;

interface Props {
  trackId: string;
  audioUrl?: string | null;
  peaksUrl?: string | null;
  publicAnalysisUrl?: string | null;
  /** 0..1 playhead position. */
  progress: number;
  isPlaying: boolean;
  canSeek: boolean;
  onSeek: (fraction: number) => void;
  label: string;
  durationSeconds: number;
  height?: number;
  visibleSeconds?: number;
  theme?: LaneTheme;
  className?: string;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function LaneScrubber({
  trackId, audioUrl, peaksUrl, publicAnalysisUrl, progress, isPlaying, canSeek, onSeek, label, durationSeconds,
  height = 132, visibleSeconds = DEFAULT_VISIBLE_SECONDS, theme = DEFAULT_LANE_THEME, className,
}: Props) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const { bands, db, hz, status } = useSpectralPeaks(trackId, audioUrl, ANALYSIS_SLICES, undefined, publicAnalysisUrl);
  const { peaks, source: peaksSource } = useVisualPeaks(trackId, peaksUrl, ANALYSIS_SLICES);

  // Normalised series, top to bottom: high, mid, low. Real 3-band data when the
  // analysis exists; otherwise the amplitude peaks stand in for every lane
  // (scaled, honestly the same shape) so the control is never empty.
  const series = useMemo<LaneState['series']>(() => {
    if (bands) return [normaliseSeries(bands.high), normaliseSeries(bands.mid), normaliseSeries(bands.low)];
    const p = normaliseSeries(peaks);
    return [p, p, p];
  }, [bands, peaks]);
  const lowFi = !bands;

  const pos = clamp01(progress);
  const posRef = useRef(pos);
  const smoothRef = useRef(pos);
  const overrideRef = useRef<{ pos: number; until: number } | null>(null);
  const visibleRef = useRef(true);
  const stateRef = useRef<LaneState | null>(null);
  const scratch = useRef({ bands: new Float32Array(BAND_COUNT), energy: new Float32Array(3), frame: { silent: false, left: 0, right: 0 } as LiveFrame });
  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => { for (const e of entries) visibleRef.current = e.isIntersecting; });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const live = isPlaying && !reduced;

  // Size the backing store once per size change (dpr capped at 2) — never per frame.
  const dprRef = useRef(1);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }, [width, height]);

  // Paint. Static (paused / reduced motion): once per change. Playing + visible: rAF.
  // While playing the effect does NOT depend on `pos`, so the loop is not restarted
  // on every progress report.
  const staticPos = live ? 0 : pos;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);

    if (!stateRef.current) {
      stateRef.current = { series, pos, durationSeconds, visibleSeconds, live: new Float32Array(3), theme };
    }
    const s = stateRef.current;
    s.series = series; s.durationSeconds = durationSeconds; s.visibleSeconds = visibleSeconds; s.theme = theme;
    const sc = scratch.current;

    const energyAt = (p: number) => {
      for (let l = 0; l < 3; l += 1) sc.energy[l] = seriesPeakAt(series[l], p - 0.002, p + 0.002);
    };

    const currentPos = () => {
      const o = overrideRef.current;
      if (o && performance.now() < o.until) return o.pos;
      overrideRef.current = null;
      return posRef.current;
    };

    if (!live) {
      s.pos = smoothRef.current = currentPos();
      energyAt(s.pos);
      s.live.fill(0);
      drawLanes(ctx, width, height, s);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || !visibleRef.current) return;
      const target = currentPos();
      smoothRef.current = advancePosition(smoothRef.current, target, durationSeconds > 0 ? dt / durationSeconds : 0, true);
      s.pos = smoothRef.current;
      // Live band energy; precomputed values at the playhead when no analyser.
      if (readBands(sc.bands, sc.frame) && !sc.frame.silent) laneEnergies(sc.bands, sc.energy);
      else energyAt(s.pos);
      for (let l = 0; l < 3; l += 1) s.live[l] = envFollow(s.live[l], sc.energy[l], dt);
      drawLanes(ctx, width, height, s);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, width, height, series, durationSeconds, visibleSeconds, theme, staticPos]);

  // ── Interaction ───────────────────────────────────────────────────
  const gesture = useRef<{ x0: number; pos0: number; moved: boolean; id: number } | null>(null);

  const seekTo = useCallback((f: number) => {
    overrideRef.current = { pos: f, until: performance.now() + 600 };
    posRef.current = f;
    onSeek(f);
  }, [onSeek]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSeek || durationSeconds <= 0) return;
    gesture.current = { x0: e.clientX, pos0: overrideRef.current?.pos ?? posRef.current, moved: false, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    if (!g.moved && Math.abs(dx) < TAP_SLOP_PX) return;
    g.moved = true;
    seekTo(scrubFraction(g.pos0, dx, wrapRef.current?.clientWidth ?? 1, visibleSeconds, durationSeconds));
  };
  const endGesture = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (!g.moved && !cancelled) {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) seekTo(tapFraction(g.pos0, e.clientX - r.left, r.width, visibleSeconds, durationSeconds));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canSeek) return;
    const next = keyboardSeekFraction(e.key, pos, durationSeconds);
    if (next == null) return;
    e.preventDefault();
    seekTo(next);
  };

  const readout = useMemo(() => {
    if (!db || db.length === 0) return null;
    const i = Math.min(db.length - 1, Math.max(0, Math.round(pos * (db.length - 1))));
    return compactReadout(db[i], hz?.[i] ?? null);
  }, [db, hz, pos]);

  const elapsed = pos * durationSeconds;
  const remaining = Math.max(0, durationSeconds - elapsed);

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={wrapRef}
        role="slider"
        tabIndex={0}
        aria-label={`Seek ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
        aria-valuetext={`${fmtTime(elapsed)} elapsed of ${fmtTime(durationSeconds)}`}
        aria-busy={status === 'analyzing' || undefined}
        data-lane-scrubber
        data-lane-source={lowFi ? 'peaks' : 'bands'}
        data-peaks-source={peaksSource}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e)}
        onPointerCancel={(e) => endGesture(e, true)}
        className={cn(
          'relative w-full touch-pan-y select-none overflow-hidden rounded-xl bg-[#0b0b0d] outline-none',
          'focus-visible:ring-1 focus-visible:ring-white/60',
          canSeek ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-not-allowed opacity-70',
        )}
        style={{ height }}
      >
        <canvas ref={canvasRef} aria-hidden className="block h-full w-full" style={{ width: '100%', height: '100%' }} />

        {readout && (
          <div
            aria-live="off"
            className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums tracking-[0.08em] text-white/40"
          >
            {readout}
          </div>
        )}

        {/* Fixed centre playhead: thin, full height. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/80" />

        {status === 'analyzing' && (
          <span className="pointer-events-none absolute bottom-1.5 left-3 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
            Analysing…
          </span>
        )}
      </div>

      <div className="mt-1.5 flex justify-between px-0.5 font-mono text-[10px] tabular-nums text-white/40">
        <span>{fmtTime(elapsed)}</span>
        <span>−{fmtTime(remaining)}</span>
      </div>
    </div>
  );
}
