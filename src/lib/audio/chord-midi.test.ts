import { describe, expect, it } from 'vitest';
import {
  chordMidiFilename,
  chordToPitches,
  chordsToMidiNotes,
  encodeVarLen,
  formatChordTime,
  hasPlayableChords,
  writeMidiFile,
} from './chord-midi';

/** Minimal SMF reader — enough to prove the bytes say what we meant. */
function parseMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
  expect(str(0, 4)).toBe('MThd');
  const header = {
    length: view.getUint32(4),
    format: view.getUint16(8),
    tracks: view.getUint16(10),
    ppq: view.getUint16(12),
  };
  expect(str(14, 4)).toBe('MTrk');
  const trackLength = view.getUint32(18);
  const start = 22;
  const end = start + trackLength;

  let p = start;
  const readVar = () => {
    let v = 0;
    for (;;) {
      const b = bytes[p++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };
  let tick = 0;
  let tempoUs: number | null = null;
  let endOfTrack = false;
  const events: Array<{ tick: number; delta: number; type: 'on' | 'off'; pitch: number; velocity: number }> = [];
  while (p < end) {
    const delta = readVar();
    tick += delta;
    const status = bytes[p++];
    if (status === 0xff) {
      const type = bytes[p++];
      const len = readVar();
      if (type === 0x51) tempoUs = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
      if (type === 0x2f) endOfTrack = true;
      p += len;
    } else {
      const pitch = bytes[p++];
      const velocity = bytes[p++];
      events.push({ tick, delta, type: (status & 0xf0) === 0x90 ? 'on' : 'off', pitch, velocity });
    }
  }
  return { header, trackLength, totalLength: bytes.length, end, tempoUs, endOfTrack, events };
}

describe('chordToPitches', () => {
  it('voices major and minor triads around middle C', () => {
    expect(chordToPitches('C')).toEqual([60, 64, 67]);
    expect(chordToPitches('Am')).toEqual([57, 60, 64]);
    expect(chordToPitches('F')).toEqual([65, 69, 72]);
    expect(chordToPitches('G')).toEqual([55, 59, 62]);
    expect(chordToPitches('F#m')).toEqual([66, 69, 73]);
    expect(chordToPitches('G#')).toEqual([56, 60, 63]);
    expect(chordToPitches('Bb')).toEqual(chordToPitches('A#'));
  });

  it('treats N and garbage as rests', () => {
    expect(chordToPitches('N')).toBeNull();
    expect(chordToPitches('')).toBeNull();
    expect(chordToPitches('Hm')).toBeNull();
    expect(chordToPitches('Cdim7')).toBeNull();
  });
});

describe('chordsToMidiNotes', () => {
  it('ends each chord at the next and the last at the track duration', () => {
    const notes = chordsToMidiNotes([{ time: 0, chord: 'C' }, { time: 2, chord: 'N' }, { time: 3, chord: 'Am' }], {
      durationSeconds: 5,
      bpm: 120,
    });
    expect(notes).toHaveLength(6);
    expect(notes.slice(0, 3).every((n) => n.startSeconds === 0 && n.endSeconds === 2)).toBe(true);
    expect(notes.slice(3).every((n) => n.startSeconds === 3 && n.endSeconds === 5)).toBe(true);
  });

  it('gives the last chord one bar when the duration is unknown', () => {
    const notes = chordsToMidiNotes([{ time: 10, chord: 'C' }], { bpm: 120 });
    expect(notes.every((n) => n.endSeconds === 12)).toBe(true);
  });

  it('returns nothing for empty or all-N input', () => {
    expect(chordsToMidiNotes([], { durationSeconds: 10 })).toEqual([]);
    expect(chordsToMidiNotes([{ time: 0, chord: 'N' }, { time: 4, chord: 'N' }], { durationSeconds: 10 })).toEqual([]);
  });
});

describe('encodeVarLen', () => {
  it('matches the SMF spec examples', () => {
    expect(encodeVarLen(0)).toEqual([0x00]);
    expect(encodeVarLen(0x40)).toEqual([0x40]);
    expect(encodeVarLen(0x7f)).toEqual([0x7f]);
    expect(encodeVarLen(0x80)).toEqual([0x81, 0x00]);
    expect(encodeVarLen(0x2000)).toEqual([0xc0, 0x00]);
    expect(encodeVarLen(0x3fff)).toEqual([0xff, 0x7f]);
    expect(encodeVarLen(0x100000)).toEqual([0xc0, 0x80, 0x00]);
    expect(encodeVarLen(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });
});

describe('writeMidiFile', () => {
  it('writes a valid header, track length, tempo and end-of-track', () => {
    const bytes = writeMidiFile([], { bpm: 140, ppq: 480 });
    const midi = parseMidi(bytes);
    expect(midi.header).toEqual({ length: 6, format: 0, tracks: 1, ppq: 480 });
    expect(midi.end).toBe(midi.totalLength);
    expect(midi.tempoUs).toBe(Math.round(60_000_000 / 140));
    expect(midi.endOfTrack).toBe(true);
    expect(midi.events).toEqual([]);
    // Literal header bytes.
    expect(Array.from(bytes.slice(0, 14))).toEqual([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    ]);
    // Tempo event bytes: delta 0, FF 51 03, 428571 µs = 0x068A1B.
    const tempoAt = Array.from(bytes).findIndex((b, i) => b === 0xff && bytes[i + 1] === 0x51);
    expect(Array.from(bytes.slice(tempoAt, tempoAt + 6))).toEqual([0xff, 0x51, 0x03, 0x06, 0x8a, 0x1b]);
    // Last four bytes are end-of-track.
    expect(Array.from(bytes.slice(-4))).toEqual([0x00, 0xff, 0x2f, 0x00]);
  });

  it('falls back to 120 BPM', () => {
    expect(parseMidi(writeMidiFile([], { bpm: null })).tempoUs).toBe(500_000);
    expect(parseMidi(writeMidiFile([], { bpm: Number.NaN })).tempoUs).toBe(500_000);
  });

  it('writes one chord as three note-on/off pairs with correct deltas', () => {
    // 2 s at 120 BPM = 4 beats = 1920 ticks at 480 ppq.
    const notes = chordsToMidiNotes([{ time: 0.5, chord: 'C' }], { durationSeconds: 2.5, bpm: 120 });
    const midi = parseMidi(writeMidiFile(notes, { bpm: 120, ppq: 480 }));
    expect(midi.events).toEqual([
      { tick: 480, delta: 480, type: 'on', pitch: 60, velocity: 90 },
      { tick: 480, delta: 0, type: 'on', pitch: 64, velocity: 90 },
      { tick: 480, delta: 0, type: 'on', pitch: 67, velocity: 90 },
      { tick: 2400, delta: 1920, type: 'off', pitch: 60, velocity: 0 },
      { tick: 2400, delta: 0, type: 'off', pitch: 64, velocity: 0 },
      { tick: 2400, delta: 0, type: 'off', pitch: 67, velocity: 0 },
    ]);
  });

  it('round-trips C–Am–F–G at the track tempo', () => {
    const bpm = 90; // one beat = 2/3 s
    const beat = 60 / bpm;
    const segments = [
      { time: 0, chord: 'C' },
      { time: 4 * beat, chord: 'Am' },
      { time: 8 * beat, chord: 'F' },
      { time: 12 * beat, chord: 'G' },
    ];
    const notes = chordsToMidiNotes(segments, { durationSeconds: 16 * beat, bpm });
    const midi = parseMidi(writeMidiFile(notes, { bpm, ppq: 96 }));
    expect(midi.tempoUs).toBe(666_667);

    // Rebuild the chord timeline from note-ons, grouped by tick.
    const ons = midi.events.filter((e) => e.type === 'on');
    const byTick = new Map<number, number[]>();
    for (const e of ons) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.pitch]);
    expect([...byTick.entries()]).toEqual([
      [0, [60, 64, 67]],
      [384, [57, 60, 64]],
      [768, [65, 69, 72]],
      [1152, [55, 59, 62]],
    ]);

    // Every note is released exactly when the next chord starts; the shared C
    // (C → Am) is released BEFORE it is struck again at tick 384.
    const at384 = midi.events.filter((e) => e.tick === 384);
    expect(at384.slice(0, 3).every((e) => e.type === 'off')).toBe(true);
    expect(at384.slice(3).every((e) => e.type === 'on')).toBe(true);
    const lastOff = midi.events[midi.events.length - 1];
    expect(lastOff).toMatchObject({ type: 'off', tick: 1536 });

    // Balanced pairs.
    expect(ons).toHaveLength(12);
    expect(midi.events.filter((e) => e.type === 'off')).toHaveLength(12);
  });
});

describe('helpers', () => {
  it('sanitises the filename', () => {
    expect(chordMidiFilename('Night Shift')).toBe('Night Shift - chords.mid');
    expect(chordMidiFilename('a/b:c*?"<>|d')).toBe('a b c d - chords.mid');
    expect(chordMidiFilename('  ..  ')).toBe('Track - chords.mid');
    expect(chordMidiFilename(null)).toBe('Track - chords.mid');
  });

  it('knows when there is anything to export', () => {
    expect(hasPlayableChords([])).toBe(false);
    expect(hasPlayableChords([{ time: 0, chord: 'N' }])).toBe(false);
    expect(hasPlayableChords([{ time: 0, chord: 'N' }, { time: 1, chord: 'Em' }])).toBe(true);
  });

  it('formats times', () => {
    expect(formatChordTime(0)).toBe('0:00');
    expect(formatChordTime(65.9)).toBe('1:05');
  });
});
