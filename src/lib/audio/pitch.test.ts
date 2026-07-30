import { describe, it, expect } from 'vitest';
import {
  detectPitch,
  detectPitchSeries,
  formatReadout,
  hzToNote,
  rmsToDb,
  MIN_DB,
} from './pitch';

const SR = 22050;

function sine(hz: number, samples = 4096, sampleRate = SR): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

describe('hzToNote', () => {
  it('maps A440 to A4 with no detuning', () => {
    const n = hzToNote(440);
    expect(n).not.toBeNull();
    expect(n!.label).toBe('A4');
    expect(n!.cents).toBe(0);
  });

  it('maps octaves of A correctly', () => {
    expect(hzToNote(220)!.label).toBe('A3');
    expect(hzToNote(880)!.label).toBe('A5');
  });

  it('maps middle C', () => {
    // C4 ≈ 261.63 Hz in 12-TET with A4=440.
    expect(hzToNote(261.63)!.label).toBe('C4');
  });

  it('reports sharp and flat deviation with the right sign', () => {
    // A quarter-tone above A4 is ~+50 cents; below is ~−50.
    expect(hzToNote(440 * Math.pow(2, 25 / 1200))!.cents).toBeGreaterThan(20);
    expect(hzToNote(440 * Math.pow(2, -25 / 1200))!.cents).toBeLessThan(-20);
  });

  it('keeps cents within a semitone', () => {
    for (const hz of [55, 123.47, 440, 1000, 3520]) {
      const n = hzToNote(hz)!;
      expect(Math.abs(n.cents)).toBeLessThanOrEqual(50);
    }
  });

  it('returns null for unusable input rather than a nonsense note', () => {
    expect(hzToNote(0)).toBeNull();
    expect(hzToNote(-100)).toBeNull();
    expect(hzToNote(NaN)).toBeNull();
    expect(hzToNote(Infinity)).toBeNull();
  });

  it('rejects frequencies outside the MIDI range', () => {
    expect(hzToNote(0.001)).toBeNull();
    expect(hzToNote(1_000_000)).toBeNull();
  });
});

describe('rmsToDb', () => {
  it('maps full scale to 0 dB', () => {
    expect(rmsToDb(1)).toBe(0);
  });

  it('maps half amplitude to about −6 dB', () => {
    expect(rmsToDb(0.5)).toBeCloseTo(-6, 0);
  });

  it('floors silence instead of returning -Infinity', () => {
    expect(rmsToDb(0)).toBe(MIN_DB);
    expect(Number.isFinite(rmsToDb(0))).toBe(true);
  });

  it('handles invalid input', () => {
    expect(rmsToDb(NaN)).toBe(MIN_DB);
    expect(rmsToDb(-1)).toBe(MIN_DB);
  });
});

describe('detectPitch', () => {
  it('recovers a 440Hz sine to within a few cents', () => {
    const hz = detectPitch(sine(440), SR);
    expect(hz).not.toBeNull();
    expect(hz!).toBeGreaterThan(435);
    expect(hz!).toBeLessThan(445);
    expect(hzToNote(hz!)!.label).toBe('A4');
  });

  it('recovers a sub-bass fundamental — the musically important case', () => {
    const hz = detectPitch(sine(55), SR);
    expect(hz).not.toBeNull();
    expect(hz!).toBeGreaterThan(52);
    expect(hz!).toBeLessThan(58);
  });

  it('recovers a mid tone', () => {
    const hz = detectPitch(sine(220), SR);
    expect(hz!).toBeGreaterThan(215);
    expect(hz!).toBeLessThan(225);
  });

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(4096), SR)).toBeNull();
  });

  it('returns null for white noise rather than inventing a pitch', () => {
    const noise = new Float32Array(4096);
    let seed = 12345;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x3fffffff) - 1;
    }
    // Percussive/noisy material has no fundamental; a confident answer here
    // would be fabricated data on the readout.
    expect(detectPitch(noise, SR)).toBeNull();
  });

  it('returns null for too-short or invalid input', () => {
    expect(detectPitch(new Float32Array(16), SR)).toBeNull();
    expect(detectPitch(sine(440), 0)).toBeNull();
    expect(detectPitch(sine(440), NaN)).toBeNull();
  });

  it('does not report anything outside the search range', () => {
    for (const hz of [10, 20, 5000, 9000]) {
      const got = detectPitch(sine(hz), SR);
      if (got !== null) {
        expect(got).toBeGreaterThanOrEqual(40);
        expect(got).toBeLessThanOrEqual(1200);
      }
    }
  });
});

describe('detectPitchSeries', () => {
  it('returns one entry per slice', () => {
    expect(detectPitchSeries(sine(440, SR), SR, 8)).toHaveLength(8);
  });

  it('detects a steady tone across most slices', () => {
    const series = detectPitchSeries(sine(440, SR * 2), SR, 8);
    const found = series.filter((v) => v !== null);
    expect(found.length).toBeGreaterThan(4);
    for (const hz of found) {
      expect(hz!).toBeGreaterThan(430);
      expect(hz!).toBeLessThan(450);
    }
  });

  it('returns nulls for a silent track without throwing', () => {
    const series = detectPitchSeries(new Float32Array(SR), SR, 4);
    expect(series).toEqual([null, null, null, null]);
  });

  it('handles empty input and non-positive slice counts', () => {
    expect(detectPitchSeries(new Float32Array(0), SR, 4)).toEqual([null, null, null, null]);
    expect(detectPitchSeries(sine(440), SR, 0)).toEqual([]);
  });

  it('does not throw when the buffer is shorter than the window', () => {
    expect(() => detectPitchSeries(new Float32Array(100), SR, 4)).not.toThrow();
  });
});

describe('formatReadout', () => {
  it('formats the full line like the reference player', () => {
    expect(formatReadout(-46.8, 405.2)).toContain('−46.8 dB');
    expect(formatReadout(-46.8, 405.2)).toContain('405.2 Hz');
    expect(formatReadout(-46.8, 405.2)).toMatch(/G#4\s[−+]?\d+¢/);
  });

  it('omits pitch when none was detected', () => {
    const out = formatReadout(-20, null);
    expect(out).toBe('−20 dB');
    expect(out).not.toContain('Hz');
  });

  it('shows −∞ at the silence floor', () => {
    expect(formatReadout(MIN_DB, null)).toContain('−∞');
  });

  it('uses a real minus sign, not a hyphen, so figures do not jitter', () => {
    // U+2212 keeps width consistent in tabular-nums.
    expect(formatReadout(-12.3, null).charCodeAt(0)).toBe(0x2212);
  });
});
