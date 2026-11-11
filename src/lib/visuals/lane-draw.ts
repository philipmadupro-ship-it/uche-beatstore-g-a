/**
 * Canvas draw for the three-lane scrolling scrubber. Each lane is a MIRRORED
 * band around its own centre line, drawn as stacked translucent layers so the
 * edge falls off like a gaussian: bright core, grey shoulder, transparent rim.
 * Monochrome, additive ('lighter'). No allocation per frame.
 */

import { laneLayout, seriesPeakAt, type LaneBox } from './lanes';

export interface LaneTheme {
  background: string;
  /** Bright centre of each blob. */
  core: string;
  /** Outer glow. */
  halo: string;
  /** Faint lane centre line. */
  line: string;
}

export const DEFAULT_LANE_THEME: LaneTheme = {
  background: '#0b0b0d',
  core: '#ffffff',
  halo: '#8f8f8a',
  line: 'rgba(255,255,255,0.07)',
};

export interface LaneState {
  /** Normalised per-lane series, top to bottom: high, mid, low. Empty = nothing to draw. */
  series: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  /** Displayed playhead 0..1. */
  pos: number;
  durationSeconds: number;
  visibleSeconds: number;
  /** Smoothed live (or precomputed) energy per lane 0..1, top to bottom. */
  live: Float32Array;
  theme: LaneTheme;
}

const STEP = 2; // px per column
const LAYERS = 8;
const SCALE = [1, 0.86, 0.72, 0.58, 0.45, 0.33, 0.22, 0.12];
const ALPHA = [0.03, 0.04, 0.05, 0.07, 0.09, 0.12, 0.16, 0.22];
const boxes: LaneBox[] = [{ cy: 0, half: 0 }, { cy: 0, half: 0 }, { cy: 0, half: 0 }];

function lanePath(
  ctx: CanvasRenderingContext2D, s: LaneState, lane: number, box: LaneBox, w: number, scale: number, boost: number,
) {
  const centreTime = s.pos * s.durationSeconds;
  const secPerPx = s.visibleSeconds / w;
  const halfWindow = s.visibleSeconds / 2;
  const span = (secPerPx * STEP) / Math.max(1e-6, s.durationSeconds) / 2;
  const bloomPx = w * 0.22;
  const series = s.series[lane];
  const live = s.live[lane];
  ctx.beginPath();
  // top edge left -> right
  for (let x = 0; x <= w + STEP; x += STEP) {
    const t = centreTime - halfWindow + x * secPerPx;
    const f = t / s.durationSeconds;
    let v = t < 0 || t > s.durationSeconds ? 0 : seriesPeakAt(series, f - span, f + span);
    const d = Math.abs(x - w / 2);
    if (d < bloomPx) v *= 1 + live * boost * (0.5 + 0.5 * Math.cos((d / bloomPx) * Math.PI));
    const hgt = Math.max(0.6, Math.min(box.half, v * box.half)) * scale;
    if (x === 0) ctx.moveTo(x, box.cy - hgt); else ctx.lineTo(x, box.cy - hgt);
  }
  // bottom edge right -> left (mirror)
  for (let x = w + STEP; x >= 0; x -= STEP) {
    const t = centreTime - halfWindow + x * secPerPx;
    const f = t / s.durationSeconds;
    let v = t < 0 || t > s.durationSeconds ? 0 : seriesPeakAt(series, f - span, f + span);
    const d = Math.abs(x - w / 2);
    if (d < bloomPx) v *= 1 + live * boost * (0.5 + 0.5 * Math.cos((d / bloomPx) * Math.PI));
    const hgt = Math.max(0.6, Math.min(box.half, v * box.half)) * scale;
    ctx.lineTo(x, box.cy + hgt);
  }
  ctx.closePath();
}

export function drawLanes(ctx: CanvasRenderingContext2D, w: number, h: number, s: LaneState) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.theme.background;
  ctx.fillRect(0, 0, w, h);
  laneLayout(h, h < 120 ? 3 : 5, boxes);

  // lane centre lines
  ctx.fillStyle = s.theme.line;
  for (let l = 0; l < 3; l += 1) ctx.fillRect(0, boxes[l].cy, w, 1);

  if (s.durationSeconds > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (let l = 0; l < 3; l += 1) {
      for (let k = 0; k < LAYERS; k += 1) {
        ctx.fillStyle = k < 3 ? s.theme.halo : s.theme.core;
        ctx.globalAlpha = ALPHA[k];
        lanePath(ctx, s, l, boxes[l], w, SCALE[k], 0.9);
        ctx.fill();
      }
      // Live brightening under the playhead: the core layers again, clipped to
      // the bloom, weighted by that lane's current energy.
      const e = s.live[l];
      if (e > 0.02) {
        ctx.save();
        const bloom = w * 0.22;
        ctx.beginPath();
        ctx.rect(w / 2 - bloom, boxes[l].cy - boxes[l].half - 2, bloom * 2, boxes[l].half * 2 + 4);
        ctx.clip();
        ctx.fillStyle = s.theme.core;
        for (let k = 4; k < LAYERS; k += 1) {
          ctx.globalAlpha = ALPHA[k] * (0.4 + 1.6 * e);
          lanePath(ctx, s, l, boxes[l], w, SCALE[k], 0.9);
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
