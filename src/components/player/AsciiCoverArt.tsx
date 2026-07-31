'use client';

/**
 * Audio-reactive ASCII cover art.
 *
 * Recreates the 21st.dev "Custom ASCII art" effect in Canvas2D for the beat
 * preview card, driven by the track's own audio.
 *
 * SCOPE — this implements the configuration the owner supplied, not the whole
 * parameter surface. That config selects `renderMode: characters`,
 * `shaderSource.preset: smoke`, `grayscale: 100`, `blurType: tilt`,
 * `animStyle: shimmer`, and enables only the `vignette` and `filmGrain`
 * post-effects; every other render mode, blur type and post-effect is disabled
 * in it. Building the inactive branches would be dead code, so the props below
 * expose the knobs that are actually live and the rest are noted as omitted.
 *
 * PIPELINE (per frame)
 *   1. Procedural smoke rendered into an offscreen buffer at 1/cellSize scale —
 *      the ASCII pass only ever samples one value per cell, so rendering the
 *      shader at full resolution and averaging would be pure waste. This is the
 *      single biggest reason it can run at 60fps over a live player.
 *   2. Each pixel of that buffer = one cell. Luminance picks a glyph from the
 *      ramp; brightness picks its alpha.
 *   3. Tilt blur, vignette, film grain.
 *
 * AUDIO REACTIVITY — `level` (0..1) and `bands` come from the same analysis
 * that drives the waveform, so the art and the waveform respond to the same
 * moment in the track. Level drives shimmer amplitude and glyph brightness;
 * the low band nudges the smoke's turbulence so bass visibly moves it.
 */

import { useEffect, useRef } from 'react';
import { WAVEFORM_HUE, hslToRgb } from '@/lib/audio/spectral-peaks';
import { createLogger } from '@/lib/log';

const log = createLogger('player.ascii-cover-art');

/** `charSet: "standard"` — dark to light. Glyph index tracks luminance. */
const RAMP = ' .:-=+*#%@';

interface Props {
  /** The cover art to convert into ASCII. This is the source that gets
   *  sampled — the effect transforms the artwork rather than floating over it. */
  src: string;
  /** 0..1 current loudness; drives shimmer and glyph brightness. */
  level: number;
  /** 0..1 low-band energy; bass pushes the smoke. */
  bass?: number;
  /** Pauses the animation clock when false. */
  playing: boolean;
  className?: string;
}

/** Config values taken verbatim from the supplied JSON. */
const CFG = {
  cellSize: 10,
  contrast: 128,
  bgOpacity: 0.9,
  animSpeed: 1.0,          // animSpeed.intensity 100
  animIntensity: 0.6,      // animIntensity.intensity 60
  vignette: 0.58,
  filmGrain: 0.32,
  tiltFocus: 0.35,
  tiltPosition: 0.5,
  tiltFeather: 0.15,
  shaderSpeed: 0.40,
  shaderZoom: 1.0,
  shaderIntensity: 0.47,
  shaderWarp: 0.37,
  shaderGrain: 0.12,
};

/**
 * Smoke ramp, unified with the waveform's palette (the same `WAVEFORM_HUE` —
 * 33°/`#c8a47a` gold used for the musical-key badge app-wide) rather than the
 * 21st.dev config's own dark-green to pale-yellow stops.
 *
 * NOT four pre-baked RGB stops lerped together. An earlier version did that
 * and it silently broke monochromicity: linearly interpolating RGB between
 * two colours that individually sit on the same hue does not itself stay on
 * that hue for intermediate values — RGB space isn't hue-linear. That
 * produced a real spread of ~30 distinct hues on screen despite every anchor
 * stop being correct in isolation. Computing HSL directly for every input `t`
 * and converting once, the same way the waveform does in `spectral-peaks.ts`,
 * is what actually guarantees a single hue throughout.
 */
/**
 * `lift` (audio-level brightness boost) is folded into LIGHTNESS here, before
 * the HSL→RGB conversion, rather than applied as a post-hoc `r * lift` /
 * `g * lift` / `b * lift` scale on the caller side. That earlier approach
 * clamped each channel independently at 255 — whichever channel hit the
 * ceiling first got capped while the others kept scaling, distorting the
 * R:G:B ratio and therefore the hue itself. Measured live: glyph pixels at
 * high lightness/lift drifted as far as hue 153° despite `WAVEFORM_HUE` being
 * a constant 33°. Applying the boost to lightness instead means `hslToRgb`
 * still receives one fixed hue and clamps in HSL space (uniformly), so the
 * output hue can't drift regardless of how bright the moment is.
 */
function rampColor(t: number, lift = 1): [number, number, number] {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const lightness = Math.min(1, (0.06 + clamped * 0.86) * lift);
  // Saturation peaks in the low-mid range (matches the shape of the original
  // 4-stop ramp) and tapers toward both the darkest and palest ends.
  const saturation = 0.62 - Math.abs(clamped - 0.35) * 0.35;
  return hslToRgb(WAVEFORM_HUE / 360, Math.max(0.15, saturation), lightness);
}

