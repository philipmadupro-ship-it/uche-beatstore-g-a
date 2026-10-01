/**
 * A song built on several beats (mig 132).
 *
 * `song_beats` holds the ordered list; `tracks.beat_track_id` stays the MAIN
 * beat (position 0), because the portal, the workspace and search already
 * read it. These helpers are the one place that keeps the two in step:
 *   - every read goes through `orderedBeatIds`, which puts the main beat first
 *     and falls back to it alone when the join table is missing or empty;
 *   - every write produces the full ordered list, from which the main beat is
 *     simply the first entry.
 */

export interface SongBeatRow {
  song_track_id: string;
  beat_track_id: string;
  position: number;
}

/** The beats of one song, main first, no duplicates. */
export function orderedBeatIds(rows: ReadonlyArray<Pick<SongBeatRow, 'beat_track_id' | 'position'>>, mainBeatId: string | null): string[] {
  const sorted = [...rows].sort((a, b) => a.position - b.position).map((r) => r.beat_track_id);
  const list = mainBeatId ? [mainBeatId, ...sorted] : sorted;
  return [...new Set(list)];
}

/** Every song's beats, keyed by song, for batch reads. */
export function beatsBySong(
  rows: readonly SongBeatRow[],
  songs: ReadonlyArray<{ id: string; beat_track_id: string | null }>,
): Map<string, string[]> {
  const bySong = new Map<string, SongBeatRow[]>();
  for (const r of rows) bySong.set(r.song_track_id, [...(bySong.get(r.song_track_id) ?? []), r]);
  return new Map(songs.map((s) => [s.id, orderedBeatIds(bySong.get(s.id) ?? [], s.beat_track_id)]));
}

/**
 * The list after the main beat changes through the old single-beat control
 * (`PATCH /api/tracks/[id] { beat_track_id }`): the new main goes first, the
 * old main leaves, every other beat stays where it was. Null clears the main
 * and promotes nobody — clearing "Built on" means the song has no main beat.
 */
export function replaceMainBeat(ordered: readonly string[], oldMain: string | null, newMain: string | null): string[] {
  const rest = ordered.filter((id) => id !== oldMain && id !== newMain);
  return newMain ? [newMain, ...rest] : [];
}

/** Rows to write for an ordered list (positions 0…n-1). A song never lists itself. */
export function songBeatRows(songId: string, userId: string, ordered: readonly string[]) {
  return [...new Set(ordered)]
    .filter((id) => id !== songId)
    .map((beatId, position) => ({ song_track_id: songId, beat_track_id: beatId, user_id: userId, position }));
}
