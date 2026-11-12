import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAND_THEME, HEIGHT_FILL, PALETTES, bandCss, bandTheme, parseHex, playedColour, renderBandWaveform,
  stripLayout, tileHeights, type RectSink,
} from './waveform-render';
import type { WaveformModel } from './waveform-model';

/** Records every fill, so layer order and shape can be asserted. */
class Raster implements RectSink {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  globalAlpha = 1;
  fills: Array<{ style: string; alpha: number; x: number; y: number; w: number; h: number }> = [];
  px: Uint8Array;
  constructor(public w: number, public h: number) { this.px = new Uint8Array(w * h); }
  fillRect(x: number, y: number, w: number, h: number) {
    this.fills.push({ style: String(this.fillStyle), alpha: this.globalAlpha, x, y, w, h });
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx += 1) this.px[yy * this.w + xx] = 1;
    }
  }
  /** Is any pixel of device column x painted? */
  column(x: number): boolean { for (let y = 0; y < this.h; y += 1) if (this.px[y * this.w + x]) return true; return false; }
  /** Painted extent (top, bottom) of column x for fills of one style. */
  extent(x: number, style: string): { top: number; bottom: number } | null {
    let top = Infinity, bottom = -1;
    for (const f of this.fills) if (f.style === style && x >= f.x && x < f.x + f.w) { top = Math.min(top, f.y); bottom = Math.max(bottom, f.y + f.h - 1); }
    return bottom < 0 ? null : { top, bottom };
  }
}

const model = (cols: number, lo: number, mid: number, hi: number): WaveformModel => ({
  all: new Uint8Array(cols).fill(Math.max(lo, mid, hi)),
  low: new Uint8Array(cols).fill(lo), mid: new Uint8Array(cols).fill(mid), high: new Uint8Array(cols).fill(hi),
  columnsPerSecond: 441, peak: 1,
});

describe('palettes', () => {
  it('the played brown stays readable against the ground (low layer uses 60%)', () => {
    const lum = (css: string) => { const m = css.match(/\d+/g)!.map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    expect(DEFAULT_BAND_THEME.playedBrightnessLow).toBeLessThanOrEqual(0.6);
    expect(lum(bandCss(DEFAULT_BAND_THEME, 'low', 'played'))).toBeGreaterThan(lum('rgb(13,13,10)') + 40);
  });
  it('rekordbox3band is the default: brown lows, beige mids, white highs', () => {
    expect(DEFAULT_BAND_THEME.palette).toEqual({ low: '#8A5A35', mid: '#D8C3A0', high: '#FFFFFF' });
    expect(PALETTES.rekordbox3band.low).toBe('#8A5A35');
  });
  it('the rgb palette is the Serato-like one', () => {
    expect(PALETTES.rgb).toEqual({ low: '#FF2D2D', mid: '#33FF66', high: '#2E7BFF' });
    expect(bandTheme('rgb').palette).toEqual(PALETTES.rgb);
  });
  it('the played side is darkened to 45% and desaturated by 30%', () => {
    const c = parseHex('#D8C3A0');
    const p = playedColour(c, 0.3, 0.45);
    for (let k = 0; k < 3; k += 1) expect(p[k]).toBeLessThanOrEqual(c[k] * 0.45 + 0.2);
    const sat = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(sat(p) / Math.max(...p)).toBeLessThan(sat(c) / Math.max(...c)); // less saturated
    expect(Math.max(...p)).toBeCloseTo(0.45 * (c[0] + (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] - c[0]) * 0.3), 5);
    // and the unplayed variant is the FULL colour
    expect(bandCss(DEFAULT_BAND_THEME, 'mid', 'unplayed')).toBe('rgb(216,195,160)');
    expect(bandCss(DEFAULT_BAND_THEME, 'mid', 'played')).not.toBe('rgb(216,195,160)');
  });
});

