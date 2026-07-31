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
 * Single-hue colour ramp — "shades of one colour", not a rainbow.
 *
 * A prior revision coloured bands by frequency (low=red, mid=green,
 * high=blue via a ported Serato/libdjwaveform gradient). On review that read
 * as multi-hue and disharmonious against the rest of the UI — up to 88
 * distinct hues across one waveform, measured live. This keeps the same
 * *information* (you can still see where the 808 sits versus the hats) but
 * encodes it as LIGHTNESS within one fixed hue rather than as a hue change:
 * bass-heavy moments sit as a deep, saturated version of the colour; airy
 * moments sit pale and desaturated; loudness overall lifts brightness.
 *
 * The hue (33°) is not arbitrary — it matches `#c8a47a`, the warm gold
 * already used everywhere else in the app for the musical-key badge
 * (`docs/design-direction.md` principle 3's semantic exception list). Reusing
 * it means the waveform's "exemption from the one-accent rule" (it still
 * needs its own vivid instrument-readout language) doesn't fight the rest of
 * the palette — it's drawn from a colour the product already uses.
 */
export const WAVEFORM_HUE = 33;
const BASE_SAT = 0.5;

/** HSL (0..1 each) to an `[r,g,b]` triple, 0..255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Normalise a band against its own peak.
 *
 * Per-band rather than global: highs carry far less energy than lows in almost
 * every mix, so a global normalise would render hats nearly black and the
 * colour would collapse to "everything is dark". Normalising each band against
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
 * Height comes from combined loudness. Colour is one hue throughout; only
 * lightness (and, slightly, saturation) vary with band content and level, so
 * a slice that's all sub-bass reads as a deep saturated shade and a slice of
 * hats reads pale — variation within one colour, not between colours.
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
    const energy = clamp01((l + m + h) / 3);

    // Signed tilt: which end of the spectrum this slice leans toward, -1 (all
    // bass) to +1 (all air). Drives LIGHTNESS, never hue — that's the point.
    const tilt = (l + m + h) > 0 ? (h - l) / (l + m + h) : 0;

    // Deep and saturated for bass, pale and soft for air; energy lifts
    // brightness overall so louder moments read brighter within that range.
    const lightness = clamp01(0.22 + energy * 0.32 + tilt * 0.22);
    const saturation = clamp01(BASE_SAT + energy * 0.22 - Math.abs(tilt) * 0.08);

    const [r, g, b] = hslToRgb(WAVEFORM_HUE / 360, saturation, lightness);

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

/* ── Playhead level sampling ──────────────────────────────────────────────
 *
 * Everything reactive (ASCII cover art brightness, waveform bloom) is driven
 * by "how loud is the track right now, 0..1". That mapping used to be written
 * inline in three separate components as `(db[i] + 45) / 45` — a FIXED −45..0
 * dBFS window.
 *
 * That window is far wider than real material occupies. A mastered track sits
 * around −25..−15 dBFS, so the fixed mapping only ever produced levels in
 * roughly 0.45..0.55 — about 7% of the available range. Measured live on a
 * real preview: dB moved −24.9…−21.6, level moved 0.45…0.52, and after the
 * consuming component's own `0.75 + level * 0.45` brightness lift the visible
 * change was ~3%. The art *was* reacting; the maths compressed the reaction
 * to below the threshold of visibility, which is why it read as static.
 *
 * Normalising against the track's OWN loudness range instead is the same
 * principle `normaliseBand` already applies to the colour bands above, and for
 * the same reason: an absolute scale collapses real material into a sliver of
 * the output range.
 */

/** Robust loudness bounds for one track, in dBFS. */
export interface LoudnessRange {
  lo: number;
  hi: number;
}

/**
 * Narrowest range we'll normalise across. A track that really is near-constant
 * in level would otherwise divide by ~0 and turn imperceptible noise into
 * full-scale flicker — worse than under-reacting.
 *
 * Kept deliberately small (3 dB): short-term level variation within a mastered
 * mix is only a few dB, and a larger floor would re-flatten exactly the
 * material this normalisation exists to make visible.
 */
const MIN_DB_SPAN = 3;

/** Index into a per-slice series at a 0..1 playhead position. */
function indexAtProgress(length: number, progress: number): number {
  if (length <= 0) return 0;
  const p = clamp01(progress);
  return Math.min(length - 1, Math.max(0, Math.round(p * (length - 1))));
}

/**
 * The track's own loudness range, taken at the 5th/95th percentile rather than
 * min/max so a silent lead-in or one clipped transient can't stretch the scale
 * and flatten everything else back out.
 *
 * Computed once per track by the caller (it sorts, so it is not free) and
 * passed into `levelAtProgress` per frame.
 */
export function loudnessRange(db: number[]): LoudnessRange {
  const finite = db.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { lo: -45, hi: 0 };

  const sorted = [...finite].sort((a, b) => a - b);

  // Trim from each end by COUNT, not by a percentile index. A percentile
  // rounds to index 0 on short series (5% of 8 samples is 0.4 → 0), which
  // silently trims nothing and lets a single digital-silence frame set the
  // floor — the exact outlier this is meant to reject. Always drop at least
  // one sample per end once there are enough to spare.
  const trim = sorted.length >= 8 ? Math.max(1, Math.floor(sorted.length * 0.05)) : 0;
  let lo = sorted[trim];
  let hi = sorted[sorted.length - 1 - trim];

  if (hi - lo < MIN_DB_SPAN) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_DB_SPAN / 2;
    hi = mid + MIN_DB_SPAN / 2;
  }
  return { lo, hi };
}

/** Loudness at the playhead as 0..1, normalised against the track's own range. */
export function levelAtProgress(db: number[], progress: number, range: LoudnessRange): number {
  if (db.length === 0) return 0;
  const v = db[indexAtProgress(db.length, progress)];
  if (!Number.isFinite(v)) return 0;
  const span = range.hi - range.lo;
  if (span <= 0) return 0;
  return clamp01((v - range.lo) / span);
}

/**
 * Low-band energy at the playhead as 0..1, against the band's own peak.
 *
 * Loops to find the peak rather than `Math.max(...low)` — the spread form
 * throws `RangeError: Maximum call stack size exceeded` once the series is
 * long enough, and these are per-slice arrays whose length depends on track
 * duration, so it is a real (if latent) crash on long audio.
 */
export function bassAtProgress(low: number[], progress: number): number {
  if (low.length === 0) return 0;
  let peak = 0;
  for (const v of low) {
    const abs = Math.abs(Number.isFinite(v) ? v : 0);
    if (abs > peak) peak = abs;
  }
  if (peak <= 0) return 0;
  const v = low[indexAtProgress(low.length, progress)];
  return clamp01(Math.abs(Number.isFinite(v) ? v : 0) / peak);
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
