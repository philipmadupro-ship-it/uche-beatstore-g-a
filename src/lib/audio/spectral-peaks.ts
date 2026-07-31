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

/** Darkest a visible column is allowed to get, so colour never vanishes. */
const MIN_CHANNEL = 46;

/**
 * Serato-like frequency → colour gradient.
 *
 * Ported from `turbo/libdjwaveform` (main.c), which renders Serato/NeuralMix-
 * style waveforms. Control points are `[Hz, r, g, b]`, linearly interpolated.
 * The shape is what produces the familiar DJ-waveform look: deep red sub-bass
 * rising to bright red ~250Hz, through brown/olive in the low mids, bright
 * green around 700Hz–1.4kHz (where vocals sit), darkening through teal ~2.7kHz,
 * into blue from ~2.9kHz and brightening again in the air band.
 */
const FREQ_GRADIENT: ReadonlyArray<readonly [number, number, number, number]> = [
  [10, 0x83, 0x1e, 0x1e], [50, 0x94, 0x1e, 0x1e], [100, 0xa1, 0x1e, 0x1e],
  [150, 0xbf, 0x1e, 0x1e], [250, 0xbf, 0x1e, 0x1e], [300, 0xbd, 0x2c, 0x1e],
  [350, 0x8a, 0x48, 0x1f], [400, 0x91, 0x59, 0x1e], [450, 0x73, 0x60, 0x1e],
  [500, 0x49, 0x63, 0x1e], [550, 0x42, 0x71, 0x1f], [600, 0x30, 0x61, 0x1e],
  [650, 0x33, 0xa6, 0x1d], [700, 0x27, 0xbf, 0x1e], [800, 0x27, 0xbf, 0x1e],
  [850, 0x1d, 0x9d, 0x1f], [900, 0x1d, 0x9d, 0x1f], [950, 0x1e, 0x8d, 0x1f],
  [1300, 0x1e, 0x8d, 0x1f], [1350, 0x1d, 0xbf, 0x25], [1450, 0x1d, 0xbf, 0x25],
  [1500, 0x1e, 0xa8, 0x2d], [1550, 0x1e, 0x5e, 0x2d], [1600, 0x1e, 0x73, 0x2d],
  [1650, 0x1e, 0x5e, 0x2d], [2600, 0x1e, 0x5e, 0x2d], [2650, 0x1e, 0x5e, 0x3b],
  [2700, 0x1e, 0x5e, 0x4f], [2750, 0x1e, 0x5c, 0x6d], [2800, 0x1d, 0x54, 0x79],
  [2850, 0x1e, 0x42, 0x79], [2900, 0x1e, 0x22, 0x6a], [2950, 0x1e, 0x1e, 0x61],
  [3000, 0x1e, 0x1e, 0x5c], [5400, 0x1e, 0x1e, 0x5c], [5450, 0x1e, 0x1e, 0x71],
  [5500, 0x1e, 0x1e, 0x85], [5550, 0x1e, 0x1e, 0xb5], [5600, 0x1e, 0x1e, 0xbf],
  [5650, 0x1e, 0x1e, 0xbf], [5700, 0x1e, 0x1e, 0xad], [5750, 0x1e, 0x1e, 0x94],
  [5850, 0x1e, 0x1e, 0x94], [5900, 0x1e, 0x1e, 0x87], [10700, 0x1e, 0x1e, 0x87],
  [10750, 0x28, 0x28, 0xd6], [10800, 0x28, 0x28, 0xb9], [10850, 0x28, 0x28, 0xf0],
];

/** Linear interpolation into FREQ_GRADIENT. Clamps outside the defined range. */
export function colorForFrequency(hz: number): [number, number, number] {
  if (!Number.isFinite(hz)) return [30, 30, 30];
  const first = FREQ_GRADIENT[0];
  const last = FREQ_GRADIENT[FREQ_GRADIENT.length - 1];
  if (hz <= first[0]) return [first[1], first[2], first[3]];
  if (hz >= last[0]) return [last[1], last[2], last[3]];

  for (let i = 1; i < FREQ_GRADIENT.length; i++) {
    const [f1, r1, g1, b1] = FREQ_GRADIENT[i];
    if (hz > f1) continue;
    const [f0, r0, g0, b0] = FREQ_GRADIENT[i - 1];
    const span = f1 - f0;
    const t = span > 0 ? (hz - f0) / span : 0;
    return [
      Math.round(r0 + (r1 - r0) * t),
      Math.round(g0 + (g1 - g0) * t),
      Math.round(b0 + (b1 - b0) * t),
    ];
  }
  return [last[1], last[2], last[3]];
}

/**
 * Representative frequency for each band, used to sample the gradient.
 *
 * libdjwaveform power-weights a gradient lookup across every FFT bin. We hold
 * three bands rather than a full spectrum, so we sample the gradient at each
 * band's centre and power-weight those three — the same computation at coarser
 * resolution. Chosen inside each band's passband, not at its crossover.
 */
const BAND_CENTRE_HZ = { low: 110, mid: 700, high: 5200 } as const;

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
 * Height comes from combined loudness; colour is additive RGB per band, so a
 * full-spectrum hit reads white, an 808 reads red and hats read blue.
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

    // POWER-WEIGHTED GRADIENT AVERAGE — libdjwaveform's algorithm:
    //
    //   for each bin:  acc += power * gradient(freqHz)
    //   colour = acc / totalPower
    //
    // We hold three bands instead of a full FFT, so we sample the gradient at
    // each band's centre frequency and weight by that band's power. Same
    // computation, coarser resolution.
    //
    // This replaced additive RGB (channel intensity = band amplitude), which
    // could only ever produce mixtures of three fixed hues. A gradient gives
    // *continuous* colour: sub-bass and upper-bass are different reds, and a
    // slice sliding from bass to mids sweeps smoothly through the ramp instead
    // of stepping between primaries. That continuity is what the reference
    // players have and this did not.
    //
    // Power, not amplitude: energy is amplitude squared, so weighting by power
    // is what makes a loud band actually dominate the blend.
    const pLow = l * l;
    const pMid = m * m;
    const pHigh = h * h;
    const totalP = pLow + pMid + pHigh;

    let r: number, g: number, b: number;
    if (totalP <= 1e-9) {
      [r, g, b] = [MIN_CHANNEL, MIN_CHANNEL, MIN_CHANNEL];
    } else {
      const cl = colorForFrequency(BAND_CENTRE_HZ.low);
      const cm = colorForFrequency(BAND_CENTRE_HZ.mid);
      const ch = colorForFrequency(BAND_CENTRE_HZ.high);
      const inv = 1 / totalP;
      r = Math.round((cl[0] * pLow + cm[0] * pMid + ch[0] * pHigh) * inv);
      g = Math.round((cl[1] * pLow + cm[1] * pMid + ch[1] * pHigh) * inv);
      b = Math.round((cl[2] * pLow + cm[2] * pMid + ch[2] * pHigh) * inv);

      // The gradient is authored for a bright display; lift it so it reads on
      // a near-black panel without losing the hue relationships.
      const boost = 1 / Math.max(0.35, Math.pow(clamp01(l + m + h), 0.5));
      r = Math.min(255, Math.round(r * boost));
      g = Math.min(255, Math.round(g * boost));
      b = Math.min(255, Math.round(b * boost));
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
