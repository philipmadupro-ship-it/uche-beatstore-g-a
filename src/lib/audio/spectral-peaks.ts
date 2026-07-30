/**
 * Spectral waveform colouring — the pure half.
 *
 * DAWs (FL Studio, Ableton, Rekordbox) colour a waveform by which part of the
 * spectrum dominates each slice of time, so you can *see* where the 808 sits
 * versus the hats. This module turns per-slice low/mid/high band energy into
 * drawable bars.
 *
 * Deliberately pure and dependency-free: the decode + filtering half lives in
 * `useSpectralPeaks`, because anything that touches AudioContext can't be
 * unit-tested. Per CLAUDE.md, scoring logic that lives inside a component
 * can't be tested in isolation and gets silently reverted — so the mapping
 * lives here with a Vitest suite around it.
 *
 * Replaces the previous `buildDawWaveformBars`, which assigned a "band" via
 * `index % 5` — a positional cycle with no relationship to the audio. It
 * looked spectral without being spectral.
 */

/** Per-slice energy for each band. All three arrays share one length. */
export interface SpectralBands {
  low: number[];
  mid: number[];
  high: number[];
}

export interface SpectralBar {
  /** Drawable height, 0..1. */
  height: number;
  /** `rgb(...)` string for the bar. */
  color: string;
  /** Which band dominates this slice — drives the legend + a11y summary. */
  dominant: 'low' | 'mid' | 'high';
}

/** Floor so silence still shows a hairline rather than a gap. */
export const SPECTRAL_MIN_HEIGHT = 0.06;

/**
 * How hard the dominant band pulls the colour. 1 = plain average (mud);
 * higher = more separation. 2.6 was picked against real trap/drill previews:
 * enough that an 808 reads clearly amber and hats read pale, without going so
 * far that every bar snaps to a pure primary and the mix detail is lost.
 */
const CONTRAST_EXPONENT = 2.6;

/**
 * Additive spectral mapping — low=red, mid=green, high=blue, the convention a
 * DAW spectral view uses.
 *
 * Saturation is deliberate. An earlier revision desaturated these toward the
 * warm UI palette (lows to amber, highs to near-white) and the result read as
 * flat grey-green: the colour stopped carrying information, which is the whole
 * point of colouring a waveform by frequency. This is the one place in the app
 * where colour is data rather than decoration, so it is exempt from the
 * one-accent rule in docs/design-direction.md — and it needs to be legible as
 * colour to earn that exemption.
 *
 * Lows lean crimson rather than pure red and highs lean toward a cool blue, so
 * a bass-heavy beat reads magenta/red and an airy one reads blue — matching the
 * reference player the owner supplied.
 */
