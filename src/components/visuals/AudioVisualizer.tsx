'use client';

/**
 * Thin-line, audio-reactive visual (orbit / terrain / curve) on a
 * canvas. Reusable: give it a track id, its peaks URL and the playback state.
 *
 *  - Live: reads the shared analyser (lib/visuals/analyser-hub) while the player
 *    is playing and the canvas is on screen.
 *  - Static: before play, with no analyser, for a source that could not be
 *    analysed, or under prefers-reduced-motion — drawn from the track's peaks,
 *    with the playhead (`progress`) moving along them.
 *  - rAF runs ONLY while playing AND visible AND the tab is shown.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';
import {
  BAND_COUNT, bandsFromPeaks, createHistory, fillHistoryFromPeaks, pushHistory, smoothDecay,
} from '@/lib/visuals/geometry';
import { DEFAULT_THEME, drawMode, type DrawState, type VisualTheme } from '@/lib/visuals/draw';
import { readBands, type LiveFrame } from '@/lib/visuals/analyser-hub';
import type { VisualMode } from '@/lib/visuals/modes';

const HISTORY_ROWS = 26;
const PEAK_RESOLUTION = 512;

interface Props {
  mode: VisualMode;
  trackId: string;
  peaksUrl?: string | null;
  /** 0..1 playhead of the track being shown. */
  progress: number;
  /** True only when the player is playing THIS track. */
  isPlaying: boolean;
  compact?: boolean;
  height?: number;
  /** Colours + line weights; defaults to the store's mint-on-black. */
  theme?: VisualTheme;
  background?: string;
  label?: string;
  className?: string;
}

export function AudioVisualizer({
  mode, trackId, peaksUrl, progress, isPlaying, compact = false, height, theme: themeProp, background, label, className,
}: Props) {
  const theme = useMemo(
    () => ({ ...(themeProp ?? DEFAULT_THEME), ...(background ? { background } : {}) }),
    [themeProp, background],
  );
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { peaks } = useVisualPeaks(trackId, peaksUrl, PEAK_RESOLUTION);

  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const visibleRef = useRef(true);
  const progressRef = useRef(progress);
  const peaksRef = useRef<number[]>(peaks);
  const modeRef = useRef(mode);
  const stateRef = useRef<DrawState | null>(null);
  const scratch = useRef({ target: new Float32Array(BAND_COUNT), tmp: new Float32Array(BAND_COUNT), frame: { silent: false } as LiveFrame });

  progressRef.current = progress;
  peaksRef.current = peaks;
  modeRef.current = mode;

  const state = (): DrawState => {
    if (!stateRef.current) {
      stateRef.current = {
        bands: new Float32Array(BAND_COUNT), history: createHistory(HISTORY_ROWS, BAND_COUNT),
        progress: 0, live: false, theme,
      };
    }
    stateRef.current.theme = theme;
    return stateRef.current;
  };

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    if (!s) return;
    drawMode(modeRef.current, ctx, w, h, s, compact);
  }, [compact]);

  /** A full static frame from peaks at the current progress. */
  const drawStatic = useCallback(() => {
    const s = state();
    const sc = scratch.current;
    bandsFromPeaks(peaksRef.current, progressRef.current, sc.target);
    s.bands.set(sc.target);
    fillHistoryFromPeaks(peaksRef.current, progressRef.current, s.history, sc.tmp);
    s.live = false;
    if (canvasRef.current) canvasRef.current.dataset.source = 'peaks';
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, theme]);

  // Size + dpr (capped at 2).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const measure = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      if (w === sizeRef.current.w && h === sizeRef.current.h && dpr === sizeRef.current.dpr) return;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStatic();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [drawStatic]);

  // On screen?
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visibleRef.current = e.isIntersecting;
    });
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  // Static frames: not playing, reduced motion, new track/peaks/mode/progress.
  const live = isPlaying && !reduced;
  useEffect(() => {
    if (!live) drawStatic();
  }, [live, drawStatic, mode, peaks, progress, trackId]);

  // Live loop.
  useEffect(() => {
    if (!live) return;
    const s = state();
    const sc = scratch.current;
    let raf = 0;
    let tick = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !visibleRef.current) return;
      tick += 1;
      const analysed = readBands(sc.target, sc.frame) && !sc.frame.silent;
      if (!analysed) bandsFromPeaks(peaksRef.current, progressRef.current, sc.target);
      smoothDecay(s.bands, sc.target);
      s.live = analysed;
      const c = canvasRef.current;
      const src = analysed ? 'live' : 'peaks';
      if (c && c.dataset.source !== src) c.dataset.source = src;
      if ((tick & 1) === 0) pushHistory(s.history, s.bands);
      paint();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, paint]);

  return (
    <div
      ref={wrapRef}
      className={cn('relative w-full overflow-hidden rounded-xl', className)}
      style={{ height: height ?? (compact ? 120 : 220), background: theme.background }}
      role="img"
      aria-label={label ? `${label} audio visual` : 'Audio visual'}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" data-visual-mode={mode} data-testid="audio-visual-canvas" />
    </div>
  );
}
