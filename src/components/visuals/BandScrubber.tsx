'use client';

/**
 * DAW-grade scrolling scrubber: a dense mirrored waveform on ONE centre line,
 * each line coloured by its frequency content (lows red, mids green, highs
 * blue; equal bands white), with a FIXED centre playhead the waveform scrolls
 * past. Height is the true peak of the mix; colour never changes it.
 *
 * Rendering is tiled: the coloured lines (played and dimmed) and the glow are
 * pre-rendered ONCE per (track, width, DPR) into ~2048 CSS px tiles; each frame
 * only blits the visible tiles at an integer device-pixel offset, then draws the
 * small live-reaction overlay and the playhead.
 *
 * Drop-in for SpectralWaveform's props. Drag/swipe scrubs, tap/click jumps,
 * arrow keys step 5 s, `role="slider"` with aria values.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpectralPeaks } from '@/hooks/useSpectralPeaks';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { keyboardSeekFraction } from '@/lib/audio/seek-accessibility';
import { cn } from '@/lib/utils';
import { clamp01, BAND_COUNT } from '@/lib/visuals/geometry';
import { advancePosition, bandEnergies, envFollow, scrubFraction, tapFraction } from '@/lib/visuals/scrub';
import {
  DEFAULT_BAND_THEME, GLOW_ALPHA_PLAYED, GLOW_ALPHA_UNPLAYED, GLOW_SCALE, renderBandGlow, renderBandWaveform,
  stripLayout, stripX, tileCount, type BandTheme, type StripLayout,
} from '@/lib/visuals/waveform-render';
import type { WaveformModel } from '@/lib/visuals/waveform-model';
import { readBands, type LiveFrame } from '@/lib/visuals/analyser-hub';

const DEFAULT_VISIBLE_SECONDS = 16;
const TAP_SLOP_PX = 5;
/** The live reaction reaches this far either side of the playhead, CSS px. */
const LIVE_RADIUS_CSS = 40;

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
  theme?: BandTheme;
  className?: string;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

interface TileSet {
  model: WaveformModel;
  theme: BandTheme;
  layout: StripLayout;
  width: number;
  count: number;
  played: HTMLCanvasElement[];
  dim: HTMLCanvasElement[];
  glow: HTMLCanvasElement[];
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  return ctx ? { c, ctx } : null;
}

/** Pre-render every tile of the strip (lines played / dimmed, and glow). */
function buildTiles(model: WaveformModel, theme: BandTheme, width: number, height: number, dpr: number, visibleSeconds: number, durationSeconds: number): TileSet {
  const layout = stripLayout(width, visibleSeconds, height, dpr);
  const count = tileCount(layout, durationSeconds);
  const set: TileSet = { model, theme, layout, width, count, played: [], dim: [], glow: [] };
  for (let k = 0; k < count; k += 1) {
    const p = makeCanvas(layout.tileDevWidth, layout.devHeight);
    const d = makeCanvas(layout.tileDevWidth, layout.devHeight);
    const g = makeCanvas(Math.ceil(layout.tileDevWidth * GLOW_SCALE), Math.ceil(layout.devHeight * GLOW_SCALE));
    if (!p || !d || !g) continue;
    renderBandWaveform(p.ctx, model, layout, k, theme, 'played');
    renderBandWaveform(d.ctx, model, layout, k, theme, 'unplayed');
    renderBandGlow(g.ctx, model, layout, k, theme);
    set.played.push(p.c); set.dim.push(d.c); set.glow.push(g.c);
  }
  return set;
}