/* ── Value noise + fbm. Deterministic, seeded, no dependency. ────────── */

function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  // Smoothstep the interpolant — linear blending makes fbm look like a grid.
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

export function AsciiCoverArt({ src, level, bass = 0, playing, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(level);
  const bassRef = useRef(bass);
  const playingRef = useRef(playing);
  /** Wakes the render loop when it has suspended itself. Set by the effect below. */
  const wakeRef = useRef<(() => void) | null>(null);

  // Refs rather than deps so the render loop is created once; writing them
  // during render would be unsafe under concurrent rendering. One effect rather
  // than three — they always fire together and each must also wake the loop,
  // which now suspends whenever nothing is animating.
  useEffect(() => {
    levelRef.current = level;
    bassRef.current = bass;
    playingRef.current = playing;
    wakeRef.current?.();
  }, [level, bass, playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Live, not a one-shot read: a viewer who turns reduced-motion ON while the
    // preview is open should have the animation stop immediately, not at the
    // next remount. `matches` was previously captured once at effect setup.
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motionQuery.matches;

    // Offscreen buffer: exactly one pixel per ASCII cell.
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d', { willReadFrequently: true });
    if (!bctx) return;

    let raf = 0;
    let t = 0;
    let cols = 0, rows = 0, dpr = 1;

    /**
     * Whether a frame is currently scheduled.
     *
     * The loop SUSPENDS when there is nothing moving to draw, instead of
     * running the full pipeline 60 times a second regardless. That pipeline is
     * not cheap — a `getImageData` readback, ~1k `fillText` calls, two gradient
     * allocations and a few hundred `Math.random()` grain dots per frame — and
     * it previously ran even while paused and even under reduced motion, where
     * only the clock `t` was frozen. On a public storefront the drawer can sit
     * open indefinitely, so that was pure battery drain, and the film grain
     * kept animating under reduced motion in violation of the project's own
     * hard constraint on it.
     */
    let running = false;
    const ensureRunning = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(draw);
    };

    // The cover art is the SOURCE the grid samples. Previously this rendered
    // procedural smoke and ignored the image entirely, so the effect had no
    // relationship to the artwork — the owner's "it does not interact with the
    // cover art". The smoke now only *displaces* where each cell samples from,
    // so the artwork stays recognisable while the audio moves it.
    //
    // Loaded through Next's own image optimizer (the same same-origin path
    // `next/image`/`CoverImage` already uses) rather than the raw R2 URL. An
    // earlier version fetched the R2 URL directly with `crossOrigin:
    // 'anonymous'`; the public bucket sends no CORS headers (documented
    // limitation — the same one that forces the audio analysis proxy), so
    // that load silently failed every time. `imgReady` never became true,
    // nothing was ever drawn, and there was no error surfaced anywhere to
    // say so. Same-origin avoids the CORS requirement entirely.
    const img = new Image();
    let imgReady = false;
    // Each of these makes the canvas out of date, so each must wake a suspended
    // loop — otherwise a cover that finishes loading while paused never appears.
    img.onload = () => { imgReady = true; ensureRunning(); };
    img.onerror = () => { imgReady = false; };
    img.src = `/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      cols = Math.max(1, Math.ceil(rect.width / CFG.cellSize));
      rows = Math.max(1, Math.ceil(rect.height / CFG.cellSize));
      buf.width = cols;
      buf.height = rows;
      return true;
    };

    // Set up the ResizeObserver FIRST and never bail out permanently.
    //
    // This used to be `if (!resize()) return;` — a one-shot call that gave up
    // for good if the canvas measured zero size on the very first effect run.
    // That is a real, common case here: the parent is a Drawer that animates
    // open (`animate-in fade-in duration-300`), so on mount the hero can still
    // be mid-transition and report a zero-size rect. Bailing out at that point
    // meant the ResizeObserver was never created, so nothing ever re-measured
    // it and the canvas stayed blank for the rest of its life — confirmed live:
    // every sampled pixel read alpha 0 no matter how long the preview had been
    // open. The observer now always exists, so as soon as the layout settles
    // to a real size it fires and `cols`/`rows` become valid.
    resize();
    const ro = new ResizeObserver(() => { resize(); ensureRunning(); });
    ro.observe(canvas);

    const onMotionChange = () => { reduced = motionQuery.matches; ensureRunning(); };
    motionQuery.addEventListener('change', onMotionChange);

    // A thrown frame must not silently kill the RAF chain — but it must not be
    // swallowed either. An earlier revision caught and discarded, which is
    // exactly what made the original blank-canvas bug so expensive to find:
    // a dead effect with no diagnostic anywhere. So: report the first failure,
    // tolerate a few transient ones (a resize mid-frame can legitimately
    // throw once), then stop rescheduling rather than burn 60fps forever on a
    // loop that cannot succeed.
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 10;

    const draw = () => {
      try {
        drawInner();
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures === 1) {
          log.warn('ascii cover art frame failed', {
            error: err instanceof Error ? err.message : String(err),
            cols, rows, src,
          });
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log.error('ascii cover art giving up after repeated frame failures', {
            failures: consecutiveFailures, src,
          });
          running = false;
          return; // stop rescheduling
        }
      }

      // Keep going only while something is actually moving. Paused (or reduced
      // motion) means the next frame would be identical to the one just drawn,
      // so suspend; `ensureRunning` wakes us when state, size or the image
      // changes.
      if (playingRef.current && !reduced) {
        raf = requestAnimationFrame(draw);
      } else {
        running = false;
      }
    };

    const drawInner = () => {
      // Not yet measured to a real size — try again next frame rather than
      // drawing into a zero-size buffer (or, worse, silently doing nothing
      // forever the way the old one-shot bailout did).
      if (cols <= 0 || rows <= 0) {
        return;
      }

      const lvl = levelRef.current;
      const bs = bassRef.current;

      if (playingRef.current && !reduced) {
        // animSpeed scales the clock; level makes loud passages evolve faster,
        // which is the clearest read that the art is following the track.
        t += 0.016 * CFG.shaderSpeed * CFG.animSpeed * (1 + lvl * 0.8);
      }

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cell = CFG.cellSize;

      /* 1 ─ Draw the COVER ART into the low-res buffer, one pixel per cell,
             displaced by the smoke field. Each cell therefore carries the
             artwork's own colour at a position that drifts with the audio. */
      bctx.clearRect(0, 0, cols, rows);
      if (imgReady) {
        // Bass widens the displacement, so an 808 visibly shoves the image.
        const push = (0.6 + bs * 3.4) * CFG.animIntensity;
        // Draw in a few horizontal bands, each offset by the smoke field. Far
        // cheaper than per-cell resampling and reads as the image rippling.
        const bands = 14;
        for (let i = 0; i < bands; i++) {
          const sy = (i / bands) * rows;
          const bh = Math.ceil(rows / bands) + 1;
          const n = fbm(i * 0.7, t * 1.6, 1, 3) - 0.5;
          const dx = n * push;
          bctx.drawImage(
            img,
            0, (i / bands) * img.height, img.width, img.height / bands,
            dx, sy, cols, bh,
          );
        }
      }

      /* 2 ─ ASCII pass. */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#03120E';
      ctx.globalAlpha = CFG.bgOpacity;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      const cells = bctx.getImageData(0, 0, cols, rows).data;
      ctx.font = `${cell}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const lum = cells[(cy * cols + cx) * 4] / 255;
          const gi = Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length));
          const ch = RAMP[gi];
          if (ch === ' ') continue;

          // Colour from the smoke ramp so glyphs keep the palette; brightness
          // lifts with level so the whole piece pulses with the track.
          const lift = 0.75 + lvl * 0.45;
          const [r, g, b] = rampColor(lum, lift);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.globalAlpha = 0.35 + lum * 0.65;
          ctx.fillText(ch, cx * cell, cy * cell);
        }
      }
      ctx.globalAlpha = 1;

      /* 3 ─ Tilt blur: sharp band across the middle, soft above and below.
             Approximated with gradient scrims rather than a real blur, which
             would cost a full-canvas convolution every frame for an effect
             that is barely distinguishable at this cell size. */
      const focusTop = h * (CFG.tiltPosition - CFG.tiltFocus / 2);
      const focusBot = h * (CFG.tiltPosition + CFG.tiltFocus / 2);
      const feather = h * CFG.tiltFeather;
      const scrim = ctx.createLinearGradient(0, 0, 0, h);
      scrim.addColorStop(0, 'rgba(3,18,14,0.55)');
      scrim.addColorStop(Math.max(0, (focusTop - feather) / h), 'rgba(3,18,14,0)');
      scrim.addColorStop(Math.min(1, (focusBot + feather) / h), 'rgba(3,18,14,0)');
      scrim.addColorStop(1, 'rgba(3,18,14,0.55)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);

      /* 4 ─ Vignette. */
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, `rgba(0,0,0,${CFG.vignette})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      /* 5 ─ Film grain. Sparse random dots rather than per-pixel noise: at
             this size the two are visually equivalent and this is ~100x
             cheaper per frame. */
      const grains = Math.floor((w * h) / 900 * CFG.filmGrain);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < grains; i++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      }
    };

    wakeRef.current = ensureRunning;
    ensureRunning();

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      wakeRef.current = null;
      ro.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
    };
    // `src` IS a dependency: without it the loop keeps the previously loaded
    // image when the user changes track, so the ASCII would render the wrong
    // cover. level/bass/playing are deliberately excluded — they are read
    // through refs so the loop is created once rather than per frame.
  }, [src]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
