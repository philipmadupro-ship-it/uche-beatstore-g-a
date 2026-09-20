import { describe, expect, it } from 'vitest';

import {
  clampSessionBpm,
  describeSession,
  hasSession,
  keyFit,
  previewAdjustment,
  tempoFit,
  type SessionContext,
} from './session-match';

const session = (over: Partial<SessionContext> = {}): SessionContext => ({
  bpm: 140,
  key: 'F',
  scale: 'minor',
  ...over,
});

describe('keyFit', () => {
  it('matches the same key', () => {
    expect(keyFit(session(), { key: 'F', scale: 'minor' })).toBe('same');
  });

  it('matches across enharmonic spellings', () => {
    // The whole reason key comparison goes through the normaliser.
    expect(keyFit(session({ key: 'A#' }), { key: 'Bb', scale: 'minor' })).toBe('same');
  });

  it('matches the relative major', () => {
    // F minor's relative is G# major.
    expect(keyFit(session(), { key: 'G#', scale: 'major' })).toBe('relative');
  });

  it('matches a neighbour on the Camelot wheel', () => {
    // F minor is 4A; C minor is 5A, one step round.
    expect(keyFit(session(), { key: 'C', scale: 'minor' })).toBe('neighbour');
  });

  it('prefers the better label when a key qualifies two ways', () => {
    // Same key must never be reported as a neighbour.
    expect(keyFit(session(), { key: 'F', scale: 'minor' })).toBe('same');
  });

  it('is null for a key that is genuinely far away', () => {
    // F minor (4A) vs B major (1B) — different letter and number.
    expect(keyFit(session(), { key: 'B', scale: 'major' })).toBe(null);
  });

  it('compares tonics alone when either side has no mode', () => {
    expect(keyFit(session({ scale: null }), { key: 'F', scale: 'major' })).toBe('same');
    expect(keyFit(session(), { key: 'F' })).toBe('same');
  });

  it('will not claim a relative or neighbour without a mode on both sides', () => {
    // Relative and wheel adjacency are both undefined for a bare tonic.
    expect(keyFit(session(), { key: 'G#' })).toBe(null);
    expect(keyFit(session({ scale: null }), { key: 'C', scale: 'minor' })).toBe(null);
  });

  it('is null when either side has no readable key', () => {
    expect(keyFit(session({ key: null }), { key: 'F', scale: 'minor' })).toBe(null);
    expect(keyFit(session(), { key: null })).toBe(null);
    expect(keyFit(session(), { key: 'not a key' })).toBe(null);
  });
});

describe('tempoFit', () => {
  it('matches the same tempo', () => {
    expect(tempoFit(session(), { bpm: 140 })).toBe('same');
  });

  it('matches within the default tolerance either side', () => {
    expect(tempoFit(session(), { bpm: 138 })).toBe('same');
    expect(tempoFit(session(), { bpm: 142 })).toBe('same');
    expect(tempoFit(session(), { bpm: 143 })).toBe(null);
  });

  it('matches half and double time, which a DAW treats as the same tempo', () => {
    expect(tempoFit(session(), { bpm: 70 })).toBe('half');
    expect(tempoFit(session(), { bpm: 280 })).toBe('double');
  });

  it('honours a widened tolerance', () => {
    expect(tempoFit(session(), { bpm: 145 }, 6)).toBe('same');
  });

  it('is null for missing or nonsensical tempos', () => {
    expect(tempoFit(session({ bpm: null }), { bpm: 140 })).toBe(null);
    expect(tempoFit(session(), { bpm: null })).toBe(null);
    expect(tempoFit(session(), { bpm: 0 })).toBe(null);
  });
});

describe('previewAdjustment', () => {
  it('stretches a nearby tempo straight to the session', () => {
    const adj = previewAdjustment(session(), { bpm: 130 })!;
    expect(adj.rate).toBeCloseTo(140 / 130);
    expect(adj.preservesPitch).toBe(true);
    expect(adj.label).toBe('140 BPM');
  });

  it('is null when the track is already at the session tempo', () => {
    expect(previewAdjustment(session(), { bpm: 140 })).toBe(null);
  });

  it('ignores a change too small to hear', () => {
    // Inside the deadband: 140 / 139.6 is well under half a percent.
    expect(previewAdjustment(session(), { bpm: 139.6 })).toBe(null);
  });

  it('folds to half-time rather than stretching more than sqrt(2)', () => {
    // 140 from 70 would be a 2x stretch; play 70 at 70 instead.
    const adj = previewAdjustment(session(), { bpm: 72 })!;
    expect(adj.rate).toBeCloseTo(70 / 72);
    expect(adj.label).toBe('70 BPM · ½×');
    expect(adj.description).toContain('half-time');
  });

  it('folds to double-time at the other end', () => {
    const adj = previewAdjustment(session(), { bpm: 210 })!;
    expect(adj.rate).toBeCloseTo(280 / 210);
    expect(adj.label).toBe('280 BPM · 2×');
    expect(adj.description).toContain('double-time');
  });

  it('never stretches further than sqrt(2) in either direction', () => {
    for (let bpm = 20; bpm <= 300; bpm += 1) {
      const adj = previewAdjustment(session(), { bpm });
      if (!adj) continue;
      expect(adj.rate).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
      expect(adj.rate).toBeGreaterThanOrEqual(1 / Math.SQRT2 - 1e-9);
    }
  });

  it('always reports the tempo it actually plays at', () => {
    for (const bpm of [64, 75, 99, 140, 165, 190, 240]) {
      const adj = previewAdjustment(session(), { bpm });
      if (!adj) continue;
      const played = bpm * adj.rate;
      expect(adj.label.startsWith(`${Math.round(played * 10) / 10} BPM`)).toBe(true);
    }
  });

  it('is null without a tempo on both sides', () => {
    expect(previewAdjustment(session({ bpm: null }), { bpm: 120 })).toBe(null);
    expect(previewAdjustment(session(), { bpm: null })).toBe(null);
    expect(previewAdjustment(session(), { bpm: 0 })).toBe(null);
  });
});

describe('session helpers', () => {
  it('knows when a session says anything worth matching', () => {
    expect(hasSession({ bpm: null, key: null, scale: null })).toBe(false);
    expect(hasSession({ bpm: 140, key: null, scale: null })).toBe(true);
    expect(hasSession({ bpm: null, key: 'F', scale: null })).toBe(true);
  });

  it('describes a session for the UI', () => {
    expect(describeSession(session())).toBe('140 BPM · F minor');
    expect(describeSession(session({ key: null, scale: null }))).toBe('140 BPM');
    expect(describeSession(session({ bpm: null }))).toBe('F minor');
    expect(describeSession({ bpm: null, key: null, scale: null })).toBe('');
  });

  it('clamps a typed tempo into range', () => {
    expect(clampSessionBpm(140.4)).toBe(140);
    expect(clampSessionBpm(5)).toBe(20);
    expect(clampSessionBpm(9999)).toBe(300);
  });
});
