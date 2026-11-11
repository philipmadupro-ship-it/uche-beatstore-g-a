/**
 * Canvas 2D draw functions, one per mode. Each is a small pure function of
 * (ctx, size, data): thin 1px lines on near-black, a faint wider pass for glow
 * (no shadowBlur — it is far too slow on a phone). No allocation per frame: the
 * scratch points live in module-level objects.
 */

import { BAND_COUNT, historyRow, polar, project, type Camera, type History } from './geometry';
import type { VisualMode } from './modes';

/**
 * Every colour and line weight a draw function uses comes from here, so a
 * different family (e.g. a single-accent "lab / HUD" look) is a new theme
 * object, not an edit to the draw functions.
 */
export interface VisualTheme {
  background: string;
  /** Main line colour (the live / newest trace). */
  accent: string;
  /** Everything else: older rows, grids, unlit bars. */
  secondary: string;
  /** Hairline width in CSS px, and the faint halo width. */
  line: number;
  glow: number;
  /** Top of the meter gradient (peak colour); the accent is the body. */
  peak: string;
}

export const DEFAULT_THEME: VisualTheme = {
  background: '#090907',
  accent: '#6DC6A4',
  secondary: '#ffffff',
  line: 1,
  glow: 3,
  peak: '#ffffff',
};

export interface Rect { x: number; y: number; w: number; h: number }

export interface DrawState {
  /** Smoothed bands, 0..1, length BAND_COUNT. */
  bands: Float32Array;
  history: History;
  /** Smoothed stereo peaks 0..1. */
  left: number;
  right: number;
  /** Smoothed meter ladder levels [left, right] for hold/decay. */
  /** Playhead 0..1, used for a tiny marker on static frames. */
  progress: number;
  /** True when drawing live analyser data rather than precomputed peaks. */
  live: boolean;
  theme: VisualTheme;
}

const p = { x: 0, y: 0, s: 1 };
const q = { x: 0, y: 0 };

function clear(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
}

