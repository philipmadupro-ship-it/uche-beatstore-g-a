/**
 * Canvas draw for the scrolling band scrubber: ONE mirrored waveform on ONE
 * centre line. Each band (low, mid, high) is its own soft mirrored glow —
 * stacked translucent layers sized by that band's energy — and the three are
 * mixed ADDITIVELY ('lighter'): lows red, mids green, highs blue, so where all
 * three are strong the middle burns white. A bass-only hit reads red, a hat
 * blue, a full hit white. No allocation per frame.
 */

import { seriesPeakAt } from './lanes';

export interface BandColors { low: string; mid: string; high: string }

export interface WaveTheme {
  background: string;
  /** Tunable RGB of each band. Additive mixing makes strong overlaps white. */
  bandColors: BandColors;
  /** Faint centre line. */
  line: string;
}

export const DEFAULT_WAVE_THEME: WaveTheme = {
  background: '#0b0b0d',
  bandColors: { low: '#ff3b30', mid: '#30ff7a', high: '#3a7bff' },
  line: 'rgba(255,255,255,0.07)',
};

export interface WaveState {
  /** Normalised series, order low, mid, high. */
  series: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  /** Displayed playhead 0..1. */
  pos: number;
  durationSeconds: number;
  visibleSeconds: number;
  /** Smoothed live (or precomputed) energy per band 0..1, order low, mid, high. */
  live: Float32Array;
  theme: WaveTheme;
}

const STEP = 2; // px per column
const LAYERS = 8;
const SCALE = [1, 0.86, 0.72, 0.58, 0.45, 0.33, 0.22, 0.12];
const ALPHA = [0.035, 0.045, 0.06, 0.08, 0.1, 0.13, 0.17, 0.22];
// Relative reach of each band so the white core sits in the middle: lows are the
// widest swell, highs the finest.
const BAND_REACH = [1, 0.82, 0.62];

function bandPath(ctx: CanvasRenderingContext2D, s: WaveState, band: number, cy: number, maxHalf: number, w: number, scale: number) {
  const centreTime = s.pos * s.durationSeconds;
  const secPerPx = s.visibleSeconds / w;
  const halfWindow = s.visibleSeconds / 2;
  const span = (secPerPx * STEP) / Math.max(1e-6, s.durationSeconds) / 2;
  const bloomPx = w * 0.22;
  const series = s.series[band];
  const live = s.live[band];
  const reach = maxHalf * BAND_REACH[band];
  ctx.beginPath();
  for (let x = 0; x <= w + STEP; x += STEP) {
    const t = centreTime - halfWindow + x * secPerPx;
    const f = t / s.durationSeconds;
    let v = t < 0 || t > s.durationSeconds ? 0 : seriesPeakAt(series, f - span, f + span);
    const d = Math.abs(x - w / 2);
    if (d < bloomPx) v *= 1 + live * 0.9 * (0.5 + 0.5 * Math.cos((d / bloomPx) * Math.PI));
    const hgt = Math.max(0.5, Math.min(reach, v * reach)) * scale;
    if (x === 0) ctx.moveTo(x, cy - hgt); else ctx.lineTo(x, cy - hgt);
  }
  for (let x = w + STEP; x >= 0; x -= STEP) {
    const t = centreTime - halfWindow + x * secPerPx;
    const f = t / s.durationSeconds;
    let v = t < 0 || t > s.durationSeconds ? 0 : seriesPeakAt(series, f - span, f + span);
    const d = Math.abs(x - w / 2);
    if (d < bloomPx) v *= 1 + live * 0.9 * (0.5 + 0.5 * Math.cos((d / bloomPx) * Math.PI));
    const hgt = Math.max(0.5, Math.min(reach, v * reach)) * scale;
    ctx.lineTo(x, cy + hgt);
  }
  ctx.closePath();
}

export function drawBandWaveform(ctx: CanvasRenderingContext2D, w: number, h: number, s: WaveState) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.theme.background;
  ctx.fillRect(0, 0, w, h);
  const cy = h / 2;
  const maxHalf = (h / 2) * 0.92;

  ctx.fillStyle = s.theme.line;
  ctx.fillRect(0, cy, w, 1);

  if (s.durationSeconds > 0) {
    const colors = [s.theme.bandColors.low, s.theme.bandColors.mid, s.theme.bandColors.high];
    ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < 3; b += 1) {
      ctx.fillStyle = colors[b];
      for (let k = 0; k < LAYERS; k += 1) {
        ctx.globalAlpha = ALPHA[k];
        bandPath(ctx, s, b, cy, maxHalf, w, SCALE[k]);
        ctx.fill();
      }
      // Live brightening under the playhead: this band's inner layers again,
      // clipped to the bloom and weighted by its current energy.
      const e = s.live[b];
      if (e > 0.02) {
        ctx.save();
        const bloom = w * 0.22;
        ctx.beginPath();
        ctx.rect(w / 2 - bloom, 0, bloom * 2, h);
        ctx.clip();
        for (let k = 3; k < LAYERS; k += 1) {
          ctx.globalAlpha = ALPHA[k] * (0.4 + 1.8 * e);
          bandPath(ctx, s, b, cy, maxHalf, w, SCALE[k]);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Played material (left of the fixed playhead) a touch dimmer than what is ahead.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = s.theme.background;
    ctx.fillRect(0, 0, w / 2, h);
  }
  ctx.globalAlpha = 1;
}
