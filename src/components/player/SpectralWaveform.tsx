'use client';

/**
 * DAW-style spectral waveform for the beat preview.
 *
 * Rendered on a canvas as a CONTINUOUS MIRRORED waveform — one filled column
 * per device pixel, drawn symmetrically about a centre axis — rather than the
 * discrete flex `<span>` bars this used to be. That was the owner's core
 * objection: *"mine is just bars… I want the waveform to really correspond to
 * the audio."* At ~1 column per physical pixel the shape reads as the audio,
 * the way FL Studio or Ableton draws it.
 *
 * Colour per column comes from real low/mid/high band energy, so you can see
 * where the 808 sits versus the hats. Colour is *information* here, which is
 * why it is exempt from the one-accent rule in docs/design-direction.md.
 *
 * A readout rides the waveform — `−46.8 dB · 405.2 Hz · G#4 −43¢` — read from
 * the analysis at the playhead slice.
 *
 * Canvas rather than DOM because a continuous waveform is hundreds of columns:
 * as elements that is hundreds of nodes re-styled every progress tick, which is
 * exactly the scrolling-jank problem removed elsewhere in this codebase.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpectralPeaks } from '@/hooks/useSpectralPeaks';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import { buildAmplitudeBars, buildSpectralBars, type SpectralBar } from '@/lib/audio/spectral-peaks';
import { formatReadout } from '@/lib/audio/pitch';
import { keyboardSeekFraction } from '@/lib/audio/seek-accessibility';
import { cn } from '@/lib/utils';

/**
 * Analysis resolution. Independent of render width: we analyse once at this
 * resolution and map columns onto it, so resizing never re-analyses.
 */
const ANALYSIS_SLICES = 512;

/** Column width in CSS pixels. 1 gives the dense reference look. */
const COLUMN_WIDTH = 1;

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
  /** Panel height in CSS pixels. */
  height?: number;
  className?: string;
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SpectralWaveform({
  trackId, audioUrl, peaksUrl, progress, isPlaying, canSeek, onSeek, label,
  durationSeconds, height = 132, className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  const { bands, db, hz, status } = useSpectralPeaks(trackId, audioUrl, ANALYSIS_SLICES);
  // Amplitude peaks are the fallback shape, and give us something to draw
  // immediately while the spectral analysis is still running.
  const { peaks } = useVisualPeaks(trackId, peaksUrl, ANALYSIS_SLICES);

  const bars: SpectralBar[] = useMemo(() => {
    if (bands) return buildSpectralBars(bands);
    if (peaks?.length) return buildAmplitudeBars(peaks);
    return [];
  }, [bands, peaks]);

  const pos = clamp01(progress);

  // Track the element's width so the column count follows the container. The
  // old fixed 96 bars became ~1.3px per bar on a 320px phone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const prefersReducedMotion = useReducedMotion();

  // ── Canvas paint ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || bars.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const columns = Math.max(1, Math.floor(width / COLUMN_WIDTH));
    const centreY = height / 2;
    // Leave headroom so a full-scale peak doesn't touch the panel edge.
    const maxHalf = (height / 2) * 0.86;
    const playedColumns = pos * columns;

    for (let x = 0; x < columns; x++) {
      // Map this column onto the analysis series.
      const bar = bars[Math.min(bars.length - 1, Math.floor((x / columns) * bars.length))];
      // Gamma curve on the amplitude. Linear scaling makes a mastered beat
      // look like a thin thread down the middle, because most columns sit far
      // below the peak; DAW displays lift the low end so the body of the track
      // is visible. 0.62 was picked against real previews — full enough to read
      // as a waveform, not so flat that dynamics disappear.
      const half = Math.max(0.75, Math.pow(bar.height, 0.62) * maxHalf);
      const played = x <= playedColumns;

      // Unplayed audio is dimmed, not hidden. At 0.28 the spectral colour —
      // the entire reason this waveform exists — was invisible across most of
      // the lane, since most of a track is unplayed most of the time. 0.55
      // keeps the progress distinction readable while the colour still carries.
      ctx.globalAlpha = played ? 1 : 0.55;
      ctx.fillStyle = bar.color;
      // Mirrored about the centre axis — the shape a DAW draws.
      ctx.fillRect(x * COLUMN_WIDTH, centreY - half, COLUMN_WIDTH, half * 2);
    }

    ctx.globalAlpha = 1;
  }, [bars, width, height, pos]);

  // ── Interaction ─────────────────────────────────────────────────
  const seekFromClientX = useCallback((clientX: number) => {
    const el = wrapRef.current;
    if (!el || !canSeek) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    onSeek(clamp01((clientX - r.left) / r.width));
  }, [canSeek, onSeek]);

  // Listeners on window so the drag survives the pointer leaving the lane,
  // which is how every real scrubber behaves.
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canSeek) return;
    const next = keyboardSeekFraction(e.key, pos, durationSeconds);
    if (next == null) return;
    e.preventDefault();
    onSeek(next);
  };

  // ── Readout at the playhead ─────────────────────────────────────
  const readout = useMemo(() => {
    if (!db || db.length === 0) return null;
    const i = Math.min(db.length - 1, Math.max(0, Math.round(pos * (db.length - 1))));
    return formatReadout(db[i], hz?.[i] ?? null);
  }, [db, hz, pos]);

  const elapsed = pos * durationSeconds;
  const remaining = Math.max(0, durationSeconds - elapsed);
  const showThumb = isPlaying || hovering || dragging;

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
          'group relative w-full overflow-hidden rounded-xl bg-[#0b0b0d] outline-none',
          'focus-visible:ring-1 focus-visible:ring-white/60',
          canSeek ? 'cursor-pointer' : 'cursor-not-allowed opacity-70',
        )}
        style={{ height }}
      >
        <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />

        {/* Readout — rides the waveform, as in the reference. Rendered as DOM
            rather than painted so it uses the real font stack and stays
            selectable/inspectable. tabular-nums stops it jittering as the
            figures change. */}
        {readout && (
          <div
            aria-live="off"
            className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/55 px-2.5 py-1 font-mono text-[10px] tabular-nums tracking-[0.08em] text-white/85 backdrop-blur-[2px]"
          >
            {readout}
          </div>
        )}

        {/* Playhead — a thin full-height line, no glow. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-white/80"
          style={{ left: `${pos * 100}%` }}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white',
            !prefersReducedMotion && 'transition-[width,height,opacity] duration-150',
            showThumb ? 'opacity-100' : 'opacity-0',
            dragging ? 'h-3 w-3' : 'h-2 w-2',
          )}
          style={{ left: `${pos * 100}%` }}
        />

        {status === 'analyzing' && (
          <span className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
            Analysing…
          </span>
        )}
      </div>

      {/* Elapsed / remaining — the reference shows time left, not total. */}
      <div className="mt-1.5 flex justify-between px-0.5 font-mono text-[10px] tabular-nums text-white/40">
        <span>{fmtTime(elapsed)}</span>
        <span>−{fmtTime(remaining)}</span>
      </div>
    </div>
  );
}

/** Honours the OS reduced-motion setting; a hard constraint in the design doc. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}
