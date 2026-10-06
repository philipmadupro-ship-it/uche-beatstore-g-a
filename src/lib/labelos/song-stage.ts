/**
 * The A&R stage of a song (04 W3), stored on `tracks.song_stage` (mig 140,
 * 17 R1: a song is a `tracks` row with `type = 'song'`).
 *
 * This file holds the list, the starting value and (LABEL-24) the transition
 * rules: which stage a song may move to, and who may move it. The route and
 * the stage Dropdown both read it, so the menu cannot offer a move the route
 * refuses.
 *
 * `released` is not here on purpose: whether a song is released is a fact
 * about the release it sits on, so it is derived, never stored (04 W3).
 * `changes_requested` is a review verdict, not a stage.
 */

import { countsAsOnRelease } from './releases';
import type { Capability, Role } from './capabilities';

/** Same order and values as `tracks_song_stage_check` (song-stage.test.ts holds them equal). */
export const SONG_STAGES = [
  'inbox',
  'in_review',
  'shortlisted',
  'in_development',
  'selected',
  'on_hold',
  'passed',
  'archived',
] as const;
export type SongStage = (typeof SONG_STAGES)[number];

/** Display names, in stage order. */
export const SONG_STAGE_LABEL: Record<SongStage, string> = {
  inbox: 'Inbox',
  in_review: 'In review',
  shortlisted: 'Shortlisted',
  in_development: 'In development',
  selected: 'Selected',
  on_hold: 'On hold',
  passed: 'Passed',
  archived: 'Archived',
};

export function isSongStage(v: unknown): v is SongStage {
  return typeof v === 'string' && (SONG_STAGES as readonly string[]).includes(v);
}

/**
 * The stage a new track starts with: `inbox` for an org song, null otherwise.
 * A producer's own song (no org) never gets a stage, so the producer library
 * reads exactly as before. The column has no database default for the same
 * reason — the app sets it, only for org songs.
 */
export function initialSongStage(track: { type: string | null; orgId?: string | null }): SongStage | null {
  return track.type === 'song' && track.orgId ? 'inbox' : null;
}

// ── Transitions (LABEL-24, 04 W3) ───────────────────────────────────────

/**
 * Where a song may go from each stage. 04 W3's diagram, as data:
 *
 *   inbox → in_review → shortlisted → in_development → selected
 *   inbox | in_review | shortlisted | in_development → passed
 *   in_review | shortlisted | in_development → on_hold
 *   any → archived
 *
 * `selected` is chosen for a release, so it leaves only by archiving. The
 * diagram does not draw a way back out of `on_hold`, `passed` or `archived`,
 * but 04 says passed demos "are regularly revisited"; an exit nobody can
 * leave would strand them, so each reopens into `in_review` (the stage a
 * heard-again song belongs in). That is the one reading beyond the diagram.
 */
export const STAGE_TRANSITIONS: Readonly<Record<SongStage, readonly SongStage[]>> = {
  inbox: ['in_review', 'passed', 'archived'],
  in_review: ['shortlisted', 'passed', 'on_hold', 'archived'],
  shortlisted: ['in_development', 'passed', 'on_hold', 'archived'],
  in_development: ['selected', 'passed', 'on_hold', 'archived'],
  selected: ['archived'],
  on_hold: ['in_review', 'archived'],
  passed: ['in_review', 'archived'],
  archived: ['in_review'],
};

/** What a roster artist (role `artist`) may do to their own songs (06 §2.4, LABEL-24): hand a demo over for review. */
const ARTIST_MOVES: Readonly<Partial<Record<SongStage, readonly SongStage[]>>> = {
  inbox: ['in_review'],
};

/** Who is moving the song. `role` is optional so a caller with only capabilities still gets the table. */
export type StageActor = { caps: ReadonlySet<Capability>; role?: Role | string | null };

/**
 * The stages `stage` may move to for this member: nothing without
 * `catalog.write`; for a roster artist only `inbox → in_review`; otherwise the
 * table. Order is the table's, so a menu reads in pipeline order.
 */
export function allowedTransitions(stage: SongStage, caps: ReadonlySet<Capability>, role?: Role | string | null): SongStage[] {
  if (!isSongStage(stage) || !caps.has('catalog.write')) return [];
  const table = role === 'artist' ? ARTIST_MOVES : STAGE_TRANSITIONS;
  return [...(table[stage] ?? [])];
}

export type TransitionResult =
  | { ok: true; from: SongStage; to: SongStage }
  | { ok: false; reason: 'not_a_song' | 'unknown_stage' | 'same' | 'forbidden' | 'illegal'; message: string };

const refuse = (reason: Extract<TransitionResult, { ok: false }>['reason'], message: string): TransitionResult => ({ ok: false, reason, message });

/**
 * Judge one move. Without `who` only the table is checked (callers that have
 * already authorised); with it the member's capabilities and role apply too.
 * `forbidden` is "may not move songs at all" (403 in the route); everything
 * else that fails is a conflict with the song's state (409).
 */
export function transition(
  song: { type: string | null; stage: string | null },
  to: string,
  who?: StageActor,
): TransitionResult {
  if (song.type !== 'song' || !isSongStage(song.stage)) return refuse('not_a_song', 'Only a song with a stage has a stage to move');
  if (!isSongStage(to)) return refuse('unknown_stage', `“${to}” is not a song stage`);
  const from = song.stage;
  if (from === to) return refuse('same', `The song is already ${SONG_STAGE_LABEL[from]}`);
  if (who && !who.caps.has('catalog.write')) return refuse('forbidden', 'You cannot move songs');
  const allowed = who ? allowedTransitions(from, who.caps, who.role) : [...STAGE_TRANSITIONS[from]];
  if (!allowed.includes(to)) {
    const why = who?.role === 'artist' && STAGE_TRANSITIONS[from].includes(to) ? ' (you can only hand a demo in from Inbox to In review)' : '';
    return refuse('illegal', `A song cannot move from ${SONG_STAGE_LABEL[from]} to ${SONG_STAGE_LABEL[to]}${why}`);
  }
  return { ok: true, from, to };
}

/**
 * Is the song released? Derived from its release items, never stored (04 W3):
 * the same rule the audio classifier uses for "on a release"
 * (`countsAsOnRelease`; the SQL twin is 144's `labelos_track_is_finished`), so
 * the two cannot disagree. `releases` are the song's release_items with their
 * release's state embedded.
 */
export function isReleased(_song: { stage?: string | null }, releases: ReadonlyArray<{ releases: { state: string } | null }>): boolean {
  return countsAsOnRelease(releases);
}
