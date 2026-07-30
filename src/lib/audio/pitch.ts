/**
 * Pitch and level readout for the beat preview player.
 *
 * Drives the `−46.8 dB · 405.2 Hz · G#4 −43¢` overlay that rides the waveform.
 *
 * WHY PRECOMPUTED: the obvious way to get this is an AnalyserNode on the
 * playing audio, but the player is a plain `<audio>` element with no Web Audio
 * graph and no `crossOrigin`. Attaching `createMediaElementSource` would need
 * CORS on the audio (the same wall that forces the analysis proxy) *and* would
 * route playback through Web Audio, putting the synchronous tap-to-play path at
 * risk. So these values are computed once at upload and looked up at the
 * playhead — zero cost and zero risk at play time.
 *
 * Pure and dependency-free so it can be unit-tested; the caller owns decoding.
 */

/** Sharp spelling, matching how the app already labels keys elsewhere. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Quietest level we report. Below this the readout shows silence, not −∞. */
export const MIN_DB = -100;

/**
 * Pitch search range. Deliberately wide at the bottom (sub-bass 808s are the
 * most musically informative thing in a beat) and stopping well below the hats,
 * because above ~1.2 kHz autocorrelation on polyphonic material starts locking
 * onto harmonics rather than fundamentals.
 */
export const MIN_PITCH_HZ = 40;
export const MAX_PITCH_HZ = 1200;

/**
 * How periodic a window must be before we believe the pitch. Percussive or
 * noisy slices have no real fundamental; reporting one would be inventing data.
 */
const MIN_CLARITY = 0.3;

/**
 * How close a candidate peak must be to the best one to be accepted as the
 * fundamental. Tight enough that noise doesn't win, loose enough that a real
 * fundamental slightly weaker than its own octave still does.
 */
const PEAK_ACCEPT_RATIO = 0.85;

export interface NoteName {
  /** e.g. "G#" */
  note: string;
  /** Scientific pitch notation octave, e.g. 4 for A4 = 440Hz. */
  octave: number;
  /** Deviation from equal temperament, −50..+50. */
  cents: number;
  /** Convenience label, e.g. "G#4". */
  label: string;
}

/**
 * Convert a frequency to the nearest 12-TET note, A4 = 440 Hz.
 *
 * Returns null for anything unusable rather than a nonsense note, so callers
 * can hide the readout instead of showing a confident wrong answer.
 */
export function hzToNote(hz: number): NoteName | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;

  // MIDI 69 is A4. The +0.5/floor dance elsewhere is avoided by rounding.
  const midiFloat = 69 + 12 * Math.log2(hz / 440);
  if (!Number.isFinite(midiFloat)) return null;

  const midi = Math.round(midiFloat);
  // Outside the piano-ish range this is measurement noise, not a note.
  if (midi < 0 || midi > 127) return null;

  const cents = Math.round((midiFloat - midi) * 100);
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;

  return { note, octave, cents, label: `${note}${octave}` };
}

/** RMS (0..1) to dBFS, floored at MIN_DB so silence doesn't produce −Infinity. */
export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return MIN_DB;
  const db = 20 * Math.log10(rms);
  if (!Number.isFinite(db)) return MIN_DB;
  return Math.max(MIN_DB, Math.round(db * 10) / 10);
}

/**
 * Estimate the dominant frequency of one window by normalised autocorrelation.
 *
 * Chosen over an FFT because we only need a single fundamental per slice over a
 * narrow lag range, which autocorrelation gives directly without needing an FFT
 * implementation or a dependency. Cost is bounded by clamping the lag range to
 * MIN/MAX_PITCH_HZ rather than searching every lag.
 *
 * Returns null when the window isn't periodic enough to have a real pitch.
 */
