/**
 * Pure rendering of the DAW-style band waveform onto a rectangle sink
 * (`fillRect` + `fillStyle` + `globalAlpha`), so it runs on a canvas in the app
 * and on a software raster in tests.
 *
 *  - One screen column per `devPitch` device pixels: a ~1.5 CSS px line with a
 *    ~1 CSS px gap, every x and width snapped to WHOLE device pixels.
 *  - Height comes from `all` only. Colour comes from the Mixxx-style
 *    "max-of-three" idea (own code): rgb = lo·LOW + mid·MID + hi·HIGH, divided
 *    by its largest channel, so hue is fully saturated and equal bands are
 *    white; a column with no band energy is skipped.
 *  - Colours are worked out when a tile is rendered (once per track / width /
 *    DPR), never per frame.
 */

import type { WaveformModel } from './waveform-model';

export interface BandTheme {
  background: string;
  /** Low / mid / high band colours. Mixed as 0..1 vectors. */
  bandColors: { low: string; mid: string; high: string };
  /** Per-band gain applied before mixing (default 1, 1, 1). */
  bandGain: [number, number, number];
  /** Centre axis. */
  axis: string;
  playhead: string;
  playheadHalo: string;
}

export const DEFAULT_BAND_THEME: BandTheme = {
  background: '#0b0b0d',
  bandColors: { low: '#FF2D2D', mid: '#33FF66', high: '#2E7BFF' },
  bandGain: [1, 1, 1],
  axis: 'rgba(255,255,255,0.10)',
  playhead: '#ffffff',
  playheadHalo: 'rgba(255,255,255,0.15)',
};

/** Fraction of half the box height used at full scale. */
export const HEIGHT_FILL = 0.78;
/** Column pitch and line width, CSS px. */
export const PITCH_CSS = 2.5;
export const LINE_CSS = 1.5;
/** Glow lives in an offscreen this fraction of the size, then is scaled up. */
export const GLOW_SCALE = 0.25;
/** Glow is drawn BEHIND the lines at these alphas (≤ 0.22). */
export const GLOW_ALPHA_PLAYED = 0.22;
export const GLOW_ALPHA_UNPLAYED = 0.12;
/** Tiles are about this wide, CSS px. */
export const TILE_CSS = 2048;

