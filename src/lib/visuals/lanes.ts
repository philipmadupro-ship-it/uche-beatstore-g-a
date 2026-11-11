/**
 * Pure maths for the scrolling band scrubber: series normalisation and bucket-peak lookup, per-band live energy, envelope
 * following, position extrapolation, scrub/tap mapping.
 */

import { clamp01 } from './geometry';

/**
 * Normalise a series to 0..1 against its own peak and lift the quiet body with
 * a gamma curve (a mastered beat would otherwise be a thin thread). Writes a
 * new Float32Array — called once per track, never per frame.
 */
export function normaliseSeries(values: ArrayLike<number>, gamma = 0.62): Float32Array {
  const out = new Float32Array(values.length);
  let max = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.abs(values[i]);
    if (Number.isFinite(v) && v > max) max = v;
  }
  if (max <= 0) return out;
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.abs(values[i]);
    out[i] = Number.isFinite(v) ? Math.pow(v / max, gamma) : 0;
  }
  return out;
}

/** Peak of `series` across the fraction range [f0, f1] (bucket peak, never a point sample). */
export function seriesPeakAt(series: ArrayLike<number>, f0: number, f1: number): number {
  const n = series.length;
  if (n === 0 || f1 < 0 || f0 > 1) return 0;
  const a = Math.max(0, Math.min(n - 1, Math.floor(f0 * n)));
  const b = Math.max(a, Math.min(n - 1, Math.floor(f1 * n)));
  let p = 0;
  for (let i = a; i <= b; i += 1) if (series[i] > p) p = series[i];
  return p;
}

/**
 * Live energy per band (0..1), order low, mid, high, from the log-spaced
 * analyser bands. With 64 bands over 30 Hz–16 kHz the 200 Hz and 1.5 kHz
 * crossovers fall near bands 19 and 40.
 */
export function bandEnergies(bands: ArrayLike<number>, out: Float32Array): Float32Array {
  const n = bands.length;
  const lowEnd = Math.round(n * 0.3);
  const midEnd = Math.round(n * 0.62);
  const ranges: Array<[number, number]> = [[0, lowEnd], [lowEnd, midEnd], [midEnd, n]];
  for (let l = 0; l < 3; l += 1) {
    const [a, b] = ranges[l];
    let sum = 0;
    let max = 0;
    for (let i = a; i < b; i += 1) { sum += bands[i]; if (bands[i] > max) max = bands[i]; }
    const mean = b > a ? sum / (b - a) : 0;
    out[l] = clamp01(0.45 * mean + 0.55 * max);
  }
  return out;
}

/**
 * Time-based envelope follower: fast attack, ~160 ms release. Frame-rate
 * independent, unlike a fixed per-frame lerp.
 */
export function envFollow(prev: number, target: number, dt: number, attackTau = 0.02, releaseTau = 0.16): number {
  const tau = target > prev ? attackTau : releaseTau;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return prev + (target - prev) * k;
}

/**
 * Displayed playhead (0..1). The player reports its position only a few times a
 * second, so while playing the view advances by itself and is gently pulled
 * toward each report; a big jump (a seek) is followed at once.
 */
export function advancePosition(smooth: number, target: number, dtFraction: number, playing: boolean): number {
  if (Math.abs(target - smooth) > 0.02) return target;
  if (playing) {
    const ahead = smooth + Math.max(0, dtFraction);
    return ahead + (target - ahead) * 0.1;
  }
  return smooth + (target - smooth) * 0.25;
}

/** Dragging the waveform moves it under the fixed playhead: content right = earlier. */
export function scrubFraction(startPos: number, dxPx: number, widthPx: number, visibleSeconds: number, durationSeconds: number): number {
  if (widthPx <= 0 || durationSeconds <= 0) return clamp01(startPos);
  return clamp01(startPos - (dxPx / widthPx) * (visibleSeconds / durationSeconds));
}

/** Tap at `xPx`: jump by the distance from the centre, in the visible window's seconds. */
export function tapFraction(pos: number, xPx: number, widthPx: number, visibleSeconds: number, durationSeconds: number): number {
  if (widthPx <= 0 || durationSeconds <= 0) return clamp01(pos);
  return clamp01(pos + ((xPx / widthPx) - 0.5) * (visibleSeconds / durationSeconds));
}
