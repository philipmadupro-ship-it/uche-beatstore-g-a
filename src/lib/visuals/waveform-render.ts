/**
 * Pure rendering of the Rekordbox-style 3-band waveform onto a rectangle sink
 * (`fillRect` + `fillStyle` + `globalAlpha`), so it runs on a canvas in the app
 * and on a software raster in tests.
 *
 *  - CONTINUOUS: one column per DEVICE pixel, each touching the next, so the
 *    result is a solid filled shape (no comb of bars, no gaps). Each device
 *    column is the bucket-PEAK of the 441-col/s model over the time it covers.
 *  - LAYERED bands, each with its OWN height, mirrored on the centre line and
 *    drawn back to front: low (back, usually widest), then mid, then high
 *    (front, usually thinnest). All three share the same global normaliser as
 *    `all`, so relative heights are true; a gentle `x^curve` is applied equally.
 *  - Colours come from the theme palette; the played side is darkened and
 *    desaturated, the unplayed side is full colour.
 */

import type { WaveformModel } from './waveform-model';

export interface BandPalette { low: string; mid: string; high: string }

export type PaletteName = 'rekordbox3band' | 'rgb';

export const PALETTES: Record<PaletteName, BandPalette> = {
  /** Rekordbox 3-band: deep blue bass wings, amber mids, white highs on top. */
  rekordbox3band: { low: '#1E5BFF', mid: '#FF9A1F', high: '#FFFFFF' },
  /** Serato-like: red lows, green mids, blue highs. */
  rgb: { low: '#FF2D2D', mid: '#33FF66', high: '#2E7BFF' },
};

export interface BandTheme {
  background: string;
  palette: BandPalette;
  /** Perceptual curve applied equally to all bands. */
  curve: number;
  /** Alpha of each band layer. */
  layerAlpha: number;
  /** Played side: brightness multiplier and desaturation (0..1). */
  playedBrightness: number;
  playedDesaturate: number;
  /** Soft one-layer bloom on the HIGH layer (alpha, 0 turns it off). */
  bloomAlpha: number;
  axis: string;
  playhead: string;
}

export function bandTheme(name: PaletteName = 'rekordbox3band', over: Partial<BandTheme> = {}): BandTheme {
  return {
    background: '#0b0b0d',
    palette: PALETTES[name],
    curve: 0.7,
    layerAlpha: 0.95,
    playedBrightness: 0.45,
    playedDesaturate: 0.3,
    bloomAlpha: 0.12,
    axis: 'rgba(255,255,255,0.08)',
    playhead: '#ffffff',
    ...over,
  };
}

export const DEFAULT_BAND_THEME: BandTheme = bandTheme('rekordbox3band');

/** Full height = this fraction of half the box. */
export const HEIGHT_FILL = 0.92;
/** The bloom lives in an offscreen this fraction of the size, then is scaled up (≤ ~2 css px blur). */
export const GLOW_SCALE = 0.5;
/** Tiles are about this wide, CSS px. */
export const TILE_CSS = 2048;
/** Playhead width, CSS px. */
export const PLAYHEAD_CSS = 2;

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

const css = (c: Rgb) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** The played side: desaturated, then darkened. */
export function playedColour(c: Rgb, desaturate: number, brightness: number): Rgb {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [
    (c[0] + (l - c[0]) * desaturate) * brightness,
    (c[1] + (l - c[1]) * desaturate) * brightness,
    (c[2] + (l - c[2]) * desaturate) * brightness,
  ];
}

/** CSS colour of a band in a variant. */
export function bandCss(theme: BandTheme, band: 'low' | 'mid' | 'high', variant: 'played' | 'unplayed'): string {
  const c = parseHex(theme.palette[band]);
  return css(variant === 'played' ? playedColour(c, theme.playedDesaturate, theme.playedBrightness) : c);
}

export interface StripLayout {
  dpr: number;
  cssHeight: number;
  /** Seconds per CSS px along the strip. */
  secPerPx: number;
  /** Tile width in device px. */
  tileDevWidth: number;
  devHeight: number;
}

