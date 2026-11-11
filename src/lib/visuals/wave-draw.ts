/**
 * Canvas draw for the scrolling scrubber: a dense mirrored field of thin
 * vertical lines, one per column, MONOCHROME (white / silver on near-black).
 * Band energy changes brightness and glow only, never hue.
 *
 *  - Each column is the bucket-PEAK of the track's amplitude over the time span
 *    it covers (never a point sample), mirrored on the centre line.
 *  - Played side bright white, unplayed a dimmer silver; the area around the
 *    fixed playhead glows most and swells with live energy.
 *  - The glow is a second pass: the same lines drawn into a small offscreen
 *    canvas, then scaled up with smoothing (a cheap, even blur — no
 *    shadowBlur, no per-line filters, and it works where ctx.filter does not).
 * No allocation per frame.
 */

import { seriesPeakAt } from './lanes';

export interface WaveTheme {
  background: string;
  /** Played side: bright core. */
  played: string;
  /** Unplayed side: dimmer silver. */
  unplayed: string;
  /** Bloom colour. */
  glow: string;
  /** Faint centre line. */
  line: string;
}

export const DEFAULT_WAVE_THEME: WaveTheme = {
  background: '#0b0b0d',
  played: '#ffffff',
  unplayed: '#c9c9c4',
  glow: '#ffffff',
  line: 'rgba(255,255,255,0.08)',
};

export interface WaveState {
  /** Normalised peak amplitude series, 0..1 (full resolution). */
  amp: ArrayLike<number>;
  /** Normalised band-energy series 0..1; drives brightness and glow only. */
  energy: ArrayLike<number>;
  pos: number;
  durationSeconds: number;
  visibleSeconds: number;
  /** Smoothed live (or precomputed) energy under the playhead, 0..1. */
  live: number;
  theme: WaveTheme;
}

/** Offscreen canvas for the bloom pass, owned by the component. */
export interface GlowTarget { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

/** Column pitch and line width in CSS px: ~1.5 px lines with ~1 px gaps. */
export const COLUMN_PITCH = 2.5;
export const LINE_WIDTH = 1.5;
/** Glow canvas is this fraction of the size. */
export const GLOW_SCALE = 0.25;
/** Share of half the box height used at full scale. */
const FILL = 0.78;

export function drawWaveform(
  ctx: CanvasRenderingContext2D, w: number, h: number, s: WaveState, glow: GlowTarget | null,
) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.theme.background;
  ctx.fillRect(0, 0, w, h);
  const cy = h / 2;
  const cx = w / 2;
  ctx.fillStyle = s.theme.line;
  ctx.fillRect(0, cy, w, 1);
  if (s.durationSeconds <= 0 || w <= 0) { ctx.globalAlpha = 1; return; }

  const maxHalf = (h / 2) * FILL;
  const centreTime = s.pos * s.durationSeconds;
  const secPerPx = s.visibleSeconds / w;
  const halfWindow = s.visibleSeconds / 2;
  const spanFrac = (secPerPx * COLUMN_PITCH) / 2 / s.durationSeconds;
  const bloomPx = w * 0.2;
  const live = s.live;

  let gctx: CanvasRenderingContext2D | null = null;
  if (glow) {
    gctx = glow.ctx;
    gctx.globalCompositeOperation = 'source-over';
    gctx.clearRect(0, 0, glow.canvas.width, glow.canvas.height);
    gctx.fillStyle = s.theme.glow;
  }

  for (let x = 0; x < w; x += COLUMN_PITCH) {
    const px = x + LINE_WIDTH / 2;
    const t = centreTime - halfWindow + px * secPerPx;
    if (t < 0 || t > s.durationSeconds) continue;
    const f = t / s.durationSeconds;
    const a = seriesPeakAt(s.amp, f - spanFrac, f + spanFrac);
    const e = seriesPeakAt(s.energy, f - spanFrac, f + spanFrac);
    const played = px <= cx;
    const d = Math.abs(px - cx);
    const near = d < bloomPx ? 0.5 + 0.5 * Math.cos((d / bloomPx) * Math.PI) : 0;

    const hgt = Math.max(0.75, a * maxHalf * (1 + 0.06 * live * near));
    // Brightness: played bright, unplayed dim; louder / more energetic columns
    // and the area around the playhead lift it. Never a hue change.
    const base = played ? 0.9 : 0.46;
    const alpha = Math.min(1, base * (0.74 + 0.26 * e) + live * 0.3 * near);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = played ? s.theme.played : s.theme.unplayed;
    ctx.fillRect(x, cy - hgt, LINE_WIDTH, hgt * 2);

    if (gctx) {
      // Bloom strength follows loudness (strongest on transients) and the playhead.
      const ga = Math.min(1, (0.1 + 0.9 * a * a + 0.5 * e * e) * (played ? 0.75 : 0.35) + live * 0.5 * near * a);
      if (ga > 0.02) {
        gctx.globalAlpha = ga;
        gctx.fillRect((x - 0.5) * GLOW_SCALE, (cy - hgt * 1.04) * GLOW_SCALE, Math.max(1.2, (LINE_WIDTH + 1) * GLOW_SCALE), hgt * 2.08 * GLOW_SCALE);
      }
    }
  }

  if (gctx && glow) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(glow.canvas, 0, 0, glow.canvas.width, glow.canvas.height, 0, 0, w, h);
    ctx.globalAlpha = 0.45; // a second, wider-feeling pass: same lines, offset, softer
    ctx.drawImage(glow.canvas, 0, 0, glow.canvas.width, glow.canvas.height, -2, -1, w + 4, h + 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}
