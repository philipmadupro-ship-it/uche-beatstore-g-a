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
const ANALYSIS_SLICES = 4096;

/** Column width in CSS pixels. 1 gives the dense reference look. */
const COLUMN_WIDTH = 1;

/**
 * How many seconds of audio the scrolling window shows.
 *
 * The playhead stays centred and the waveform moves past it, so this sets the
 * zoom. ~14s shows roughly 8 bars at trap tempo — enough to read the groove and
 * see a transient arriving, without the columns becoming a blur.
 */
const DEFAULT_VISIBLE_SECONDS = 14;

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
  /** Seconds of audio visible in the scrolling window. */
  visibleSeconds?: number;
  className?: string;
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0;
}

/** Blend an `rgb()` string toward white by `amount` (0..1). */
function lighten(color: string, amount: number): string {
  const m = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) return color;
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return `rgb(${mix(+m[1])}, ${mix(+m[2])}, ${mix(+m[3])})`;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SpectralWaveform({
  trackId, audioUrl, peaksUrl, progress, isPlaying, canSeek, onSeek, label,
  durationSeconds, height = 132, visibleSeconds = DEFAULT_VISIBLE_SECONDS, className,
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

  // ── Audio-reactive canvas paint ─────────────────────────────────
  //
  // Driven by requestAnimationFrame rather than repainting on each `progress`
  // prop change. The player reports progress only a few times a second, so
  // painting on that alone makes the visual step rather than move. The loop
  // interpolates between reports, so the waveform breathes with the track and
  // stays locked to the slider and the clock.
  //
  // "Reactive" here means reacting to the real audio at the playhead — the
  // precomputed per-slice level and band mix — not to a live AnalyserNode. A
  // live analyser would need `createMediaElementSource`, which requires CORS on
  // the audio (the wall that already forces the analysis proxy) and would route
  // playback through Web Audio, endangering the synchronous tap-to-play path.
  // Precomputed data is the same information without either risk.
  const posRef = useRef(pos);
  const smoothPosRef = useRef(pos);
  const levelRef = useRef(0);
  // Synced in an effect rather than during render: writing a ref mid-render is
  // unsafe under concurrent rendering, where a render can be discarded.
  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || bars.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const columns = Math.max(1, Math.floor(width / COLUMN_WIDTH));
    const centreY = height / 2;
    const maxHalf = (height / 2) * 0.86;

    /** Normalised 0..1 loudness at a given position, from the dB series. */
    const levelAt = (p: number): number => {
      if (!db || db.length === 0) return 0;
      const i = Math.min(db.length - 1, Math.max(0, Math.round(p * (db.length - 1))));
      // −45dB..0dB maps to 0..1; below that is effectively silence.
      return clamp01((db[i] + 45) / 45);
    };

    let raf = 0;

    const paint = () => {
      // Ease toward the reported position instead of snapping to it.
      const target = posRef.current;
      const delta = target - smoothPosRef.current;
      // Large jumps are seeks, not playback — follow those immediately or the
      // waveform would visibly glide after the user drags the slider.
      smoothPosRef.current = Math.abs(delta) > 0.02 ? target : smoothPosRef.current + delta * 0.25;
      const p = smoothPosRef.current;

      // Smooth the level too, so the bloom pulses with the music rather than
      // flickering on every slice boundary.
      const targetLevel = levelAt(p);
      levelRef.current += (targetLevel - levelRef.current) * 0.2;
      const level = prefersReducedMotion ? 0 : levelRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Playhead is FIXED at the centre and the waveform scrolls past it,
      // showing only a window around the current position — the way a DAW
      // transport reads. Previously the whole track was drawn statically with a
      // travelling playhead, which is a progress bar, not a transport: at three
      // minutes across 350px each column spanned ~0.5s, so nothing visibly
      // moved and none of the detail was legible.
      const headX = width / 2;
      const halfWindow = visibleSeconds / 2;
      const centreTime = p * durationSeconds;
      // Seconds represented by one column, used to map x <-> time.
      const secondsPerColumn = visibleSeconds / columns;
      // How far the reactive bloom reaches either side of the playhead.
      const bloomPx = width * 0.06;

      for (let x = 0; x < columns; x++) {
        const px = x * COLUMN_WIDTH;
        // Time this column represents.
        const t = centreTime - halfWindow + x * secondsPerColumn;
        // Before the start or past the end there is nothing to draw — that is
        // what keeps the view honest about where you are in the track.
        if (t < 0 || t > durationSeconds) continue;

        const frac = durationSeconds > 0 ? t / durationSeconds : 0;
        const bar = bars[Math.min(bars.length - 1, Math.max(0, Math.floor(frac * bars.length)))];

        // Gamma curve: linear scaling makes a mastered beat look like a thin
        // thread, since most columns sit far below the peak. DAW displays lift
        // the low end so the body of the track is visible.
        let half = Math.pow(bar.height, 0.62) * maxHalf;

        // Reactive bloom — columns near the playhead swell with the current
        // loudness, so the waveform visibly pumps in time with the beat.
        const dist = Math.abs(px - headX);
        if (dist < bloomPx) {
          const falloff = 1 - dist / bloomPx;
          half *= 1 + level * 0.55 * falloff * falloff;
        }
        half = Math.max(0.75, Math.min(maxHalf * 1.12, half));

        // Everything left of the centre has been played. Unplayed audio is
        // dimmed, not hidden, so the spectral colour still carries.
        ctx.globalAlpha = t <= centreTime ? 1 : 0.55;

        // Two-tone column: a brighter core inside a saturated envelope. Both
        // reference players show this — a light band running through the middle
        // of the waveform with deeper colour at the extremes. It reads as far
        // more detailed than a flat column because it separates sustained
        // energy (the core) from transient peaks (the envelope), and it is what
        // gives Serato's waveform its depth.
        //
        // Columns are drawn 0.15px wider than their step so neighbours overlap
        // very slightly; without that, sub-pixel positioning leaves hairline
        // gaps that read as vertical banding across the lane.
        ctx.fillStyle = bar.color;
        ctx.fillRect(px, centreY - half, COLUMN_WIDTH + 0.15, half * 2);

        // Inner core, scaled by how much of the column is sustained rather than
        // peak. Lightened toward white rather than a fixed colour so it keeps
        // the column's own hue.
        const coreHalf = half * 0.42;
        ctx.fillStyle = lighten(bar.color, 0.45);
        ctx.fillRect(px, centreY - coreHalf, COLUMN_WIDTH + 0.15, coreHalf * 2);
      }

      // Glow behind the playhead, tinted by whichever band currently dominates
      // and scaled by loudness — the clearest read that the visual is tracking
      // the audio and not just the clock.
      if (level > 0.02) {
        const headBar = bars[Math.min(bars.length - 1, Math.floor(p * bars.length))];
        const g = ctx.createRadialGradient(headX, centreY, 0, headX, centreY, bloomPx * 1.6);
        g.addColorStop(0, headBar.color);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.16 * level;
        ctx.fillStyle = g;
        ctx.fillRect(headX - bloomPx * 1.6, 0, bloomPx * 3.2, height);
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [bars, db, width, height, prefersReducedMotion, durationSeconds, visibleSeconds]);

  // ── Interaction ─────────────────────────────────────────────────
  // Seeking maps through the visible WINDOW, not the full width: with the
  // playhead centred, clicking left of centre means "jump back this many
  // seconds", not "jump to this fraction of the track".
  const seekFromClientX = useCallback((clientX: number) => {
    const el = wrapRef.current;
    if (!el || !canSeek || durationSeconds <= 0) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const offsetFromCentre = (clientX - r.left) / r.width - 0.5;
    const t = posRef.current * durationSeconds + offsetFromCentre * visibleSeconds;
    onSeek(clamp01(t / durationSeconds));
  }, [canSeek, onSeek, durationSeconds, visibleSeconds]);

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
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/80"
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white',
            !prefersReducedMotion && 'transition-[width,height,opacity] duration-150',
            showThumb ? 'opacity-100' : 'opacity-0',
            dragging ? 'h-3 w-3' : 'h-2 w-2',
          )}
          style={{ left: '50%' }}
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