export function BandScrubber({
  trackId, audioUrl, peaksUrl, publicAnalysisUrl, progress, isPlaying, canSeek, onSeek, label, durationSeconds: trackSeconds,
  height = 140, visibleSeconds = DEFAULT_VISIBLE_SECONDS, theme = DEFAULT_BAND_THEME, className,
}: Props) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const { model: deepModel, status } = useSpectralPeaks(trackId, audioUrl, 4096, undefined, publicAnalysisUrl);
  // Fallback when the full analysis is unavailable: the stored peaks file (about
  // 1 000 points for the whole track). Drawn coarse — never interpolated — and
  // flagged in `data-wave-source`; all three bands equal, so it reads white.
  const { peaks, source: peaksSource } = useVisualPeaks(trackId, peaksUrl, 1000);
  // `progress` is a fraction of the audio ELEMENT, and a store track streams a ~75 s
  // preview while `duration_seconds` is the full beat. So the strip's time base is the
  // analysed audio's own length whenever we have it, never the track's stored duration.
  const durationSeconds = deepModel ? deepModel.all.length / deepModel.columnsPerSecond : trackSeconds;
  const coarseModel = useMemo<WaveformModel | null>(() => {
    if (!(trackSeconds > 0) || peaks.length === 0) return null;
    const all = new Uint8Array(peaks.length);
    for (let i = 0; i < peaks.length; i += 1) all[i] = Math.max(0, Math.min(255, Math.round(peaks[i] * 255)));
    return { all, low: all, mid: all, high: all, columnsPerSecond: peaks.length / trackSeconds, peak: 1 };
  }, [peaks, trackSeconds]);
  const model = deepModel ?? coarseModel;
  const waveSource = deepModel ? 'analysis' : peaksSource === 'real' ? 'peaks-file' : 'placeholder';

  const pos = clamp01(progress);
  const posRef = useRef(pos);
  const smoothRef = useRef(pos);
  const liveRef = useRef(0);
  const overrideRef = useRef<{ pos: number; until: number } | null>(null);
  const visibleRef = useRef(true);
  const tilesRef = useRef<TileSet | null>(null);
  const dprRef = useRef(1);
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

  // Size the backing store, and (re)build the tiles — only when the track /
  // model, width, DPR or height change, never per frame.
  const [tilesVersion, setTilesVersion] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    tilesRef.current = model && durationSeconds > 0
      ? buildTiles(model, theme, width, height, dpr, visibleSeconds, durationSeconds)
      : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tell the paint effect the tiles changed
    setTilesVersion((v) => v + 1);
  }, [model, theme, width, height, visibleSeconds, durationSeconds]);

  /** Blit the visible tiles at an integer device-pixel offset, then the overlay and playhead. */
  const paintFrame = useCallback((ctx: CanvasRenderingContext2D, p: number, liveEnergy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height, dpr = dprRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, W, H);
    const cy = Math.round(H / 2);
    const px1 = Math.max(1, Math.round(dpr));
    ctx.fillStyle = theme.axis;
    ctx.fillRect(0, cy, W, px1);

    const t = tilesRef.current;
    const cx = Math.round(W / 2);
    if (t && t.played.length > 0) {
      const tileW = t.layout.tileDevWidth;
      const left = Math.round(stripX(t.layout, p * durationSeconds)) - cx;
      const first = Math.max(0, Math.floor(left / tileW));
      const last = Math.min(t.played.length - 1, Math.floor((left + W - 1) / tileW));
      const liveR = Math.round(LIVE_RADIUS_CSS * dpr);

      const side = (x0: number, x1: number, fn: (k: number, dx: number) => void) => {
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, H); ctx.clip();
        for (let k = first; k <= last; k += 1) fn(k, k * tileW - left);
        ctx.restore();
      };

      // 1) Glow BEHIND the lines (source-over, alpha ≤ 0.22), smoothed upscale.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = GLOW_ALPHA_PLAYED;
      side(0, cx, (k, dx) => ctx.drawImage(t.glow[k], 0, 0, t.glow[k].width, t.glow[k].height, dx, 0, tileW, H));
      ctx.globalAlpha = GLOW_ALPHA_UNPLAYED;
      side(cx, W, (k, dx) => ctx.drawImage(t.glow[k], 0, 0, t.glow[k].width, t.glow[k].height, dx, 0, tileW, H));
      // Live glow boost near the playhead (small, source-over, still behind the lines).
      if (liveEnergy > 0.02) {
        ctx.globalAlpha = Math.min(0.08, liveEnergy * 0.1);
        side(cx - liveR, cx + liveR, (k, dx) => ctx.drawImage(t.glow[k], 0, 0, t.glow[k].width, t.glow[k].height, dx, 0, tileW, H));
      }

      // 2) Lines: crisp, integer offsets, no smoothing. Played full colour, unplayed dimmed.
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      side(0, cx, (k, dx) => ctx.drawImage(t.played[k], dx, 0));
      side(cx, W, (k, dx) => ctx.drawImage(t.dim[k], dx, 0));
      // Live brightness boost: the same lines again, additively, inside the radius.
      // Transparent gaps add nothing, so the gaps stay dark and the hue is unchanged.
      if (liveEnergy > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.4, liveEnergy * 0.4);
        side(cx - liveR, cx, (k, dx) => ctx.drawImage(t.played[k], dx, 0));
        side(cx, cx + liveR, (k, dx) => ctx.drawImage(t.dim[k], dx, 0));
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // 3) Playhead: a 1 px line with a 3 px halo, snapped to whole device pixels.
    ctx.globalAlpha = 1;
    const halo = px1 * 3;
    ctx.fillStyle = theme.playheadHalo;
    ctx.fillRect(cx - Math.floor(halo / 2), 0, halo, H);
    ctx.fillStyle = theme.playhead;
    ctx.fillRect(cx - Math.floor(px1 / 2), 0, px1, H);
  }, [theme, durationSeconds]);

  const currentPos = useCallback(() => {
    const o = overrideRef.current;
    if (o && performance.now() < o.until) return o.pos;
    overrideRef.current = null;
    return posRef.current;
  }, []);

  // Paint. Static (paused / reduced motion): once per change. Playing + visible: rAF,
  // which does NOT depend on `pos`, so the loop is not restarted on every progress report.
  const staticPos = live ? 0 : pos;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sc = scratch.current;

    if (!live) {
      smoothRef.current = currentPos();
      liveRef.current = 0;
      paintFrame(ctx, smoothRef.current, 0);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || !visibleRef.current) return;
      smoothRef.current = advancePosition(smoothRef.current, currentPos(), durationSeconds > 0 ? dt / durationSeconds : 0, true);
      // Live band energy under the playhead; the model's own peak there when no analyser.
      let target: number;
      if (readBands(sc.bands, sc.frame) && !sc.frame.silent) {
        bandEnergies(sc.bands, sc.energy);
        target = Math.max(sc.energy[0], sc.energy[1], sc.energy[2]);
      } else {
        const m = tilesRef.current?.model;
        const i = m ? Math.min(m.all.length - 1, Math.floor(smoothRef.current * durationSeconds * m.columnsPerSecond)) : -1;
        target = m && i >= 0 ? Math.max(m.low[i], m.mid[i], m.high[i]) / 255 : 0;
      }
      liveRef.current = envFollow(liveRef.current, target, dt);
      paintFrame(ctx, smoothRef.current, liveRef.current);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, width, height, durationSeconds, staticPos, tilesVersion, paintFrame, currentPos]);

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
        data-wave-source={waveSource}
        data-wave-resolution={model ? Math.round(model.columnsPerSecond * 10) / 10 : undefined}
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
