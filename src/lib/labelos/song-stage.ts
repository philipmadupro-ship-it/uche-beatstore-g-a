/**
 * The A&R stage of a song (04 W3), stored on `tracks.song_stage` (mig 140,
 * 17 R1: a song is a `tracks` row with `type = 'song'`).
 *
 * This file holds only the list and the starting value. Transitions — who may
 * move a song where — are LABEL-24 and extend this module.
 *
 * `released` is not here on purpose: whether a song is released is a fact
 * about the release it sits on, so it is derived, never stored (04 W3).
 * `changes_requested` is a review verdict, not a stage.
 */

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
