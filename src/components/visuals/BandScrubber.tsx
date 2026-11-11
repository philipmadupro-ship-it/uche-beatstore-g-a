'use client';

/**
 * Scrolling scrubber: a dense, monochrome, mirrored waveform on ONE centre line
 * with a FIXED centre playhead; the waveform scrolls past it. One column per
 * ~2.5 px, each the bucket-peak of the real amplitude. Band energy changes
 * brightness and glow only. The glow under the playhead swells with LIVE
 * energy from the shared analyser (precomputed band data when none).
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
import { DEFAULT_WAVE_THEME, GLOW_SCALE, drawWaveform, type GlowTarget, type WaveState, type WaveTheme } from '@/lib/visuals/wave-draw';
import {
  advancePosition, bandEnergies, envFollow, normaliseSeries, scrubFraction, seriesPeakAt, tapFraction,
} from '@/lib/visuals/lanes';
import { readBands, type LiveFrame } from '@/lib/visuals/analyser-hub';

const ANALYSIS_SLICES = 16384;
const DEFAULT_VISIBLE_SECONDS = 16;
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
  theme?: WaveTheme;
  className?: string;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function BandScrubber({
  trackId, audioUrl, peaksUrl, publicAnalysisUrl, progress, isPlaying, canSeek, onSeek, label, durationSeconds,
  height = 140, visibleSeconds = DEFAULT_VISIBLE_SECONDS, theme = DEFAULT_WAVE_THEME, className,
}: Props) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const { bands, amp, status } = useSpectralPeaks(trackId, audioUrl, ANALYSIS_SLICES, undefined, publicAnalysisUrl);
  const { peaks, source: peaksSource } = useVisualPeaks(trackId, peaksUrl, ANALYSIS_SLICES);

  // Full-resolution data, best first: the TRUE per-slice peak of the audio that
  // is actually playing (analysis at 16 384 slices); else the stored peaks file
  // (1 000 points for the whole track — coarse, never interpolated, only
  // bucket-peak resampled); else a deterministic placeholder. Brightness comes
  // from the band energies; they never colour anything.
  const wave = useMemo(() => {
    const ampSeries = amp ?? peaks;
    const norm = normaliseSeries(ampSeries, 0.78);
    let energy: ArrayLike<number> = norm;
    if (bands) {
      const lo = normaliseSeries(bands.low); const mi = normaliseSeries(bands.mid); const hi = normaliseSeries(bands.high);
      const n = Math.min(lo.length, mi.length, hi.length);
      const e = new Float32Array(n);
      for (let i = 0; i < n; i += 1) e[i] = Math.max(lo[i], mi[i], hi[i]);
      energy = e;
    }
    return { amp: norm, energy };
  }, [amp, bands, peaks]);
  const lowFi = !amp;

  const pos = clamp01(progress);
  const posRef = useRef(pos);
  const smoothRef = useRef(pos);
  const overrideRef = useRef<{ pos: number; until: number } | null>(null);
  const visibleRef = useRef(true);
  const stateRef = useRef<WaveState | null>(null);
  const glowRef = useRef<GlowTarget | null>(null);
  const scratch = useRef({ bands: new Float32Array(BAND_COUNT), energy: new Float32Array(3), frame: { silent: false } as LiveFrame });
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
    if (!glowRef.current) {
      const gc = document.createElement('canvas');
      const gx = gc.getContext('2d');
      if (gx) glowRef.current = { canvas: gc, ctx: gx };
    }
    if (glowRef.current) {
      glowRef.current.canvas.width = Math.max(1, Math.ceil(width * GLOW_SCALE));
      glowRef.current.canvas.height = Math.max(1, Math.ceil(height * GLOW_SCALE));
    }
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
      stateRef.current = { amp: wave.amp, energy: wave.energy, pos, durationSeconds, visibleSeconds, live: 0, theme };
    }
    const s = stateRef.current;
    s.amp = wave.amp; s.energy = wave.energy; s.durationSeconds = durationSeconds; s.visibleSeconds = visibleSeconds; s.theme = theme;
    const sc = scratch.current;
    const glow = glowRef.current;

    const currentPos = () => {
      const o = overrideRef.current;
      if (o && performance.now() < o.until) return o.pos;
      overrideRef.current = null;
      return posRef.current;
    };

    if (!live) {
      s.pos = smoothRef.current = currentPos();
      s.live = 0;
      drawWaveform(ctx, width, height, s, glow);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || !visibleRef.current) return;
      const posTarget = currentPos();
      smoothRef.current = advancePosition(smoothRef.current, posTarget, durationSeconds > 0 ? dt / durationSeconds : 0, true);
      s.pos = smoothRef.current;
      // Live band energy under the playhead; the precomputed energy there when
      // no analyser is available.
      let target: number;
      if (readBands(sc.bands, sc.frame) && !sc.frame.silent) {
        bandEnergies(sc.bands, sc.energy);
        target = Math.max(sc.energy[0], sc.energy[1], sc.energy[2]);
      } else {
        target = seriesPeakAt(wave.energy, s.pos - 0.002, s.pos + 0.002);
      }
      s.live = envFollow(s.live, target, dt);
      drawWaveform(ctx, width, height, s, glow);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, width, height, wave, durationSeconds, visibleSeconds, theme, staticPos]);

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
        data-band-scrubber
        data-band-source={lowFi ? 'peaks' : 'analysis'}
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