export function detectPitch(
  window: Float32Array,
  sampleRate: number,
): number | null {
  const n = window.length;
  if (n < 64 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ));
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / MIN_PITCH_HZ));
  if (maxLag <= minLag) return null;

  // Energy at lag 0 normalises the correlation into 0..1 so MIN_CLARITY means
  // the same thing regardless of how loud the slice is.
  let energy = 0;
  for (let i = 0; i < n; i++) energy += window[i] * window[i];
  if (energy <= 1e-9) return null;

  // Biased autocorrelation: normalise by total energy only, NOT by the overlap
  // length. Dividing by the overlap looks like fairness but inflates long lags
  // (fewer samples averaged), so the detector locks onto subharmonics — a
  // 220Hz sine reported as 44Hz. The biased form tapers with lag, which is
  // exactly the bias toward the fundamental we want.
  const r = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1 <= 0 ? 1 : minLag - 1; lag <= Math.min(maxLag + 1, n - 1); lag++) {
    let sum = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) sum += window[i] * window[i + lag];
    r[lag] = sum / energy;
  }

  let globalMax = 0;
  for (let lag = minLag; lag <= maxLag; lag++) if (r[lag] > globalMax) globalMax = r[lag];
  if (globalMax < MIN_CLARITY) return null;

  // Take the FIRST local maximum that comes close to the global best, rather
  // than the global best itself. A periodic signal correlates just as well at
  // every multiple of its period, so the global max is frequently an octave
  // (or two) below the true pitch. The shortest qualifying period is the
  // fundamental.
  const threshold = globalMax * PEAK_ACCEPT_RATIO;
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (r[lag] >= threshold && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      bestLag = lag;
      break;
    }
  }
  if (bestLag < 0) return null;

  // Parabolic interpolation around the peak — without it the reported pitch
  // quantises to integer lags, which at 22kHz is >20 cents of error up high.
  const y0 = r[bestLag - 1];
  const y1 = r[bestLag];
  const y2 = r[bestLag + 1];
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const refinedLag = bestLag + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0);
  if (refinedLag <= 0) return null;

  const hz = sampleRate / refinedLag;
  if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) return null;
  return Math.round(hz * 10) / 10;
}

/**
 * Per-slice pitch across a whole track.
 *
 * Samples a bounded window from the centre of each slice rather than
 * correlating the entire slice: on a 3-minute master a slice is thousands of
 * samples, and autocorrelation is O(window x lags), so analysing the whole
 * slice would take minutes inside a function with a 60s ceiling. A window at
 * the slice's midpoint is representative enough for a readout.
 */
export function detectPitchSeries(
  mono: Float32Array,
  sampleRate: number,
  sliceCount: number,
  windowSize = 2048,
): (number | null)[] {
  const out = new Array<number | null>(sliceCount).fill(null);
  if (mono.length === 0 || sliceCount <= 0) return out;

  const per = mono.length / sliceCount;
  for (let i = 0; i < sliceCount; i++) {
    const centre = Math.floor((i + 0.5) * per);
    const start = Math.max(0, Math.min(mono.length - windowSize, centre - windowSize / 2));
    if (start < 0 || mono.length < windowSize) continue;
    out[i] = detectPitch(mono.subarray(start, start + windowSize), sampleRate);
  }
  return out;
}

/**
 * Format one readout line, e.g. `−46.8 dB · 405.2 Hz · G#4 −43¢`.
 *
 * Uses a real minus sign (U+2212) rather than a hyphen so the figures align in
 * a tabular-nums font instead of jittering as values change.
 */
export function formatReadout(db: number, hz: number | null): string {
  const dbPart = `${db <= MIN_DB ? '−∞' : formatSigned(db)} dB`;
  if (hz == null) return dbPart;

  const note = hzToNote(hz);
  const hzPart = `${hz.toFixed(1)} Hz`;
  if (!note) return `${dbPart} · ${hzPart}`;

  return `${dbPart} · ${hzPart} · ${note.label} ${formatSigned(note.cents)}¢`;
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return `${rounded}`;
}
