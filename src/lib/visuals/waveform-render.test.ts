import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAND_THEME, GLOW_ALPHA_PLAYED, GLOW_ALPHA_UNPLAYED, GLOW_SCALE, columnColour, dimColour, parseHex,
  renderBandGlow, renderBandWaveform, stripLayout, type Rgb, type RectSink,
} from './waveform-render';
import type { WaveformModel } from './waveform-model';

const V = {
  low: parseHex('#FF2D2D'), mid: parseHex('#33FF66'), high: parseHex('#2E7BFF'),
};
const G: [number, number, number] = [1, 1, 1];

describe('columnColour (max of three)', () => {
  it('pure low is red, pure mid green, pure high blue', () => {
    const out: Rgb = [0, 0, 0];
    expect(columnColour(200, 0, 0, V, G, out)).toBe(true);
    expect(out[0]).toBeCloseTo(1); expect(out[0]).toBeGreaterThan(out[1] * 2); expect(out[0]).toBeGreaterThan(out[2] * 2);
    columnColour(0, 200, 0, V, G, out);
    expect(out[1]).toBeCloseTo(1); expect(out[1]).toBeGreaterThan(out[0]); expect(out[1]).toBeGreaterThan(out[2]);
    columnColour(0, 0, 200, V, G, out);
    expect(out[2]).toBeCloseTo(1); expect(out[2]).toBeGreaterThan(out[0]); expect(out[2]).toBeGreaterThan(out[1]);
  });
  it('equal strong bands add to white; the hue stays saturated (max channel is 1) for any mix', () => {
    const out: Rgb = [0, 0, 0];
    // with neutral (pure R, G, B) colours equal bands are exactly white
    const pure = { low: [1, 0, 0] as Rgb, mid: [0, 1, 0] as Rgb, high: [0, 0, 1] as Rgb };
    columnColour(180, 180, 180, pure, G, out);
    expect(out).toEqual([1, 1, 1]);
    columnColour(90, 255, 30, V, G, out);
    expect(Math.max(...out)).toBeCloseTo(1);
  });
  it('zero energy is skipped', () => {
    expect(columnColour(0, 0, 0, V, G, [0, 0, 0])).toBe(false);
  });
  it('per-band gain shifts the mix', () => {
    const out: Rgb = [0, 0, 0];
    columnColour(100, 100, 0, V, [1, 0, 1], out);
    expect(out[0]).toBeGreaterThan(out[1]); // mid muted -> red wins
  });
  it('dimming keeps the hue, halves the brightness and leans toward grey', () => {
    const d = dimColour([1, 0, 0], [0, 0, 0]);
    expect(d[0]).toBeGreaterThan(d[1]);
    expect(d[0]).toBeLessThan(0.6);
    expect(d[1]).toBeGreaterThan(0.1); // greyed, not black
  });
});

// ── a tiny software raster that implements the RectSink the renderer draws into ──
class Raster implements RectSink {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  globalAlpha = 1;
  data: Float64Array;
  constructor(public w: number, public h: number) { this.data = new Float64Array(w * h * 4); }
  private colour(): Rgb {
    const fs = String(this.fillStyle);
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(fs);
    return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : parseHex(fs);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const c = this.colour();
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(this.h, Math.round(y + h)); yy += 1) {
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(this.w, Math.round(x + w)); xx += 1) {
        const i = (yy * this.w + xx) * 4;
        const sa = this.globalAlpha; const da = this.data[i + 3];
        const oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k += 1) this.data[i + k] = (c[k] * sa + this.data[i + k] * da * (1 - sa)) / (oa || 1);
        this.data[i + 3] = oa;
      }
    }
  }
  px(x: number, y: number): [number, number, number, number] {
    const i = (y * this.w + x) * 4; return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
}