export interface RectSink {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Max-of-three colour. `lo`, `mid`, `hi` are 0..255 band peaks. Writes a
 * fully-saturated 0..1 rgb into `out` and returns true, or returns false when
 * the column has no band energy (the caller skips it).
 */
export function columnColour(
  lo: number, mid: number, hi: number,
  vecs: { low: Rgb; mid: Rgb; high: Rgb },
  gain: [number, number, number],
  out: Rgb,
): boolean {
  const l = (lo / 255) * gain[0];
  const m = (mid / 255) * gain[1];
  const h = (hi / 255) * gain[2];
  const r = l * vecs.low[0] + m * vecs.mid[0] + h * vecs.high[0];
  const g = l * vecs.low[1] + m * vecs.mid[1] + h * vecs.high[1];
  const b = l * vecs.low[2] + m * vecs.mid[2] + h * vecs.high[2];
  const mx = Math.max(r, g, b);
  if (!(mx > 0)) return false;
  out[0] = r / mx; out[1] = g / mx; out[2] = b / mx;
  return true;
}

/** Unplayed: the same hue at 50% brightness, mixed 20% toward grey #8a8a8a. */
const GREY = 0x8a / 255;
export function dimColour(c: Rgb, out: Rgb): Rgb {
  out[0] = c[0] * 0.5 * 0.8 + GREY * 0.2;
  out[1] = c[1] * 0.5 * 0.8 + GREY * 0.2;
  out[2] = c[2] * 0.5 * 0.8 + GREY * 0.2;
  return out;
}

export interface StripLayout {
  dpr: number;
  cssHeight: number;
  /** Seconds per CSS px along the strip. */
  secPerPx: number;
  /** Device px per column, and per line. */
  devPitch: number;
  lineDev: number;
  columnsPerTile: number;
  /** Tile width in device px: a whole number of columns. */
  tileDevWidth: number;
  devHeight: number;
}

export function stripLayout(cssWidth: number, visibleSeconds: number, cssHeight: number, dpr: number): StripLayout {
  const devPitch = Math.max(2, Math.round(PITCH_CSS * dpr));
  const lineDev = Math.max(1, Math.min(devPitch - 1, Math.round(LINE_CSS * dpr)));
  const columnsPerTile = Math.max(1, Math.round((TILE_CSS * dpr) / devPitch));
  return {
    dpr, cssHeight,
    secPerPx: visibleSeconds / Math.max(1, cssWidth),
    devPitch, lineDev, columnsPerTile,
    tileDevWidth: columnsPerTile * devPitch,
    devHeight: Math.max(1, Math.round(cssHeight * dpr)),
  };
}

/** Number of tiles needed to cover `durationSeconds` of strip. */
export function tileCount(layout: StripLayout, durationSeconds: number): number {
  const stripDev = (durationSeconds / layout.secPerPx) * layout.dpr;
  return Math.max(1, Math.ceil(stripDev / layout.tileDevWidth));
}

/** Where along the strip (device px) time `t` sits. */
export function stripX(layout: StripLayout, seconds: number): number {
  return (seconds / layout.secPerPx) * layout.dpr;
}

interface Resolved { all: number; lo: number; mid: number; hi: number }
const res: Resolved = { all: 0, lo: 0, mid: 0, hi: 0 };

/** Max over the model columns a screen column covers. Returns false past the end. */
function resolveColumn(model: WaveformModel, t0: number, t1: number, out: Resolved): boolean {
  const n = model.all.length;
  const a = Math.floor(t0 * model.columnsPerSecond);
  if (a >= n) return false;
  const b = Math.min(n - 1, Math.max(a, Math.ceil(t1 * model.columnsPerSecond) - 1));
  let all = 0, lo = 0, mid = 0, hi = 0;
  for (let i = Math.max(0, a); i <= b; i += 1) {
    if (model.all[i] > all) all = model.all[i];
    if (model.low[i] > lo) lo = model.low[i];
    if (model.mid[i] > mid) mid = model.mid[i];
    if (model.high[i] > hi) hi = model.high[i];
  }
  out.all = all; out.lo = lo; out.mid = mid; out.hi = hi;
  return true;
}

const tmpA: Rgb = [0, 0, 0];
const tmpB: Rgb = [0, 0, 0];
const css = (c: Rgb) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/**
 * Render tile `tileIndex` of the colour line layer. The sink is `tileDevWidth ×
 * devHeight` device px (the caller sets the transform to identity). Only the
 * lines are drawn here, on a transparent tile: the dark gaps stay transparent.
 */
export function renderBandWaveform(
  ctx: RectSink, model: WaveformModel, layout: StripLayout, tileIndex: number, theme: BandTheme,
  variant: 'played' | 'unplayed',
): void {
  const vecs = { low: parseHex(theme.bandColors.low), mid: parseHex(theme.bandColors.mid), high: parseHex(theme.bandColors.high) };
  const cy = Math.round(layout.devHeight / 2);
  const boxHalf = layout.devHeight / 2;
  const secPerCol = (layout.devPitch / layout.dpr) * layout.secPerPx;
  ctx.globalAlpha = 1;
  for (let i = 0; i < layout.columnsPerTile; i += 1) {
    const c = tileIndex * layout.columnsPerTile + i;
    const t0 = c * secPerCol;
    if (!resolveColumn(model, t0, t0 + secPerCol, res)) break;
    if (res.all <= 0) continue;
    if (!columnColour(res.lo, res.mid, res.hi, vecs, theme.bandGain, tmpA)) continue;
    const colour = variant === 'played' ? tmpA : dimColour(tmpA, tmpB);
    // Height from `all` ONLY.
    const half = Math.max(1, Math.round((res.all / 255) * HEIGHT_FILL * boxHalf));
    ctx.fillStyle = css(colour);
    ctx.fillRect(i * layout.devPitch, cy - half, layout.lineDev, half * 2);
  }
}

/** Glow tile at GLOW_SCALE: the same columns, slightly taller, full colour; alpha is applied at blit time. */
export function renderBandGlow(
  ctx: RectSink, model: WaveformModel, layout: StripLayout, tileIndex: number, theme: BandTheme,
): void {
  const vecs = { low: parseHex(theme.bandColors.low), mid: parseHex(theme.bandColors.mid), high: parseHex(theme.bandColors.high) };
  const s = GLOW_SCALE;
  const cy = layout.devHeight / 2;
  const secPerCol = (layout.devPitch / layout.dpr) * layout.secPerPx;
  ctx.globalAlpha = 1;
  for (let i = 0; i < layout.columnsPerTile; i += 1) {
    const c = tileIndex * layout.columnsPerTile + i;
    const t0 = c * secPerCol;
    if (!resolveColumn(model, t0, t0 + secPerCol, res)) break;
    if (res.all <= 0) continue;
    if (!columnColour(res.lo, res.mid, res.hi, vecs, theme.bandGain, tmpA)) continue;
    const half = Math.max(1, (res.all / 255) * HEIGHT_FILL * (layout.devHeight / 2)) * 1.06;
    ctx.fillStyle = css(tmpA);
    ctx.fillRect(Math.floor(i * layout.devPitch * s), Math.floor((cy - half) * s), Math.max(1, Math.round(layout.devPitch * s)), Math.ceil(half * 2 * s));
  }
}