export function stripLayout(cssWidth: number, visibleSeconds: number, cssHeight: number, dpr: number): StripLayout {
  return {
    dpr, cssHeight,
    secPerPx: visibleSeconds / Math.max(1, cssWidth),
    tileDevWidth: Math.max(1, Math.round(TILE_CSS * dpr)),
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

/**
 * Half-heights (device px) of the three bands for every device column of a tile:
 * out[0..w) low, [w..2w) mid, [2w..3w) high. Columns past the end of the track
 * stay 0. Returns the number of columns that hold audio.
 */
export function tileHeights(
  model: WaveformModel, layout: StripLayout, tileIndex: number, curve: number, out: Int16Array,
): number {
  const w = layout.tileDevWidth;
  const boxHalf = layout.devHeight / 2;
  const secPerDev = layout.secPerPx / layout.dpr;
  const cps = model.columnsPerSecond;
  const n = model.all.length;
  out.fill(0, 0, w * 3);
  let filled = 0;
  for (let x = 0; x < w; x += 1) {
    const t0 = (tileIndex * w + x) * secPerDev;
    const a = Math.floor(t0 * cps);
    if (a >= n) break;
    const b = Math.min(n - 1, Math.max(a, Math.ceil((t0 + secPerDev) * cps) - 1));
    let lo = 0, mid = 0, hi = 0;
    for (let i = Math.max(0, a); i <= b; i += 1) {
      if (model.low[i] > lo) lo = model.low[i];
      if (model.mid[i] > mid) mid = model.mid[i];
      if (model.high[i] > hi) hi = model.high[i];
    }
    const h = (v: number) => (v > 0 ? Math.max(1, Math.round(Math.pow(v / 255, curve) * HEIGHT_FILL * boxHalf)) : 0);
    out[x] = h(lo); out[w + x] = h(mid); out[2 * w + x] = h(hi);
    filled += 1;
  }
  return filled;
}

const heightsScratch = new Map<number, Int16Array>();
function scratchFor(w: number): Int16Array {
  let a = heightsScratch.get(w);
  if (!a) { a = new Int16Array(w * 3); heightsScratch.set(w, a); }
  return a;
}

/**
 * Render tile `tileIndex`: three filled, mirrored layers back to front (low,
 * mid, high), one column per device pixel, on a transparent tile of
 * `tileDevWidth × devHeight` device px (the caller's transform is identity).
 */
export function renderBandWaveform(
  ctx: RectSink, model: WaveformModel, layout: StripLayout, tileIndex: number, theme: BandTheme,
  variant: 'played' | 'unplayed',
): void {
  const w = layout.tileDevWidth;
  const heights = scratchFor(w);
  tileHeights(model, layout, tileIndex, theme.curve, heights);
  const cy = Math.round(layout.devHeight / 2);
  const order: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high']; // back to front
  ctx.globalAlpha = theme.layerAlpha;
  for (let l = 0; l < 3; l += 1) {
    ctx.fillStyle = bandCss(theme, order[l], variant);
    const base = l * w;
    let x = 0;
    while (x < w) {
      // Merge runs of columns with the same height into one rect: contiguous, fewer calls.
      const h = heights[base + x];
      if (h === 0) { x += 1; continue; }
      let run = 1;
      while (x + run < w && heights[base + x + run] === h) run += 1;
      ctx.fillRect(x, cy - h, run, h * 2);
      x += run;
    }
  }
}

/** Bloom tile at GLOW_SCALE: the HIGH layer only, full colour; alpha is applied at blit time. */
export function renderBandBloom(
  ctx: RectSink, model: WaveformModel, layout: StripLayout, tileIndex: number, theme: BandTheme,
): void {
  const w = layout.tileDevWidth;
  const heights = scratchFor(w);
  tileHeights(model, layout, tileIndex, theme.curve, heights);
  const s = GLOW_SCALE;
  const cy = layout.devHeight / 2;
  ctx.globalAlpha = 1;
  ctx.fillStyle = bandCss(theme, 'high', 'unplayed');
  for (let x = 0; x < w; x += 1) {
    const h = heights[2 * w + x];
    if (h === 0) continue;
    ctx.fillRect(Math.floor(x * s), Math.floor((cy - h) * s), 1, Math.ceil(h * 2 * s));
  }
}
