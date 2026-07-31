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
 * Channel gamma. Below 1 it lifts quieter band content so the colour stays
 * readable instead of collapsing to black on anything but the loudest hits —
 * the same reason DAW and DJ waveform displays are perceptually scaled rather
 * than linear.
 */
const COLOUR_GAMMA = 0.55;

/** Darkest a visible column is allowed to get, so colour never vanishes. */
const MIN_CHANNEL = 46;

/**
 * Band primaries — near-pure RGB, as Serato actually renders.
 *
 *   BAND_LOW  red    — kick, 808, sub
 *   BAND_MID  green  — vocals, snare, melody
 *   BAND_HIGH blue   — hats, cymbals, air
 *
 * An earlier revision tinted these toward the app's warm palette (ember /
 * sage / pale blue) so a full-spectrum sum landed on warm bone. That was the
 * wrong call: it made bass-heavy material read amber, which is not what Serato
 * or the reference players look like, and the owner rejected it. The waveform
 * is an instrument readout, not decoration — it gets to keep its own vivid
 * language, and `docs/design-direction.md` already exempts it from the
 * one-accent rule for exactly this reason.
 *
 * Slight desaturation off the absolute primaries only, so the three mix into
 * clean secondaries (bass+mid = orange, mid+high = cyan) instead of clipping.
 */
const BAND_LOW = [255, 42, 58] as const;
const BAND_MID = [46, 230, 104] as const;
const BAND_HIGH = [58, 138, 255] as const;

/** Divisor so a full-spectrum sum reaches white without clipping to mush. */
const SUM_SCALE = 1.55;

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

    // ADDITIVE, Serato-style: R = lows (kick/808), G = mids (vocals/snare),
    // B = highs (hats/air). The colour tells you what is IN the sound, not
    // merely which band happens to lead. This replaced a weighted blend of
    // fixed hues by relative share, which could only ever express dominance —
    // and since per-band normalisation leaves most slices with all three bands
    // at a similar relative level, nearly every column landed on the palette's
    // midpoint as a flat grey-green. The amplitudes *are* the colour.
    //
    // The primaries are TINTED rather than pure R/G/B, and summed additively.
    // Pure channels are the textbook Serato mapping but read as a neon test
    // pattern against this app's warm near-black surfaces. Tinting keeps the
    // semantics — bass still reads red, vocals green, hats blue — while the
    // full-spectrum sum lands on the palette's warm bone rather than clinical
    // white, so the waveform belongs to the same product as everything around
    // it. Summing (not blending by share) is what preserves the additive
    // behaviour: more content in a band means more of that channel.
    const gamma = COLOUR_GAMMA;
    const wl = Math.pow(clamp01(l), gamma);
    const wm = Math.pow(clamp01(m), gamma);
    const wh = Math.pow(clamp01(h), gamma);

    let r = Math.round((BAND_LOW[0] * wl + BAND_MID[0] * wm + BAND_HIGH[0] * wh) / SUM_SCALE);
    let g = Math.round((BAND_LOW[1] * wl + BAND_MID[1] * wm + BAND_HIGH[1] * wh) / SUM_SCALE);
    let b = Math.round((BAND_LOW[2] * wl + BAND_MID[2] * wm + BAND_HIGH[2] * wh) / SUM_SCALE);
    r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b);

    // Floor the total brightness so quiet-but-present audio stays visible
    // rather than fading to near-black and losing its colour entirely.
    const brightest = Math.max(r, g, b);
    if (brightest > 0 && brightest < MIN_CHANNEL) {
      const lift = MIN_CHANNEL / brightest;
      r = Math.min(255, Math.round(r * lift));
      g = Math.min(255, Math.round(g * lift));
      b = Math.min(255, Math.round(b * lift));
    } else if (brightest === 0) {
      r = g = b = MIN_CHANNEL;
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