const BAND_RGB = {
  low: [236, 62, 104] as const,
  mid: [104, 214, 126] as const,
  high: [88, 156, 252] as const,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Normalise a band against its own peak.
 *
 * Per-band rather than global: highs carry far less energy than lows in almost
 * every mix, so a global normalise would render hats nearly black and the
 * colour would collapse to "everything is red". Normalising each band against
 * itself is what makes the hats actually visible — the same reason DAW spectral
 * views weight bands independently.
 */
function normaliseBand(values: number[]): number[] {
  let peak = 0;
  for (const v of values) {
    const abs = Number.isFinite(v) ? Math.abs(v) : 0;
    if (abs > peak) peak = abs;
  }
  if (peak <= 0) return values.map(() => 0);
  return values.map((v) => clamp01(Math.abs(Number.isFinite(v) ? v : 0) / peak));
}

/**
 * Build coloured bars from per-slice band energy.
 *
 * Height comes from combined loudness; colour comes from the *mix* of bands,
 * so a slice that's all sub-bass reads amber and a slice of hats reads pale.
 */
export function buildSpectralBars(bands: SpectralBands): SpectralBar[] {
  const len = Math.min(bands.low.length, bands.mid.length, bands.high.length);
  if (len === 0) return [];

  const low = normaliseBand(bands.low.slice(0, len));
  const mid = normaliseBand(bands.mid.slice(0, len));
  const high = normaliseBand(bands.high.slice(0, len));

  // Height uses the raw (un-normalised) sum so quiet passages stay quiet —
  // per-band normalisation is for colour only. Without this the intro of a
  // track would render as tall as the drop.
  const rawTotals = Array.from({ length: len }, (_, i) =>
    Math.abs(bands.low[i] ?? 0) + Math.abs(bands.mid[i] ?? 0) + Math.abs(bands.high[i] ?? 0),
  );
  let peakTotal = 0;
  for (const t of rawTotals) if (t > peakTotal) peakTotal = t;

  return Array.from({ length: len }, (_, i) => {
    const l = low[i];
    const m = mid[i];
    const h = high[i];
    const sum = l + m + h;

    // Weighted blend of the three band colours by their relative share, with
    // the weights pushed through a power curve first.
    //
    // Without the curve the result is mud: per-band normalisation leaves most
    // slices with all three bands at a similar relative level, so a plain
    // weighted average lands on the midpoint of the three colours (a flat
    // grey-green) for nearly every bar. Squaring the weights makes the
    // dominant band pull much harder, which is what gives a DAW's spectral
    // view its readable colour separation.
    let r: number, g: number, b: number;
    if (sum <= 0) {
      [r, g, b] = BAND_RGB.high;
    } else {
      const cl = (l / sum) ** CONTRAST_EXPONENT;
      const cm = (m / sum) ** CONTRAST_EXPONENT;
      const ch = (h / sum) ** CONTRAST_EXPONENT;
      const cSum = cl + cm + ch;
      const wl = cSum > 0 ? cl / cSum : 1 / 3;
      const wm = cSum > 0 ? cm / cSum : 1 / 3;
      const wh = cSum > 0 ? ch / cSum : 1 / 3;
      r = Math.round(BAND_RGB.low[0] * wl + BAND_RGB.mid[0] * wm + BAND_RGB.high[0] * wh);
      g = Math.round(BAND_RGB.low[1] * wl + BAND_RGB.mid[1] * wm + BAND_RGB.high[1] * wh);
      b = Math.round(BAND_RGB.low[2] * wl + BAND_RGB.mid[2] * wm + BAND_RGB.high[2] * wh);
    }

    const height = peakTotal > 0
      ? Math.max(SPECTRAL_MIN_HEIGHT, clamp01(rawTotals[i] / peakTotal))
      : SPECTRAL_MIN_HEIGHT;

    const dominant: SpectralBar['dominant'] = l >= m && l >= h ? 'low' : m >= h ? 'mid' : 'high';

    return { height, color: `rgb(${r}, ${g}, ${b})`, dominant };
  });
}

/**
 * Fallback for tracks with no decodable audio: colour plain amplitude peaks a
 * uniform neutral. Honest about having no spectral information rather than
 * inventing bands, which is exactly what the old implementation did.
 */
export function buildAmplitudeBars(peaks: number[]): SpectralBar[] {
  let peak = 0;
  for (const p of peaks) {
    const abs = Math.abs(Number.isFinite(p) ? p : 0);
    if (abs > peak) peak = abs;
  }
  return peaks.map((p) => ({
    height: peak > 0
      ? Math.max(SPECTRAL_MIN_HEIGHT, clamp01(Math.abs(Number.isFinite(p) ? p : 0) / peak))
      : SPECTRAL_MIN_HEIGHT,
    color: 'rgb(190, 198, 210)',
    dominant: 'mid' as const,
  }));
}

/**
 * Downsample an arbitrary-length series to exactly `target` buckets using mean
 * energy per bucket. Peaks files ship at whatever resolution they were built
 * at; the waveform lane needs a fixed bar count.
 */
export function resampleSeries(values: number[], target: number): number[] {
  if (target <= 0) return [];
  if (values.length === 0) return new Array(target).fill(0);
  if (values.length === target) return values.slice();

  const out: number[] = new Array(target);
  const ratio = values.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < values.length; j++) {
      sum += Math.abs(Number.isFinite(values[j]) ? values[j] : 0);
      n++;
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}
