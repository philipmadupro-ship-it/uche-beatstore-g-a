/**
 * Biquad band splitting — the server-side twin of the browser's
 * BiquadFilterNode.
 *
 * WHY THIS EXISTS: the beat preview waveform is coloured by which part of the
 * spectrum dominates each slice of time. That colouring was computed in the
 * browser with three OfflineAudioContext renders, which meant every visitor
 * re-decoded every track on every page load — and, because the public R2
 * bucket sends no CORS headers, pulled the full master through a serverless
 * proxy to do it. Computing the bands once at upload removes both costs.
 *
 * To keep the rendered colours identical to what the client produced, this
 * implements the same maths the Web Audio spec mandates: the RBJ Audio EQ
 * Cookbook coefficients, evaluated as a Direct Form I difference equation.
 * No new dependency — `extractPeaks` already hands us raw Float32Array channel
 * data and a sample rate.
 *
 * Deliberately pure (no `server-only`, no I/O) so it is unit-testable. The
 * caller in `peaks.ts` owns decoding.
 */

/** Coefficients for one biquad section, pre-normalised by a0. */
export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type FilterKind = 'lowpass' | 'bandpass' | 'highpass';

/**
 * The ONE source of the band crossovers (waveform colouring, the browser
 * analysis and the server sidecar all read these).
 *
 * Low is a kick / 808 band, so the split sits at 250 Hz (Mixxx uses 600 Hz; for
 * hip-hop the body of an 808 lives well under 250). Everything from 250 Hz to
 * 4 kHz is "mid" — vocals, snares, chords. Above 4 kHz is "high": hats and air.
 */
export const CROSSOVER_LOW_HZ = 250;
export const CROSSOVER_HIGH_HZ = 4000;
/** Butterworth Q for each 2nd-order section; two cascaded give a 4th-order slope. */
export const BUTTERWORTH_Q = Math.SQRT1_2;
export const DEFAULT_Q = 1;
export const BANDPASS_Q = 0.5;

/**
 * RBJ Audio EQ Cookbook coefficients, normalised by a0.
 *
 * `frequency` is clamped below Nyquist: a cutoff at or above sampleRate/2 makes
 * the cookbook formulas degenerate (cos(w0) → -1 and the filter blows up or
 * silences), which is reachable in practice because we analyse at a reduced
 * sample rate and the high crossover sits at 4 kHz.
 */
export function biquadCoefficients(
  kind: FilterKind,
  frequency: number,
  sampleRate: number,
  q: number,
): BiquadCoefficients {
  const nyquist = sampleRate / 2;
  // Leave headroom below Nyquist rather than sitting exactly on it.
  const f0 = Math.min(Math.max(frequency, 1), nyquist * 0.98);
  const safeQ = q > 0 ? q : DEFAULT_Q;

  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * safeQ);

  let b0: number, b1: number, b2: number;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  switch (kind) {
    case 'lowpass':
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      break;
    case 'highpass':
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      break;
    case 'bandpass':
      // Constant 0 dB peak gain form — the one Web Audio's "bandpass" uses.
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      break;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Apply a biquad in place over `input`, writing into `output`.
 *
 * Direct Form I. Caller supplies the output buffer so a three-band split can
 * reuse two scratch arrays instead of allocating per band on long tracks.
 */
export function applyBiquad(
  input: Float32Array,
  output: Float32Array,
  c: BiquadCoefficients,
): Float32Array {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    output[i] = y0;
  }
  return output;
}

/**
 * Like `applyBiquad`, but the filter starts SETTLED on the first sample (as if
 * that value had been playing forever) instead of from silence. Without this a
 * track that starts at a non-zero level, or a high-pass fed a step, rings or
 * ramps at the very start.
 */