describe('continuous columns', () => {
  for (const dpr of [1, 2]) {
    it(`dpr ${dpr}: no empty device column inside a loud region (a solid shape, no gaps)`, () => {
      const layout = stripLayout(400, 16, 140, dpr);
      const r = new Raster(layout.tileDevWidth, layout.devHeight);
      renderBandWaveform(r, model(441 * 12, 255, 200, 120), layout, 0, DEFAULT_BAND_THEME, 'unplayed');
      const loud = Math.floor((12 / layout.secPerPx) * dpr) - 2;
      for (let x = 0; x < loud; x += 1) expect(r.column(x)).toBe(true);
    });
  }

  it('a varying signal is still contiguous and one column wide at most per height step', () => {
    const layout = stripLayout(400, 16, 140, 1);
    const m = model(441 * 8, 255, 0, 0);
    for (let i = 0; i < m.low.length; i += 1) m.low[i] = 40 + ((i * 37) % 200);
    const r = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(r, m, layout, 0, DEFAULT_BAND_THEME, 'unplayed');
    for (let x = 0; x < Math.floor(8 / layout.secPerPx) - 2; x += 1) expect(r.column(x)).toBe(true);
  });
});

describe('layered bands', () => {
  const layout = stripLayout(400, 16, 160, 2);
  const lo = bandCss(DEFAULT_BAND_THEME, 'low', 'unplayed');
  const mi = bandCss(DEFAULT_BAND_THEME, 'mid', 'unplayed');
  const hi = bandCss(DEFAULT_BAND_THEME, 'high', 'unplayed');

  it('draws low first (back), then mid, then high (front), each at alpha 0.95', () => {
    const r = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(r, model(441 * 6, 255, 160, 80), layout, 0, DEFAULT_BAND_THEME, 'unplayed');
    const firstIndex = (style: string) => r.fills.findIndex((f) => f.style === style);
    const lastIndex = (style: string) => r.fills.length - 1 - [...r.fills].reverse().findIndex((f) => f.style === style);
    expect(firstIndex(lo)).toBe(0);
    expect(lastIndex(lo)).toBeLessThan(firstIndex(mi));
    expect(lastIndex(mi)).toBeLessThan(firstIndex(hi));
    expect(r.fills.every((f) => f.alpha === 0.95)).toBe(true);
  });

  it("each layer's height follows its own band, mirrored on the centre line, with the same curve", () => {
    const r = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(r, model(441 * 6, 255, 128, 51), layout, 0, DEFAULT_BAND_THEME, 'unplayed');
    const x = 100;
    const half = (style: string) => { const e = r.extent(x, style)!; return (e.bottom - e.top + 1) / 2; };
    const boxHalf = layout.devHeight / 2;
    expect(half(lo)).toBeCloseTo(HEIGHT_FILL * boxHalf, 0);
    expect(half(mi)).toBeCloseTo(Math.pow(128 / 255, 0.7) * HEIGHT_FILL * boxHalf, 0);
    expect(half(hi)).toBeCloseTo(Math.pow(51 / 255, 0.7) * HEIGHT_FILL * boxHalf, 0);
    expect(half(lo)).toBeGreaterThan(half(mi));
    expect(half(mi)).toBeGreaterThan(half(hi)); // a shorter front layer lets the back layer show around it
    const e = r.extent(x, lo)!;
    const cy = Math.round(layout.devHeight / 2);
    expect(cy - e.top).toBe(e.bottom - cy + 1); // mirrored
  });

  it('a band at zero draws nothing for that layer, and the others are unaffected', () => {
    const r = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(r, model(441 * 6, 200, 0, 0), layout, 0, DEFAULT_BAND_THEME, 'unplayed');
    expect(r.extent(50, mi)).toBeNull();
    expect(r.extent(50, hi)).toBeNull();
    expect(r.extent(50, lo)).not.toBeNull();
  });

  it('the played variant uses the darkened palette; the unplayed variant the full one', () => {
    const a = new Raster(layout.tileDevWidth, layout.devHeight);
    const b = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(a, model(441 * 4, 255, 255, 255), layout, 0, DEFAULT_BAND_THEME, 'played');
    renderBandWaveform(b, model(441 * 4, 255, 255, 255), layout, 0, DEFAULT_BAND_THEME, 'unplayed');
    expect(a.fills[0].style).not.toBe(b.fills[0].style);
    expect(b.fills[0].style).toBe(lo);
  });

  it('applies the curve equally, stops at the end of the track and uses the global scale', () => {
    const buf = new Int16Array(layout.tileDevWidth * 3);
    const filled = tileHeights(model(441 * 2, 255, 255, 255), layout, 0, 0.7, buf);
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(layout.tileDevWidth);
    expect(buf[0]).toBe(buf[layout.tileDevWidth]); // same input, same curve, every band
    expect(buf[filled + 5]).toBe(0);
  });
});
