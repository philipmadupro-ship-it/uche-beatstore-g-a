import { describe, it, expect } from 'vitest';
import { parseClientAnalysis } from './client-analysis';

describe('parseClientAnalysis', () => {
  it('keeps a well-formed Essentia result, confidence included', () => {
    const raw = { bpm: 140, key: 'F', scale: 'minor', loudness: null, duration: 184, bpmConfidence: 3.9, keyStrength: 0.77 };
    expect(parseClientAnalysis(raw)).toEqual({ analysis: raw, rejected: [] });
  });

  it('drops only the bad field, so the server fills it', () => {
    const out = parseClientAnalysis({ bpm: 99999, key: 'Bb', scale: 'major', duration: 120 });
    expect(out.analysis).toEqual({ key: 'Bb', scale: 'major', duration: 120 });
    expect(out.rejected).toEqual(['bpm']);
  });

  it.each([
    [{ bpm: Number.NaN }, 'bpm'],
    [{ bpm: '140' }, 'bpm'],
    [{ key: '<script>', scale: 'minor' }, 'key'],
    [{ key: 'H', scale: 'minor' }, 'key'],
    [{ key: 'F', scale: 'dorian' }, 'scale'],
    [{ energy: 4 }, 'energy'],
    [{ duration: -1 }, 'duration'],
  ])('rejects %j', (raw, field) => {
    expect(parseClientAnalysis(raw).rejected).toContain(field);
  });

  it('never keeps half a key', () => {
    const out = parseClientAnalysis({ bpm: 90, key: 'F', scale: 'dorian' });
    expect(out.analysis).toEqual({ bpm: 90, key: null, scale: null });
    expect(out.rejected).toEqual(expect.arrayContaining(['scale', 'key']));
  });

  it('ignores fields that are not analysis', () => {
    expect(parseClientAnalysis({ bpm: 90, user_id: 'x', store_listed: true }).analysis).toEqual({ bpm: 90 });
  });

  it('treats absent, non-object and empty payloads as no analysis', () => {
    expect(parseClientAnalysis(undefined)).toEqual({ analysis: null, rejected: [] });
    expect(parseClientAnalysis(null)).toEqual({ analysis: null, rejected: [] });
    expect(parseClientAnalysis('140')).toEqual({ analysis: null, rejected: ['(payload)'] });
    expect(parseClientAnalysis([140])).toEqual({ analysis: null, rejected: ['(payload)'] });
    // What a failed browser analysis sends: every field null.
    expect(parseClientAnalysis({ bpm: null, key: null, scale: null }).analysis).toBeNull();
  });
});