export function applyBiquadSettled(
  input: Float32Array,
  output: Float32Array,
  c: BiquadCoefficients,
): Float32Array {
  if (input.length === 0) return output;
  const x0 = input[0];
  // DC gain of the section: low-pass passes the level (1), high/band-pass block it (0).
  const dc = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
  const y0 = Number.isFinite(dc) ? dc * x0 : 0;
  let x1 = x0, x2 = x0, y1 = y0, y2 = y0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    output[i] = y;
  }
  return output;
}

export type BandName = 'low' | 'mid' | 'high';

/**
 * One band of the three-way split, as TWO cascaded 2nd-order sections
 * (4th-order overall). `scratch` and `output` are caller-owned and must be the
 * input's length; `input` is not modified.
 *   low  = low-pass 250 Hz (twice)
 *   mid  = high-pass 250 Hz, then low-pass 4 kHz
 *   high = high-pass 4 kHz (twice)
 */
export function filterBand(
  band: BandName,
  input: Float32Array,
  scratch: Float32Array,
  output: Float32Array,
  sampleRate: number,
): Float32Array {
  const q = BUTTERWORTH_Q;
  const lp = (f: number) => biquadCoefficients('lowpass', f, sampleRate, q);
  const hp = (f: number) => biquadCoefficients('highpass', f, sampleRate, q);
  const [first, second] = band === 'low'
    ? [lp(CROSSOVER_LOW_HZ), lp(CROSSOVER_LOW_HZ)]
    : band === 'mid'
      ? [hp(CROSSOVER_LOW_HZ), lp(CROSSOVER_HIGH_HZ)]
      : [hp(CROSSOVER_HIGH_HZ), hp(CROSSOVER_HIGH_HZ)];
  applyBiquadSettled(input, scratch, first);
  return applyBiquadSettled(scratch, output, second);
}

/**
 * RMS per slice.
 *
 * Bands use RMS while the amplitude waveform uses absolute-max — that
 * difference is load-bearing. Abs-max preserves transients, which is what you
 * want for a waveform's *shape*; RMS reflects sustained energy, which is what
 * you want for judging which band dominates. Swapping one for the other makes
 * hi-hats read as loud as an 808.
 */
export function sliceRms(samples: Float32Array, sliceCount: number): number[] {
  const out = new Array<number>(sliceCount).fill(0);
  if (samples.length === 0 || sliceCount <= 0) return out;

  const per = samples.length / sliceCount;
  for (let i = 0; i < sliceCount; i++) {
    const start = Math.floor(i * per);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * per)));
    let sumSquares = 0;
    for (let j = start; j < end; j++) sumSquares += samples[j] * samples[j];
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    // 5 decimals keeps the JSON small; band values are normalised for display
    // anyway, so precision beyond this is not observable.
    out[i] = Math.round(rms * 1e5) / 1e5;
  }
  return out;
}

export interface BandEnergies {
  low: number[];
  mid: number[];
  high: number[];
}

/**
 * Split a mono signal into low/mid/high (4th-order, see `filterBand`) and
 * reduce each to per-slice RMS.
 *
 * Allocates two scratch buffers total regardless of band count — a 3-minute
 * master at 22 kHz is ~4M samples, so allocating per band would churn ~48 MB
 * of Float32Array inside a serverless function for no reason.
 */
export function extractBandEnergies(
  mono: Float32Array,
  sampleRate: number,
  sliceCount: number,
): BandEnergies {
  const scratch = new Float32Array(mono.length);
  const filtered = new Float32Array(mono.length);
  const run = (band: BandName): number[] => {
    filterBand(band, mono, scratch, filtered, sampleRate);
    return sliceRms(filtered, sliceCount);
  };
  return { low: run('low'), mid: run('mid'), high: run('high') };
}

/**
 * Average an arbitrary number of channels into one mono buffer.
 *
 * Mirrors the mixdown in `computePeaks` — averaged rather than taking channel 0
 * so a track with the kick hard-left and the snare hard-right still analyses
 * representatively.
 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i] || 0;
    mono[i] = sum / channels.length;
  }
  return mono;
}
