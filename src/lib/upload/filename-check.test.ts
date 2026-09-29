import { describe, it, expect } from 'vitest';
import { filenameChecks } from './filename-check';
import { parseTitleMetadata } from './title-metadata';

const checks = (file: string, detected?: Parameters<typeof filenameChecks>[1]) =>
  filenameChecks(parseTitleMetadata(file), detected);

describe('filenameChecks', () => {
  it('clear name that agrees with analysis: nothing to ask', () => {
    expect(checks('Night Shift 140 Fm.wav', { bpm: 140, key: 'F', scale: 'minor' })).toEqual([]);
  });

  it('empty name: nothing to ask', () => {
    expect(checks('Deep Cuts.wav', { bpm: 120, key: 'C', scale: 'major' })).toEqual([]);
    expect(checks('Deep Cuts.wav')).toEqual([]);
  });

  it('ambiguous tempo: offers every candidate and marks the one analysis backs', () => {
    const [c] = checks('beat 90 140.wav', { bpm: 139.7 });
    expect(c.id).toBe('bpm-choice');
    expect(c.message).toBe('Filename gives BPM 90 or 140 — not applied; analysis heard 140');
    expect(c.options.map((o) => [o.label, o.backedByAnalysis, o.patch])).toEqual([
      ['90', false, { bpm: 90 }],
      ['140', true, { bpm: 140 }],
    ]);
  });

  it('ambiguous tempo with no analysis points at the track details', () => {
    const [c] = checks('beat 90 140.wav', null);
    expect(c.message).toBe('Filename gives BPM 90 or 140 — not applied; set it in the track details');
    expect(c.options.every((o) => !o.backedByAnalysis)).toBe(true);
  });

  it('ambiguous key: patches in the canonical spelling', () => {
    const [c] = checks('beat Bbm Fm.wav', { key: 'A#', scale: 'minor' });
    expect(c.id).toBe('key-choice');
    expect(c.options.map((o) => [o.label, o.backedByAnalysis, o.patch])).toEqual([
      ['Bb minor', true, { key: 'A#', scale: 'minor' }],
      ['F minor', false, { key: 'F', scale: 'minor' }],
    ]);
  });

  it('a word that might be a key is offered, not applied', () => {
    const [c] = checks('BB gun.wav', { key: 'D', scale: 'major' });
    expect(c.message).toBe('Filename gives key Bb — not applied; analysis heard D major');
    // No scale was written, so none is invented for the patch.
    expect(c.options[0].patch).toEqual({ key: 'A#', scale: null });
  });

  it('conflict: says what was kept and offers the analysed value', () => {
    const out = checks('Night Shift 140 Fm.wav', {
      bpm: 97, key: 'D', scale: 'major', bpmConfidence: 3.9, keyStrength: 0.3,
    });
    expect(out.map((c) => c.message)).toEqual([
      'Filename says 140 BPM, analysis heard 97 (confident) — kept 140',
      'Filename says F minor, analysis heard D major (low confidence) — kept F minor',
    ]);
    expect(out.map((c) => c.options[0])).toEqual([
      { label: 'Use 97', ariaLabel: 'Set BPM to 97, as analysed', patch: { bpm: 97 }, backedByAnalysis: true },
      { label: 'Use D major', ariaLabel: 'Set key to D major, as analysed', patch: { key: 'D', scale: 'major' }, backedByAnalysis: true },
    ]);
  });

  it('half-time and relative-key readings are not raised', () => {
    expect(checks('Night Shift 140 Am.wav', { bpm: 70, key: 'C', scale: 'major' })).toEqual([]);
  });
});
