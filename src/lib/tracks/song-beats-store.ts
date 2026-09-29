/**
 * Reads and writes for `song_beats` (mig 132) on the service-role client.
 * Owner-filtered everywhere; the table's trigger refuses another owner's
 * beat as well. Tolerant of the migration being missing: reads fall back to
 * `tracks.beat_track_id`, and a write of one beat still works through it.
 */

import { isMissingSchema } from '@/lib/artists/workspace-load';
import { selectIn } from '@/lib/db/chunked-in';
import { beatsBySong, orderedBeatIds, songBeatRows, type SongBeatRow } from './song-beats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export class SongBeatsNotReadyError extends Error {
  constructor() { super('Several beats per song need migration 132 applied on Supabase.'); }
}

export async function loadSongBeats(
  admin: Admin,
  userId: string,
  songs: ReadonlyArray<{ id: string; beat_track_id: string | null }>,
): Promise<Map<string, string[]>> {
  if (songs.length === 0) return new Map();
  let rows: SongBeatRow[] = [];
  try {
    rows = await selectIn<SongBeatRow>((ids) => admin.from('song_beats')
      .select('song_track_id, beat_track_id, position').in('song_track_id', ids).eq('user_id', userId), songs.map((s) => s.id));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
  }
  return beatsBySong(rows, songs);
}

/** Songs that list `beatId` anywhere (not only as their main beat). */
export async function songsBuiltOn(admin: Admin, userId: string, beatId: string): Promise<string[]> {
  const [main, joined] = await Promise.all([
    admin.from('tracks').select('id').eq('beat_track_id', beatId).eq('user_id', userId),
    admin.from('song_beats').select('song_track_id').eq('beat_track_id', beatId).eq('user_id', userId),
  ]);
  if (main.error) throw main.error;
  if (joined.error && !isMissingSchema(joined.error)) throw joined.error;
  return [...new Set([
    ...((main.data ?? []) as Array<{ id: string }>).map((r) => r.id),
    ...((joined.error ? [] : joined.data ?? []) as Array<{ song_track_id: string }>).map((r) => r.song_track_id),
  ])];
}

/**
 * Set a song's beats, main first. Writes `tracks.beat_track_id` (the main)
 * and replaces the song's `song_beats` rows. Throws SongBeatsNotReadyError
 * for more than one beat before mig 132.
 */
export async function writeSongBeats(admin: Admin, userId: string, songId: string, ordered: readonly string[]): Promise<string[]> {
  const rows = songBeatRows(songId, userId, ordered);
  const list = rows.map((r) => r.beat_track_id);

  const { error: mainErr } = await admin.from('tracks').update({ beat_track_id: list[0] ?? null }).eq('id', songId).eq('user_id', userId);
  if (mainErr) throw mainErr;

  const { error: delErr } = await admin.from('song_beats').delete().eq('song_track_id', songId).eq('user_id', userId);
  if (delErr) {
    if (isMissingSchema(delErr)) {
      if (list.length > 1) throw new SongBeatsNotReadyError();
      return list;
    }
    throw delErr;
  }
  if (rows.length) {
    const { error: insErr } = await admin.from('song_beats').insert(rows);
    if (insErr) throw insErr;
  }
  return list;
}

/** The current ordered list for one song (main first). */
export async function currentSongBeats(admin: Admin, userId: string, song: { id: string; beat_track_id: string | null }): Promise<string[]> {
  const { data, error } = await admin.from('song_beats').select('beat_track_id, position').eq('song_track_id', song.id).eq('user_id', userId);
  if (error) {
    if (isMissingSchema(error)) return orderedBeatIds([], song.beat_track_id);
    throw error;
  }
  return orderedBeatIds((data ?? []) as Array<{ beat_track_id: string; position: number }>, song.beat_track_id);
}
