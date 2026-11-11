/**
 * Pure geometry for the audio visuals. No DOM, no canvas, no allocation in the
 * per-frame helpers (they write into caller-owned buffers), so each piece is
 * unit-testable and the draw loop never creates garbage.
 */

export const BAND_COUNT = 64;

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0;
}

/**
 * Downsample `src[from..to)` into `out` by the PEAK of each bucket — never a
 * point sample, which lands between transients and turns a kick into noise.
 * Writes `out.length` values and returns `out`.
 */
export function bucketPeaks(
  src: ArrayLike<number>,
  out: Float32Array,
  from = 0,
  to = src.length,
): Float32Array {
  const n = out.length;
  const span = Math.max(0, to - from);
  if (n === 0) return out;
  if (span === 0) { out.fill(0); return out; }
  for (let i = 0; i < n; i += 1) {
    const a = from + Math.floor((i * span) / n);
    const b = Math.max(a + 1, from + Math.floor(((i + 1) * span) / n));
    let peak = 0;
    for (let j = a; j < b && j < to; j += 1) {
      const v = Math.abs(src[j] ?? 0);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

/**
 * Collapse FFT magnitude bytes (0..255, linear frequency) into log-spaced
 * bands, peak per band, normalised to 0..1. Low bands get few bins, highs many,
 * which is how the ear (and the reference's spectrum curves) read it.
 */
export function logBands(
  fft: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
  minHz = 30,
  maxHz = 16000,
): Float32Array {
  const n = out.length;
  const bins = fft.length;
  if (n === 0 || bins === 0) return out;
  const nyquist = sampleRate / 2;
  const hi = Math.min(maxHz, nyquist);
  const ratio = hi / minHz;
  for (let i = 0; i < n; i += 1) {
    const f0 = minHz * Math.pow(ratio, i / n);
    const f1 = minHz * Math.pow(ratio, (i + 1) / n);
    const b0 = Math.min(bins - 1, Math.floor((f0 / nyquist) * bins));
    const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * bins)));
    let peak = 0;
    for (let b = b0; b < b1; b += 1) if (fft[b] > peak) peak = fft[b];
    out[i] = peak / 255;
  }
  return out;
}

/**
 * One-pole attack/release smoothing, in place: rises quickly, falls slowly, so
 * peaks glow and decay instead of flickering. `attack`/`release` are 0..1
 * per-frame blend factors (1 = jump straight to target).
 */
export function smoothDecay(
  state: Float32Array,
  target: ArrayLike<number>,
  attack = 0.55,
  release = 0.12,
): Float32Array {
  for (let i = 0; i < state.length; i += 1) {
    const t = target[i] ?? 0;
    const k = t > state[i] ? attack : release;
    state[i] += (t - state[i]) * k;
  }
  return state;
}

/** Rolling spectrum history (newest row first); fixed rows, no allocation on push. */
export interface History {
  rows: Float32Array[];
  head: number; // index of the newest row
}

export function createHistory(rows: number, width: number): History {
  return { rows: Array.from({ length: rows }, () => new Float32Array(width)), head: 0 };
}

export function pushHistory(h: History, row: ArrayLike<number>): void {
  h.head = (h.head - 1 + h.rows.length) % h.rows.length;
  h.rows[h.head].set(row as ArrayLike<number> as Float32Array);
}

/** Row `age` frames old (0 = newest). */
export function historyRow(h: History, age: number): Float32Array {
  return h.rows[(h.head + age) % h.rows.length];
}

/**
 * Perspective projection of a point on the terrain grid.
 * x, z in -1..1 (z = -1 far, 1 near), y is height 0..1. Returns screen
 * coordinates in the writable `out` pair and the depth scale used.
 */
export interface Camera {
  width: number;
  height: number;
  /** Larger = flatter perspective. */
  distance: number;
  /** World height multiplier. */
  heightScale: number;
  /** Vertical anchor of the near edge, 0..1 of height. */
  horizon: number;
}

export function project(
  cam: Camera,
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number; s: number },
): void {
  // z in [-1, 1] -> depth in [distance + 1, distance - 1]; near is bigger.
  const depth = cam.distance - z;
  const s = cam.distance / depth;
  out.x = cam.width / 2 + x * (cam.width / 2) * 0.96 * s;
  const base = cam.height * cam.horizon;
  const floor = base - (1 - s) * cam.height * 0.18 * 2.2;
  out.y = floor - y * cam.heightScale * cam.height * s;
  out.s = s;
}

/** Polar mapping for the orbit plot: index i of n around a centre at radius r. */
export function polar(
  i: number,
  n: number,
  radius: number,
  cx: number,
  cy: number,
  out: { x: number; y: number },
  startAngle = -Math.PI / 2,
): void {
  const a = startAngle + (i / n) * Math.PI * 2;
  out.x = cx + Math.cos(a) * radius;
  out.y = cy + Math.sin(a) * radius;
}

/**
 * Static spectrum-ish bands from precomputed amplitude peaks around a playhead
 * (`progress` 0..1). Used before play, with no analyser, and as the fallback
 * when a source cannot be analysed: the shape is real (the track's own peaks),
 * and moves with playback progress. A gentle tilt keeps lows taller than highs.
 */
export function bandsFromPeaks(
  peaks: ArrayLike<number>,
  progress: number,
  out: Float32Array,
  windowFraction = 0.04,
): Float32Array {
  const len = peaks.length;
  const n = out.length;
  if (len === 0 || n === 0) { out.fill(0); return out; }
  const centre = clamp01(progress) * len;
  const half = Math.max(n / 2, (windowFraction * len) / 2);
  let from = Math.floor(centre - half);
  let to = Math.ceil(centre + half);
  if (from < 0) { to -= from; from = 0; }
  if (to > len) { from = Math.max(0, from - (to - len)); to = len; }
  bucketPeaks(peaks, out, from, to);
  for (let i = 0; i < n; i += 1) {
    const tilt = 1 - 0.55 * (i / n);
    out[i] = clamp01(out[i] * tilt);
  }
  return out;
}

/** True when every value is (near) zero — used to detect a silent/tainted analyser. */
export function isFlat(values: ArrayLike<number>, epsilon = 1): boolean {
  for (let i = 0; i < values.length; i += 1) if (values[i] > epsilon) return false;
  return true;
}

/** RMS of unsigned-byte time-domain samples (128 = zero), as 0..1. */
export function rmsOfBytes(time: ArrayLike<number>): number {
  const n = time.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = (time[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * Fill every history row from the track's peaks at points ALONG the track
 * behind the playhead (age 0 = at `progress`, older rows earlier), so a static
 * terrain is a real picture of the music just heard rather than an empty plane.
 */
export function fillHistoryFromPeaks(
  peaks: ArrayLike<number>,
  progress: number,
  h: History,
  scratch: Float32Array,
  stepFraction = 0.012,
): void {
  const rows = h.rows.length;
  for (let age = rows - 1; age >= 0; age -= 1) {
    bandsFromPeaks(peaks, progress - age * stepFraction, scratch);
    h.head = (h.head - 1 + rows) % rows;
    h.rows[h.head].set(scratch);
  }
}

export function meanOf(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += values[i];
  return s / n;
}
