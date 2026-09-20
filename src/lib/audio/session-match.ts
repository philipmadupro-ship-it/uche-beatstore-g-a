/**
 * Does this track fit the session I am working in?
 *
 * A producer auditioning a catalogue is not asking "what is this beat's key",
 * they are asking "does it go with the thing already open in my DAW". That
 * makes the session's tempo and key a piece of app state every row is read
 * against, rather than a filter you set and forget.
 *
 * Three questions, kept pure and separate:
 *
 *   - `keyFit`   — same key, its relative major/minor, or one step round the
 *                  Camelot wheel.
 *   - `tempoFit` — same tempo, or half/double of it, which a DAW treats as the
 *                  same tempo and a producer hears that way too.
 *   - `previewAdjustment` — what to do to the audio so the preview actually
 *                  sounds like it would in the session.
 *
 * Key comparison goes through `lib/audio/key-normalize`, so a track stored as
 * `Bb` matches a session in `A#`. Wheel adjacency reuses the Camelot table in
 * `lib/audio/harmonic.ts` rather than starting a second one.
 */

import { camelotOf, harmonicDistance } from './harmonic';
import {
  normalizeKey,
  relativeKey,
  type CanonicalKey,
  type Scale,
} from './key-normalize';

/** The tempo and key of whatever the producer currently has open. */
export interface SessionContext {
  bpm: number | null;
  key: CanonicalKey | null;
  scale: Scale | null;
}

/** Anything with the three columns this reads. */
export interface MatchableTrack {
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

/**
 * How a track's key relates to the session's, best first.
 *
 * `relative` and `neighbour` are both a Camelot distance of 1, so they cannot
 * be told apart by `harmonicDistance` alone — the relative case is checked
 * first here and the wheel is only consulted afterwards.
 */
export type KeyFit = 'same' | 'relative' | 'neighbour';

/** How a track's tempo relates to the session's. */
export type TempoFit = 'same' | 'half' | 'double';

/** Default window for calling two tempos the same, in BPM. */
export const DEFAULT_TEMPO_TOLERANCE = 2;

export const MIN_SESSION_BPM = 20;
export const MAX_SESSION_BPM = 300;

export const clampSessionBpm = (x: number) =>
  Math.round(Math.min(Math.max(x, MIN_SESSION_BPM), MAX_SESSION_BPM));

/** Whether the session says anything worth matching against. */
export function hasSession(session: SessionContext): boolean {
  return session.bpm != null || session.key != null;
}

export function keyFit(session: SessionContext, track: MatchableTrack): KeyFit | null {
  if (session.key == null) return null;
  const t = normalizeKey(track.key, track.scale);
  if (t.key == null) return null;

  if (t.key === session.key) {
    // With no mode on one side or the other, the tonic is all there is to
    // compare — which is still a real match, not a guess.
    if (session.scale == null || t.scale == null || t.scale === session.scale) return 'same';
  }

  if (session.scale != null && t.scale != null) {
    const rel = relativeKey(session.key, session.scale);
    if (t.key === rel.key && t.scale === rel.scale) return 'relative';
  }

  // One step round the wheel — the next-best transition a DJ or producer
  // reaches for. Needs a mode on both sides, since the Camelot table is keyed
  // by `<tonic> <mode>` and has no entry for a bare tonic.
  if (session.scale != null && t.scale != null) {
    const a = camelotOf({ id: 's', key: session.key, scale: session.scale });
    const b = camelotOf({ id: 't', key: t.key, scale: t.scale });
    if (a && b && harmonicDistance(a, b) === 1) return 'neighbour';
  }

  return null;
}

export function tempoFit(
  session: SessionContext,
  track: MatchableTrack,
  tolerance: number = DEFAULT_TEMPO_TOLERANCE,
): TempoFit | null {
  if (session.bpm == null || track.bpm == null || track.bpm <= 0) return null;
  const near = (x: number) => Math.abs(track.bpm! - x) <= tolerance;

  if (near(session.bpm)) return 'same';
  if (near(session.bpm / 2)) return 'half';
  if (near(session.bpm * 2)) return 'double';
  return null;
}

/**
 * How a track's preview is adjusted to sit in the session's tempo.
 *
 * Only tempo. splicedd, the sample browser this is adapted from, also
 * repitches one-shots to the session key the way a sampler would — correct
 * there, where a row may be a single drum hit or a vocal chop. Every track
 * here is a finished arrangement, and varispeeding a whole beat up a tritone
 * is not something a DAW would do to it, so that branch is deliberately not
 * ported rather than ported and hidden behind a flag.
 */
export interface PreviewAdjustment {
  /** Assign to `HTMLAudioElement.playbackRate`. */
  rate: number;
  /**
   * Assign to `preservesPitch` (and the vendor-prefixed spellings). Always
   * true here, since this is a time-stretch. Loading a new source resets both
   * `playbackRate` and `preservesPitch`, so set them together, after the src.
   */
  preservesPitch: true;
  /** Short badge text, e.g. `140 BPM` or `140 BPM · ½×`. */
  label: string;
  /** A full sentence, for a tooltip and for screen readers. */
  description: string;
}

/**
 * How far a tempo is stretched before folding to half- or double-time instead.
 *
 * √2 is the geometric middle of one octave of tempo: at that ratio, stretching
 * up by `r` and stretching down by `2/r` are equally severe, so the nearest
 * octave-equivalent tempo is never ambiguous. Past it a DAW would switch to
 * half- or double-time, which is both more musical and avoids the artifacts of
 * stretching audio a long way.
 */
const MAX_STRETCH = Math.SQRT2;

/** Below this the adjustment is inaudible and only clutters the row. */
const RATE_DEADBAND = 0.005;

export function previewAdjustment(
  session: SessionContext,
  track: MatchableTrack,
): PreviewAdjustment | null {
  if (session.bpm == null || track.bpm == null || track.bpm <= 0) return null;

  let target = session.bpm;
  let feel: 'half-time' | 'double-time' | null = null;
  while (target / track.bpm > MAX_STRETCH) {
    target /= 2;
    feel = 'half-time';
  }
  while (target / track.bpm < 1 / MAX_STRETCH) {
    target *= 2;
    feel = 'double-time';
  }

  const rate = target / track.bpm;
  if (Math.abs(rate - 1) < RATE_DEADBAND) return null;

  const bpm = Math.round(target * 10) / 10;
  const feelLabel = feel === 'half-time' ? '½×' : '2×';
  return {
    rate,
    preservesPitch: true,
    label: `${bpm} BPM${feel ? ` · ${feelLabel}` : ''}`,
    description: `Playing at ${bpm} BPM${
      feel ? ` (${feel} of your session)` : ''
    }, originally ${track.bpm} BPM`,
  };
}

/** `140 BPM · F minor`, or an empty string when the session is unset. */
export function describeSession(session: SessionContext): string {
  const key = session.key
    ? `${session.key}${session.scale ? ` ${session.scale}` : ''}`
    : '';
  return [session.bpm != null ? `${session.bpm} BPM` : '', key]
    .filter((x) => x !== '')
    .join(' · ');
}
