import { describe, expect, it } from 'vitest';

import {
  canonicalKeyLabel,
  normalizeKey,
  normalizeScale,
  relativeKey,
  sameKey,
} from './key-normalize';

describe('normalizeKey', () => {
  it('collapses flats onto the sharp spelling', () => {
    expect(normalizeKey('Bb').key).toBe('A#');
    expect(normalizeKey('Eb').key).toBe('D#');
    expect(normalizeKey('Db').key).toBe('C#');
    expect(normalizeKey('Gb').key).toBe('F#');
  });

  it('leaves sharps and naturals alone', () => {
    expect(normalizeKey('F#').key).toBe('F#');
    expect(normalizeKey('C').key).toBe('C');
  });

  it('wraps Cb and B# round the octave rather than going out of range', () => {
    expect(normalizeKey('Cb').key).toBe('B');
    expect(normalizeKey('B#').key).toBe('C');
  });

  it('accepts unicode accidentals and spelled-out ones', () => {
    expect(normalizeKey('E♭').key).toBe('D#');
    expect(normalizeKey('A♯').key).toBe('A#');
    expect(normalizeKey('A flat').key).toBe('G#');
    expect(normalizeKey('f sharp').key).toBe('F#');
  });

  it('tolerates miscasing and padding', () => {
    expect(normalizeKey('  bb  ').key).toBe('A#');
    expect(normalizeKey('g').key).toBe('G');
  });

  it('reads a scale glued onto the key string', () => {
    expect(normalizeKey('F#m')).toEqual({ key: 'F#', scale: 'minor' });
    expect(normalizeKey('Bb minor')).toEqual({ key: 'A#', scale: 'minor' });
    expect(normalizeKey('C maj')).toEqual({ key: 'C', scale: 'major' });
    expect(normalizeKey('G Major')).toEqual({ key: 'G', scale: 'major' });
  });

  it('takes the scale from the column when the key string does not name one', () => {
    expect(normalizeKey('F', 'minor')).toEqual({ key: 'F', scale: 'minor' });
    expect(normalizeKey('F', 'Min')).toEqual({ key: 'F', scale: 'minor' });
  });

  it('lets the key string outrank the scale column when both speak', () => {
    // The key string is the more specific statement about this row.
    expect(normalizeKey('F#m', 'major').scale).toBe('minor');
  });

  it('reads a single trailing letter by chord-symbol case convention', () => {
    // Unlike the filename parser, which must not turn `FM radio.wav` into F
    // minor, this reads a field whose only job is to name a key.
    expect(normalizeKey('Fm').scale).toBe('minor');
    expect(normalizeKey('fm').scale).toBe('minor');
    expect(normalizeKey('FM').scale).toBe('major');
    expect(normalizeKey('CM')).toEqual({ key: 'C', scale: 'major' });
  });

  it('returns a null key rather than guessing at unparseable input', () => {
    expect(normalizeKey('H').key).toBe(null);
    expect(normalizeKey('').key).toBe(null);
    expect(normalizeKey(null).key).toBe(null);
    expect(normalizeKey('untitled').key).toBe(null);
  });

  it('keeps the scale column even when the key is unreadable', () => {
    expect(normalizeKey(null, 'minor')).toEqual({ key: null, scale: 'minor' });
  });
});

describe('normalizeScale', () => {
  it('reads the spellings the three producers emit', () => {
    expect(normalizeScale('minor')).toBe('minor');
    expect(normalizeScale('Min')).toBe('minor');
    expect(normalizeScale('m')).toBe('minor');
    expect(normalizeScale('MAJOR')).toBe('major');
    expect(normalizeScale('maj')).toBe('major');
  });

  it('maps the two modal names Essentia can emit', () => {
    expect(normalizeScale('aeolian')).toBe('minor');
    expect(normalizeScale('ionian')).toBe('major');
  });

  it('is null for anything it does not recognise', () => {
    expect(normalizeScale('dorian')).toBe(null);
    expect(normalizeScale('')).toBe(null);
    expect(normalizeScale(null)).toBe(null);
  });
});

describe('sameKey', () => {
  it('matches across enharmonic spellings — the bug this module exists for', () => {
    expect(sameKey({ key: 'Bb', scale: 'minor' }, { key: 'A#', scale: 'minor' })).toBe(true);
  });

  it('does not match a different mode of the same tonic', () => {
    expect(sameKey({ key: 'A#', scale: 'minor' }, { key: 'A#', scale: 'major' })).toBe(false);
  });

  it('matches either mode when one side never recorded one', () => {
    expect(sameKey({ key: 'F' }, { key: 'F', scale: 'minor' })).toBe(true);
    expect(sameKey({ key: 'F' }, { key: 'F', scale: 'major' })).toBe(true);
  });

  it('is false when either side has no readable key', () => {
    expect(sameKey({ key: null }, { key: 'C' })).toBe(false);
    expect(sameKey({ key: 'nonsense' }, { key: 'C' })).toBe(false);
  });
});

describe('canonicalKeyLabel', () => {
  it('produces the label the Camelot table is keyed by', () => {
    expect(canonicalKeyLabel('Bb', 'minor')).toBe('A# minor');
    expect(canonicalKeyLabel('F#m')).toBe('F# minor');
  });

  it('spells out the major default rather than leaving it to the lookup', () => {
    expect(canonicalKeyLabel('C')).toBe('C major');
  });

  it('is null when there is no key to name', () => {
    expect(canonicalKeyLabel(null)).toBe(null);
    expect(canonicalKeyLabel('nope')).toBe(null);
  });
});

describe('relativeKey', () => {
  it('moves a minor key up a minor third', () => {
    expect(relativeKey('A', 'minor')).toEqual({ key: 'C', scale: 'major' });
    expect(relativeKey('F', 'minor')).toEqual({ key: 'G#', scale: 'major' });
  });

  it('moves a major key down a minor third', () => {
    expect(relativeKey('C', 'major')).toEqual({ key: 'A', scale: 'minor' });
  });

  it('wraps round the octave without a negative index', () => {
    expect(relativeKey('B', 'minor')).toEqual({ key: 'D', scale: 'major' });
    expect(relativeKey('C', 'minor')).toEqual({ key: 'D#', scale: 'major' });
  });

  it('round-trips', () => {
    const there = relativeKey('F#', 'minor');
    expect(relativeKey(there.key, there.scale)).toEqual({ key: 'F#', scale: 'minor' });
  });
});
