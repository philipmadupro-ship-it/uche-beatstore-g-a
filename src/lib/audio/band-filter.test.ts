import { describe, it, expect } from 'vitest';
import {
  applyBiquad,
  biquadCoefficients,
  extractBandEnergies,
  mixToMono,
  sliceRms,
  BANDPASS_Q,
  DEFAULT_Q,
} from './band-filter';

const SR = 22050;

/** Generate `seconds` of a sine at `hz`. */
function sine(hz: number, seconds = 0.5, sampleRate = SR): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/** Mean RMS of a whole buffer, skipping the filter's settling transient. */
function rmsOf(buf: Float32Array, skip = 2000): number {
  let sum = 0;
  let n = 0;
  for (let i = skip; i < buf.length; i++) { sum += buf[i] * buf[i]; n++; }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

function filterRms(kind: 'lowpass' | 'bandpass' | 'highpass', freq: number, q: number, input: Float32Array) {
  const out = new Float32Array(input.length);
  applyBiquad(input, out, biquadCoefficients(kind, freq, SR, q));
  return rmsOf(out);
}

describe('biquadCoefficients', () => {
  it('produces finite coefficients across the audible range', () => {
    for (const hz of [20, 250, 1400, 4000, 10000]) {
      for (const kind of ['lowpass', 'bandpass', 'highpass'] as const) {
        const c = biquadCoefficients(kind, hz, SR, DEFAULT_Q);
        for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('clamps a cutoff at or above Nyquist instead of degenerating', () => {
    // Reachable in practice: we analyse at a reduced sample rate, so the 4 kHz
    // crossover could approach Nyquist on an unusual input.
    const c = biquadCoefficients('lowpass', SR, SR, DEFAULT_Q);
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
  });

  it('clamps a non-positive frequency', () => {
    const c = biquadCoefficients('highpass', 0, SR, DEFAULT_Q);
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
  });

  it('falls back to a sane Q when given zero or negative', () => {
    const c = biquadCoefficients('lowpass', 250, SR, 0);
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('applyBiquad — actual frequency response', () => {
  it('lowpass passes a 60Hz tone and rejects an 8kHz tone', () => {
    const passed = filterRms('lowpass', 250, DEFAULT_Q, sine(60));
    const rejected = filterRms('lowpass', 250, DEFAULT_Q, sine(8000));
    expect(passed).toBeGreaterThan(0.5);
    expect(rejected).toBeLessThan(passed / 20);
  });

  it('highpass passes an 8kHz tone and rejects a 60Hz tone', () => {
    const passed = filterRms('highpass', 4000, DEFAULT_Q, sine(8000));
    const rejected = filterRms('highpass', 4000, DEFAULT_Q, sine(60));
    expect(passed).toBeGreaterThan(0.5);
    expect(rejected).toBeLessThan(passed / 20);
  });

  it('bandpass favours its centre over both extremes', () => {
    const centre = filterRms('bandpass', 1400, BANDPASS_Q, sine(1400));
    const low = filterRms('bandpass', 1400, BANDPASS_Q, sine(50));
    const high = filterRms('bandpass', 1400, BANDPASS_Q, sine(12000));
    expect(centre).toBeGreaterThan(low * 5);
    expect(centre).toBeGreaterThan(high * 5);
  });

  it('leaves silence silent', () => {
    const out = filterRms('lowpass', 250, DEFAULT_Q, new Float32Array(4096));
    expect(out).toBe(0);
  });

  it('does not blow up on a full-scale impulse (stability)', () => {
    const input = new Float32Array(8192);
    input[0] = 1;
    const out = new Float32Array(input.length);
    applyBiquad(input, out, biquadCoefficients('bandpass', 1400, SR, BANDPASS_Q));
    // A stable filter's impulse response decays; an unstable one diverges.
    const tail = rmsOf(out.slice(6000), 0);
    expect(Number.isFinite(tail)).toBe(true);
    expect(tail).toBeLessThan(0.01);
  });
});

describe('sliceRms', () => {
  it('returns exactly the requested slice count', () => {
    for (const n of [1, 16, 512]) {
      expect(sliceRms(sine(440, 0.2), n)).toHaveLength(n);
    }
  });

  it('reports ~0.707 RMS for a full-scale sine', () => {
    const [value] = sliceRms(sine(440, 0.2), 1);
    expect(value).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('tracks a loud section as louder than a quiet one', () => {
    const buf = sine(440, 0.4);
    for (let i = 0; i < buf.length / 2; i++) buf[i] *= 0.1;
    const [quiet, loud] = sliceRms(buf, 2);
    expect(loud).toBeGreaterThan(quiet * 5);
  });

  it('handles empty input and non-positive counts without throwing', () => {
    expect(sliceRms(new Float32Array(0), 4)).toEqual([0, 0, 0, 0]);
    expect(sliceRms(sine(440, 0.1), 0)).toEqual([]);
  });
});

describe('extractBandEnergies', () => {
  it('routes a sub-bass tone to the low band', () => {
    const { low, mid, high } = extractBandEnergies(sine(60, 0.5), SR, 8);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(low)).toBeGreaterThan(avg(mid));
    expect(avg(low)).toBeGreaterThan(avg(high));
  });

  it('routes an air-band tone to the high band', () => {
    const { low, mid, high } = extractBandEnergies(sine(9000, 0.5), SR, 8);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(high)).toBeGreaterThan(avg(low));
    expect(avg(high)).toBeGreaterThan(avg(mid));
  });

  it('returns equal-length arrays matching sliceCount', () => {
    const bands = extractBandEnergies(sine(440, 0.3), SR, 32);
    expect(bands.low).toHaveLength(32);
    expect(bands.mid).toHaveLength(32);
    expect(bands.high).toHaveLength(32);
  });

  it('emits only finite values for a mixed signal', () => {
    const a = sine(50, 0.3);
    const b = sine(3000, 0.3);
    const mixed = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mixed[i] = (a[i] + b[i]) / 2;
    const bands = extractBandEnergies(mixed, SR, 16);
    for (const series of [bands.low, bands.mid, bands.high]) {
      for (const v of series) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('mixToMono', () => {
  it('returns the single channel untouched', () => {
    const ch = sine(440, 0.05);
    expect(mixToMono([ch])).toBe(ch);
  });

  it('averages channels rather than taking the first', () => {
    // Kick hard-left, snare hard-right: taking [0] would lose half the track.
    const left = new Float32Array([1, 1, 1, 1]);
    const right = new Float32Array([0, 0, 0, 0]);
    expect(Array.from(mixToMono([left, right]))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('handles no channels', () => {
    expect(mixToMono([])).toHaveLength(0);
  });
});
