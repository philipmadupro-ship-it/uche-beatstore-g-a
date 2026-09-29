/**
 * Chord timeline → Standard MIDI File.
 *
 * Pure and dependency-free: `chordsToMidiNotes` turns the `{ time, chord }`
 * segments `detectChordsFromUrl` produces into timed notes, and
 * `writeMidiFile` serialises notes into SMF bytes (format 0, one track,
 * channel 1). No MIDI library is installed and this needs ~150 lines, so it
 * is written out rather than pulled in.
 *
 * Timing: notes are placed in seconds and converted to ticks at the TRACK's
 * tempo, and the file carries that tempo as its only tempo event. Dropped into
 * a DAW running at the track's BPM, bar 1 of the MIDI lines up with the start
 * of the audio and every chord change lands where the detector heard it.
 */

export interface ChordSegmentInput {
  time: number;
  chord: string;
}

export interface MidiNote {
  /** MIDI note number, 0–127. 60 = middle C. */
  pitch: number;
  startSeconds: number;
  endSeconds: number;
  /** 1–127. */
  velocity: number;
}

export const DEFAULT_MIDI_BPM = 120;
export const DEFAULT_MIDI_PPQ = 480;
const DEFAULT_VELOCITY = 90;
const MIDDLE_C = 60;

const NOTE_CLASS: Record<string, number> = {
  C: 0, 'B#': 0,
  'C#': 1, Db: 1,
  D: 2,
  'D#': 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, 'E#': 5,
  'F#': 6, Gb: 6,
  G: 7,
  'G#': 8, Ab: 8,
  A: 9,
  'A#': 10, Bb: 10,
  B: 11, Cb: 11,
};

/** A tempo the file can carry; anything else falls back to 120. */
export function resolveMidiBpm(bpm: number | null | undefined): number {
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= 20 && bpm <= 999
    ? bpm
    : DEFAULT_MIDI_BPM;
}

/**
 * Pitches for a chord label, or `null` for a rest. Accepts what the detector
 * emits (`C`, `F#`, `Am`, `G#m`) plus flats and `maj`/`min` spellings. `N` and
 * anything unrecognised are rests — a MIDI file with a wrong chord is worse
 * than one with a gap.
 *
 * Voicing: a root-position triad whose root sits between G3 (55) and F#4 (66),
 * so every chord stays within a sixth of middle C and adjacent chords don't
 * leap an octave.
 */
export function chordToPitches(label: string): number[] | null {
  const match = /^([A-G])([#b]?)(m|min|maj|M)?$/.exec(label.trim());
  if (!match) return null;
  const pc = NOTE_CLASS[`${match[1]}${match[2]}`];
  if (pc === undefined) return null;
  const minor = match[3] === 'm' || match[3] === 'min';
  const root = pc <= 6 ? MIDDLE_C + pc : MIDDLE_C + pc - 12;
  return [root, root + (minor ? 3 : 4), root + 7];
}

/**
 * Each segment runs until the next segment's `time`; the last one runs to
 * `durationSeconds` (or one 4/4 bar at `bpm` when the duration is unknown or
 * not after it). `N` segments are rests.
 */
export function chordsToMidiNotes(
  segments: readonly ChordSegmentInput[],
  { durationSeconds, bpm }: { durationSeconds?: number | null; bpm?: number | null } = {},
): MidiNote[] {
  const ordered = segments
    .filter((s) => s && typeof s.chord === 'string' && Number.isFinite(s.time))
    .map((s) => ({ time: Math.max(0, s.time), chord: s.chord }))
    .sort((a, b) => a.time - b.time);

  const barSeconds = (4 * 60) / resolveMidiBpm(bpm);
  const notes: MidiNote[] = [];

  ordered.forEach((seg, i) => {
    const next = ordered[i + 1];
    let end: number;
    if (next) end = next.time;
    else if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > seg.time) {
      end = durationSeconds;
    } else end = seg.time + barSeconds;
    if (end <= seg.time) return;

    const pitches = chordToPitches(seg.chord);
    if (!pitches) return;
    for (const pitch of pitches) {
      notes.push({ pitch, startSeconds: seg.time, endSeconds: end, velocity: DEFAULT_VELOCITY });
    }
  });

  return notes;
}

/** MIDI variable-length quantity. */
export function encodeVarLen(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
}

export function secondsToTicks(seconds: number, bpm: number, ppq: number): number {
  return Math.round((seconds * bpm * ppq) / 60);
}

/**
 * Serialise notes as a format-0 Standard MIDI File: tempo, 4/4 time
 * signature, then note-on / note-off pairs on channel 1 and end-of-track.
 * At a shared tick, note-offs are written before note-ons so a pitch shared
 * by two consecutive chords is released and re-struck rather than cut off.
 */
export function writeMidiFile(
  notes: readonly MidiNote[],
  { bpm, ppq = DEFAULT_MIDI_PPQ }: { bpm?: number | null; ppq?: number } = {},
): Uint8Array {
  const tempo = resolveMidiBpm(bpm);
  const division = Number.isInteger(ppq) && ppq > 0 && ppq < 0x8000 ? ppq : DEFAULT_MIDI_PPQ;
  const usPerQuarter = Math.min(0xffffff, Math.round(60_000_000 / tempo));

  type Ev = { tick: number; off: boolean; pitch: number; velocity: number };
  const events: Ev[] = [];
  for (const n of notes) {
    const pitch = Math.round(n.pitch);
    if (!Number.isFinite(pitch) || pitch < 0 || pitch > 127) continue;
    const start = secondsToTicks(Math.max(0, n.startSeconds), tempo, division);
    const end = secondsToTicks(Math.max(0, n.endSeconds), tempo, division);
    if (end <= start) continue;
    const velocity = Math.min(127, Math.max(1, Math.round(n.velocity)));
    events.push({ tick: start, off: false, pitch, velocity });
    events.push({ tick: end, off: true, pitch, velocity: 0 });
  }
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off) || a.pitch - b.pitch);

  const track: number[] = [
    // Track name.
    0x00, 0xff, 0x03, ...encodeVarLen(6), ...ascii('Chords'),
    // Tempo.
    0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff,
    // 4/4, 24 clocks per click, 8 thirty-seconds per quarter.
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
  ];
  let last = 0;
  for (const ev of events) {
    track.push(...encodeVarLen(ev.tick - last));
    last = ev.tick;
    track.push(ev.off ? 0x80 : 0x90, ev.pitch, ev.velocity);
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  return Uint8Array.from([
    ...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(division),
    ...ascii('MTrk'), ...u32(track.length), ...track,
  ]);
}

/** `Night Shift - chords.mid`, safe on every OS. */
export function chordMidiFilename(title: string | null | undefined): string {
  const base = (title ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120);
  return `${base || 'Track'} - chords.mid`;
}

/** Chords a MIDI file would actually sound — `N` and unknown labels excluded. */
export function hasPlayableChords(segments: readonly ChordSegmentInput[] | null | undefined): boolean {
  return Boolean(segments?.some((s) => chordToPitches(s.chord) !== null));
}

/** `1:05` */
export function formatChordTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