/** Bilinear upscale of the glow raster (what the browser's smoothing does). */
function upscale(src: Raster, w: number, h: number): Raster {
  const out = new Raster(w, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const sx = Math.min(src.w - 1, Math.max(0, (x + 0.5) * (src.w / w) - 0.5));
    const sy = Math.min(src.h - 1, Math.max(0, (y + 0.5) * (src.h / h) - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(src.w - 1, x0 + 1), y1 = Math.min(src.h - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0;
    const o = (y * w + x) * 4;
    for (let k = 0; k < 4; k += 1) {
      const a = src.data[(y0 * src.w + x0) * 4 + k], b = src.data[(y0 * src.w + x1) * 4 + k];
      const c = src.data[(y1 * src.w + x0) * 4 + k], d = src.data[(y1 * src.w + x1) * 4 + k];
      out.data[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Composite exactly as the app does: background, glow BEHIND at its alpha, then the lines. */
function composite(model: WaveformModel, dpr: number, variant: 'played' | 'unplayed') {
  const layout = stripLayout(400, 16, 140, dpr);
  const W = layout.tileDevWidth, H = layout.devHeight;
  const lines = new Raster(W, H);
  renderBandWaveform(lines, model, layout, 0, DEFAULT_BAND_THEME, variant);
  const glowSmall = new Raster(Math.ceil(W * GLOW_SCALE), Math.ceil(H * GLOW_SCALE));
  renderBandGlow(glowSmall, model, layout, 0, DEFAULT_BAND_THEME);
  const glow = upscale(glowSmall, W, H);
  const bg = parseHex(DEFAULT_BAND_THEME.background);
  const ga = variant === 'played' ? GLOW_ALPHA_PLAYED : GLOW_ALPHA_UNPLAYED;
  const out = (x: number, y: number) => {
    const g = glow.px(x, y); const l = lines.px(x, y);
    const a = g[3] * ga;
    const base = [0, 1, 2].map((k) => bg[k] * (1 - a) + g[k] * a);
    return [0, 1, 2].map((k) => base[k] * (1 - l[3]) + l[k] * l[3]);
  };
  return { layout, out };
}

function loudModel(cols: number, band: 'all3' | 'low'): WaveformModel {
  const m: WaveformModel = {
    all: new Uint8Array(cols).fill(255), low: new Uint8Array(cols), mid: new Uint8Array(cols), high: new Uint8Array(cols),
    columnsPerSecond: 441, peak: 1,
  };
  if (band === 'all3') { m.low.fill(255); m.mid.fill(255); m.high.fill(255); } else { m.low.fill(255); }
  return m;
}

describe('rendered columns keep a visible gap (even inside a loud kick)', () => {
  for (const dpr of [1, 2]) {
    for (const variant of ['played', 'unplayed'] as const) {
      for (const band of ['all3', 'low'] as const) {
        it(`dpr ${dpr}, ${variant}, ${band}: gap luminance ≤ 35% of line luminance`, () => {
          const { layout, out } = composite(loudModel(441 * 8, band), dpr, variant);
          const col = 40;                      // a column well inside the loud region
          const x0 = col * layout.devPitch;
          const y = Math.round(layout.devHeight / 2) - 6;
          const line = out(x0 + Math.floor(layout.lineDev / 2), y);
          const gap = out(x0 + layout.lineDev + Math.floor((layout.devPitch - layout.lineDev) / 2), y);
          expect(lum(gap)).toBeLessThanOrEqual(0.35 * lum(line));
          // the line is really there, snapped to whole device pixels
          expect(layout.lineDev).toBe(Math.round(1.5 * dpr));
          expect(layout.devPitch - layout.lineDev).toBe(Math.round(2.5 * dpr) - Math.round(1.5 * dpr));
        });
      }
    }
  }

  it('lines are mirrored about the centre and use up to 78% of the height', () => {
    const layout = stripLayout(400, 16, 140, 2);
    const r = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(r, loudModel(441 * 8, 'low'), layout, 0, DEFAULT_BAND_THEME, 'played');
    const x = 10 * layout.devPitch + 1;
    let top = -1, bottom = -1;
    for (let y = 0; y < r.h; y += 1) if (r.px(x, y)[3] > 0) { if (top < 0) top = y; bottom = y; }
    const cy = Math.round(layout.devHeight / 2);
    expect(cy - top).toBe(bottom - cy + 1);
    expect((bottom - top + 1) / layout.devHeight).toBeGreaterThan(0.76);
    expect((bottom - top + 1) / layout.devHeight).toBeLessThan(0.8);
  });

  it('height comes from `all` only: colour does not change it', () => {
    const layout = stripLayout(400, 16, 140, 1);
    const a = loudModel(441 * 4, 'low'); const b = loudModel(441 * 4, 'all3');
    const ra = new Raster(layout.tileDevWidth, layout.devHeight); const rb = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(ra, a, layout, 0, DEFAULT_BAND_THEME, 'played');
    renderBandWaveform(rb, b, layout, 0, DEFAULT_BAND_THEME, 'played');
    const count = (r: Raster) => { let n = 0; for (let y = 0; y < r.h; y += 1) if (r.px(5 * layout.devPitch, y)[3] > 0) n += 1; return n; };
    expect(count(ra)).toBe(count(rb));
  });

  it('skips columns with no band energy and stops past the end of the track', () => {
    const layout = stripLayout(400, 16, 140, 1);
    const m = loudModel(441, 'low'); m.low.fill(0); // all > 0 but every band is 0
    const r = new Raster(layout.tileDevWidth, layout.devHeight);
    renderBandWaveform(r, m, layout, 0, DEFAULT_BAND_THEME, 'played');
    expect(r.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(false);
  });
});
