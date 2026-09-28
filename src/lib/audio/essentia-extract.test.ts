import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  ESSENTIA_SAMPLE_RATE,
  analysisWindow,
  downmix,
  extractEssentiaFeatures,
  type EssentiaCore,
} from './essentia-extract';

/**
 * These run the REAL essentia.js, not a mock. A mock is how the old client
 * code survived: it called methods the package does not have, and nothing
 * ever ran them.
 */
const require = createRequire(import.meta.url);
const { Essentia, EssentiaWASM } = require('essentia.js') as {
  Essentia: new (wasm: unknown) => EssentiaCore;
  EssentiaWASM: Record<string, unknown>;
};
const essentia = new Essentia(EssentiaWASM);

/** A deterministic beat: an F-minor triad pad, a kick on every beat and a hat on the off-beat. */
function beat(sampleRate: number, seconds: number, bpm: number): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  const period = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const f of [174.61, 207.65, 261.63]) v += Math.sin(2 * Math.PI * f * t) * 0.12;
    const kick = t % period;
    if (kick < 0.03) v += Math.sin(2 * Math.PI * 55 * t) * (1 - kick / 0.03);
    const hat = (t + period / 2) % period;
    if (hat < 0.01) v += noise() * 0.4;
    out[i] = v;
  }
  return out;
}

describe('the essentia.js package shape the app depends on', () => {
  it('EssentiaWASM is the instantiated module, not a factory', () => {
    // The old code called it / looked for EssentiaWASM.EssentiaWASM.
    expect(typeof EssentiaWASM).toBe('object');
    expect(EssentiaWASM.EssentiaWASM).toBeUndefined();
    // …and algorithms live on the core class, not the module.
    expect(EssentiaWASM.RhythmExtractor2013).toBeUndefined();
    expect(typeof (essentia as unknown as Record<string, unknown>).RhythmExtractor2013).toBe('function');
  });
});

describe('extractEssentiaFeatures', () => {
  it('reads tempo and key from a 44.1 kHz signal, with confidence', () => {
    const out = extractEssentiaFeatures(essentia, beat(ESSENTIA_SAMPLE_RATE, 20, 140));
    expect(out.bpm).toBeGreaterThan(138);
    expect(out.bpm).toBeLessThan(142);
    expect(out.key).toBe('F');
    expect(out.scale).toBe('minor');
    expect(out.bpmConfidence).toBeGreaterThan(0);
    expect(out.keyStrength).toBeGreaterThan(0);
    expect(out.keyStrength).toBeLessThanOrEqual(1);
  }, 30_000);

  it('is why callers must resample: the same beat at 48 kHz reads slow', () => {
    // The browser decodes at the device rate. Fed straight through, a 140 BPM
    // beat comes back ~128.6 (140 × 44.1 / 48).
    const out = extractEssentiaFeatures(essentia, beat(48000, 20, 140));
    expect(out.bpm).toBeLessThan(132);
  }, 30_000);

  it('returns nothing, not a guess, for a clip too short to measure', () => {
    expect(extractEssentiaFeatures(essentia, beat(ESSENTIA_SAMPLE_RATE, 1, 140))).toEqual({
      bpm: null, bpmConfidence: null, key: null, scale: null, keyStrength: null,
    });
  });

  it('returns no tempo for silence', () => {
    const out = extractEssentiaFeatures(essentia, new Float32Array(ESSENTIA_SAMPLE_RATE * 10));
    expect(out.bpm == null || out.bpmConfidence === 0).toBe(true);
  }, 30_000);
});

describe('analysisWindow', () => {
  it('takes all of a short clip', () => {
    expect(analysisWindow(44100 * 30)).toEqual({ start: 0, end: 44100 * 30 });
  });

  it('takes the middle minute of a long track', () => {
    const { start, end } = analysisWindow(44100 * 180);
    expect(end - start).toBe(44100 * 60);
    expect(start).toBe(44100 * 60);
  });
});

describe('downmix', () => {
  it('averages channels rather than dropping the right one', () => {
    const out = downmix([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(out)).toEqual([0.5, 0.5]);
  });

  it('passes mono through', () => {
    const mono = new Float32Array([0.25]);
    expect(downmix([mono])).toBe(mono);
  });
});
