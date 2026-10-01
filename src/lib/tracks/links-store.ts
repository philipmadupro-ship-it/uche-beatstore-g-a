/**
 * Reads and writes for linked material on the service-role client (owner
 * filtered). 'beat' links go through song_beats (mig 132, via
 * song-beats-store so tracks.beat_track_id stays the main beat); every other
 * relation is a track_links row (mig 133). Before 133 is applied, reads just
 * lack those links and writes throw TrackLinksNotReadyError.
 */

import { selectIn } from '@/lib/db/chunked-in';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { mergeLinks, type LinkRelation, type LinkTrack, type LinkedItem } from './links';
import { currentSongBeats, writeSongBeats } from './song-beats-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export class TrackLinksNotReadyError extends Error {
  constructor(migration: string) { super(`Linking needs migration ${migration} applied on Supabase.`); }
}

async function tolerant<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return data ?? [];
}

export async function loadLinks(admin: Admin, userId: string, track: { id: string; beat_track_id?: string | null }): Promise<LinkedItem[]> {
  const [sbOut, sbIn, lOut, lIn] = await Promise.all([
    tolerant<{ song_track_id: string; beat_track_id: string; position: number }>(admin.from('song_beats').select('song_track_id, beat_track_id, position').eq('song_track_id', track.id).eq('user_id', userId)),
    tolerant<{ song_track_id: string; beat_track_id: string; position: number }>(admin.from('song_beats').select('song_track_id, beat_track_id, position').eq('beat_track_id', track.id).eq('user_id', userId)),
    tolerant<{ from_track_id: string; to_track_id: string; relation: string; position: number }>(admin.from('track_links').select('from_track_id, to_track_id, relation, position').eq('from_track_id', track.id).eq('user_id', userId)),
    tolerant<{ from_track_id: string; to_track_id: string; relation: string; position: number }>(admin.from('track_links').select('from_track_id, to_track_id, relation, position').eq('to_track_id', track.id).eq('user_id', userId)),
  ]);
  // Songs whose main beat is this track, in case song_beats is missing (pre-132).
  const mainOf = await tolerant<{ id: string }>(admin.from('tracks').select('id').eq('beat_track_id', track.id).eq('user_id', userId));
  const songBeats = [...sbOut, ...sbIn, ...mainOf.map((s) => ({ song_track_id: s.id, beat_track_id: track.id, position: 0 }))];
  const links = [...lOut, ...lIn];
  const ids = new Set<string>([
    ...songBeats.flatMap((r) => [r.song_track_id, r.beat_track_id]),
    ...links.flatMap((r) => [r.from_track_id, r.to_track_id]),
    ...(track.beat_track_id ? [track.beat_track_id] : []),
  ]);
  ids.delete(track.id);
  const rows = ids.size
    ? await selectIn<LinkTrack>((chunk) => admin.from('tracks').select('id, title, type').in('id', chunk).eq('user_id', userId), [...ids])
    : [];
  return mergeLinks(track.id, { songBeats, links, mainBeatId: track.beat_track_id ?? null }, new Map(rows.map((r) => [r.id, r])));
}

/**
 * Link `otherId` to `trackId`. Out: other is track's <relation>. In: track is
 * other's <relation>. A pair has one relation: linking again changes it.
 */
export async function addLink(admin: Admin, userId: string, trackId: string, otherId: string, relation: LinkRelation, direction: 'out' | 'in'): Promise<void> {
  const [from, to] = direction === 'out' ? [trackId, otherId] : [otherId, trackId];
  if (relation === 'beat') {
    const { data: song, error } = await admin.from('tracks').select('id, beat_track_id').eq('id', from).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    const current = await currentSongBeats(admin, userId, song as { id: string; beat_track_id: string | null });
    if (!current.includes(to)) await writeSongBeats(admin, userId, from, [...current, to]);
    return;
  }
  const existing = await admin.from('track_links').select('position').eq('from_track_id', from).eq('user_id', userId);
  if (existing.error) {
    if (isMissingSchema(existing.error)) throw new TrackLinksNotReadyError('133');
    throw existing.error;
  }
  const position = ((existing.data ?? []) as Array<{ position: number }>).reduce((m, r) => Math.max(m, r.position + 1), 0);
  const { error } = await admin.from('track_links')
    .upsert({ from_track_id: from, to_track_id: to, user_id: userId, relation, position }, { onConflict: 'from_track_id,to_track_id' });
  if (error) {
    if (isMissingSchema(error)) throw new TrackLinksNotReadyError('133');
    throw error;
  }
}

export async function removeLink(admin: Admin, userId: string, trackId: string, otherId: string, relation: LinkRelation, direction: 'out' | 'in'): Promise<void> {
  const [from, to] = direction === 'out' ? [trackId, otherId] : [otherId, trackId];
  if (relation === 'beat') {
    const { data: song, error } = await admin.from('tracks').select('id, beat_track_id').eq('id', from).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!song) return;
    const current = await currentSongBeats(admin, userId, song as { id: string; beat_track_id: string | null });
    await writeSongBeats(admin, userId, from, current.filter((b) => b !== to));
    return;
  }
  const { error } = await admin.from('track_links').delete().eq('from_track_id', from).eq('to_track_id', to).eq('user_id', userId);
  if (error && !isMissingSchema(error)) throw error;
}