/** Stroke the current path twice: a faint wide halo, then the 1px line. */
function strokeGlow(ctx: CanvasRenderingContext2D, color: string, alpha: number, glow: boolean, t: VisualTheme) {
  if (glow) {
    ctx.globalAlpha = alpha * 0.18;
    ctx.lineWidth = t.glow;
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  ctx.lineWidth = t.line;
  ctx.strokeStyle = color;
  ctx.stroke();
}

const cam: Camera = { width: 0, height: 0, distance: 2.6, heightScale: 0.34, horizon: 0.9 };

export function drawTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState, compact: boolean) {
  clear(ctx, w, h, s.theme.background);
  cam.width = w; cam.height = h;
  cam.heightScale = compact ? 0.42 : 0.36;
  const rows = s.history.rows.length;
  const cols = BAND_COUNT;
  ctx.lineJoin = 'round';
  // far -> near so nearer ridges occlude the ones behind.
  for (let age = rows - 1; age >= 0; age -= 1) {
    const row = historyRow(s.history, age);
    const z = -1 + 2 * (1 - age / rows);
    const near = 1 - age / rows;
    ctx.beginPath();
    for (let i = 0; i < cols; i += 1) {
      const x = (i / (cols - 1)) * 2 - 1;
      // taper the edges so the mesh reads as a mound, not a slab
      const edge = Math.sin((i / (cols - 1)) * Math.PI);
      project(cam, x, row[i] * edge, z, p);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    // occlusion fill below the ridge
    ctx.lineTo(p.x, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.theme.background;
    ctx.fill();
    // re-trace just the ridge for the stroke
    ctx.beginPath();
    for (let i = 0; i < cols; i += 1) {
      const x = (i / (cols - 1)) * 2 - 1;
      const edge = Math.sin((i / (cols - 1)) * Math.PI);
      project(cam, x, row[i] * edge, z, p);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    strokeGlow(ctx, age === 0 ? s.theme.accent : s.theme.secondary, 0.12 + 0.62 * near * near, age === 0, s.theme);
  }
  ctx.globalAlpha = 1;
}

export function drawCurve(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState, compact: boolean) {
  clear(ctx, w, h, s.theme.background);
  const pad = compact ? 8 : 14;
  const base = h - pad - 4;
  const amp = (h - pad * 2 - 8) * 0.95;
  // faint octave grid
  ctx.lineWidth = s.theme.line;
  ctx.strokeStyle = s.theme.secondary;
  ctx.globalAlpha = 0.05;
  ctx.beginPath();
  for (let i = 1; i < 6; i += 1) { const x = pad + ((w - pad * 2) * i) / 6; ctx.moveTo(x, pad); ctx.lineTo(x, base); }
  ctx.stroke();
  const n = BAND_COUNT;
  const b = s.bands;
  ctx.beginPath();
  // Catmull-Rom-ish smoothing via quadratic midpoints.
  let px = pad, py = base - b[0] * amp;
  ctx.moveTo(px, py);
  for (let i = 1; i < n; i += 1) {
    const x = pad + ((w - pad * 2) * i) / (n - 1);
    const y = base - b[i] * amp;
    ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    px = x; py = y;
  }
  ctx.lineTo(px, py);
  strokeGlow(ctx, s.theme.accent, 0.95, true, s.theme);
  // soft area under the line
  ctx.lineTo(w - pad, base); ctx.lineTo(pad, base); ctx.closePath();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = s.theme.accent;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawOrbit(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState, compact: boolean) {
  clear(ctx, w, h, s.theme.background);
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 6;
  const inner = maxR * 0.22;
  const n = BAND_COUNT;
  // mirror the spectrum across the vertical axis so the flower is symmetric
  const spokes = n * 2;
  ctx.lineJoin = 'round';
  for (let ring = 0; ring < 3; ring += 1) {
    const scale = 1 - ring * 0.22;
    ctx.beginPath();
    for (let i = 0; i <= spokes; i += 1) {
      const k = i % spokes;
      const band = k < n ? k : spokes - 1 - k;
      const v = s.bands[band] * scale;
      polar(k, spokes, inner + v * (maxR - inner) * (compact ? 1 : 1), cx, cy, q);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    const c = ring === 0 ? s.theme.accent : s.theme.secondary;
    strokeGlow(ctx, c, ring === 0 ? 0.9 : 0.4 - ring * 0.12, ring === 0, s.theme);
  }
  // fine petals: spokes from the inner circle to the outer curve
  ctx.beginPath();
  for (let k = 0; k < spokes; k += 2) {
    const band = k < n ? k : spokes - 1 - k;
    const v = s.bands[band];
    polar(k, spokes, inner, cx, cy, q);
    ctx.moveTo(q.x, q.y);
    polar(k, spokes, inner + v * (maxR - inner), cx, cy, q);
    ctx.lineTo(q.x, q.y);
  }
  ctx.strokeStyle = s.theme.secondary;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = s.theme.line;
  ctx.stroke();
  // inner ring
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.globalAlpha = 0.22;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

let gradCache: { ctx: CanvasRenderingContext2D; pad: number; h: number; t: VisualTheme; g: CanvasGradient } | null = null;
function meterGradient(ctx: CanvasRenderingContext2D, pad: number, h: number, t: VisualTheme): CanvasGradient {
  if (gradCache && gradCache.ctx === ctx && gradCache.pad === pad && gradCache.h === h && gradCache.t === t) return gradCache.g;
  const g = ctx.createLinearGradient(0, pad, 0, h - pad);
  g.addColorStop(0, t.peak);
  g.addColorStop(0.35, t.accent);
  g.addColorStop(1, t.accent);
  gradCache = { ctx, pad, h, t, g };
  return g;
}

/** Many thin horizontal bars stacked vertically; L and R side by side. */
export function drawMeters(ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState, compact: boolean) {
  clear(ctx, w, h, s.theme.background);
  const pad = compact ? 10 : 18;
  const gap = compact ? 10 : 22;
  const meterW = (w - pad * 2 - gap) / 2;
  const step = compact ? 3 : 4; // px per bar slot
  const bars = Math.max(8, Math.floor((h - pad * 2) / step));
  const levels = [s.left, s.right];
  ctx.lineWidth = s.theme.line;
  const grad = meterGradient(ctx, pad, h, s.theme);
  for (let m = 0; m < 2; m += 1) {
    const x0 = pad + m * (meterW + gap);
    const lit = Math.round(Math.min(1, levels[m] * 1.15) * bars);
    for (let i = 0; i < bars; i += 1) {
      const y = h - pad - i * step - 0.5;
      const on = i < lit;
      ctx.globalAlpha = on ? 0.95 : 0.07;
      ctx.strokeStyle = on ? grad : s.theme.secondary;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + meterW, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw one mode inside a rectangle of the canvas (clipped, origin moved), so a
 * layout can place several framed panels, each a different mode or data slice.
 */
export function drawPanel(
  mode: VisualMode, ctx: CanvasRenderingContext2D, rect: Rect, s: DrawState, compact: boolean,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(rect.x, rect.y);
  drawMode(mode, ctx, rect.w, rect.h, s, compact);
  ctx.restore();
}

export function drawMode(
  mode: VisualMode, ctx: CanvasRenderingContext2D, w: number, h: number, s: DrawState, compact: boolean,
) {
  switch (mode) {
    case 'curve': return drawCurve(ctx, w, h, s, compact);
    case 'orbit': return drawOrbit(ctx, w, h, s, compact);
    case 'meters': return drawMeters(ctx, w, h, s, compact);
    default: return drawTerrain(ctx, w, h, s, compact);
  }
}
