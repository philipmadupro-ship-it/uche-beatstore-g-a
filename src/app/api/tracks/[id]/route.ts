import { NextRequest, NextResponse } from 'next/server';
import {
  getOwned,
  updateOwned,
  deleteOwned,
  isErrorResponse,
  isSupabaseConfigured,
  query,
} from '@/lib/db';
import { readBody } from '@/lib/validate';
import { TrackPatchBodySchema } from '@/lib/contracts';
import { createServiceClient } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';
import { currentSongBeats, writeSongBeats } from '@/lib/tracks/song-beats-store';
import { replaceMainBeat } from '@/lib/tracks/song-beats';
import { pruneTrackMp3s } from '@/lib/audio/mp3-deliverable.server';

const log = createLogger('api.tracks.item');

/**
 * Single-track CRUD through the storage facade.
 *
 *   GET    → row + track_tags + stems joins
 *   PATCH  → whitelisted-by-facade update (id / user_id never trusted)
 *   DELETE → hard delete (parent project / playlist junctions cascade via FK)
 *
 * All three call ownership-gating helpers under the hood, so adding a new
 * mutation route in the future is one line + the patch body.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getOwned('tracks', id, {
    select: '*, track_tags(tag, category), stems(status)',
  });
  if (isErrorResponse(row)) return row;
  // Local-store path: the facade returns a bare row — manually attach tags/stems.
  if (!isSupabaseConfigured()) {
    const tags = query('track_tags', (t) => (t as { track_id: string }).track_id === id);
    const stems = query('stems', (s) => (s as { track_id: string }).track_id === id);
    return NextResponse.json({ ...(row as object), track_tags: tags, stems });
  }
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Validate against an allow-list of editable columns before hitting the
  // facade. Stops callers from writing to internal/computed columns and
  // surfaces field-level errors instead of opaque 500s from Postgres.
  const parsed = await readBody(req, TrackPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  // The single "Built on" control changes the MAIN beat; keep song_beats
  // (mig 132) in step: the new main first, the old main out, the rest kept.
  const changesMain = parsed.data.beat_track_id !== undefined && isSupabaseConfigured();
  const before = changesMain
    ? (await createServiceClient().from('tracks').select('id, user_id, beat_track_id').eq('id', id).maybeSingle()).data as { id: string; user_id: string; beat_track_id: string | null } | null
    : null;

  const result = await updateOwned('tracks', id, parsed.data);
  if (isErrorResponse(result)) return result;

  if (before && before.beat_track_id !== (parsed.data.beat_track_id ?? null)) {
    try {
      const admin = createServiceClient();
      const current = await currentSongBeats(admin, before.user_id, before);
      await writeSongBeats(admin, before.user_id, id, replaceMainBeat(current, before.beat_track_id, parsed.data.beat_track_id ?? null));
    } catch (err) {
      // The main beat is saved; the extra beats list is a best-effort mirror.
      log.warn('song_beats sync failed', { id, error: errorMessage(err) });
    }
  }
  return NextResponse.json({ track: result });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('tracks', id);
  if (isErrorResponse(result)) return result;
  // Ownership is proven and the row is gone: its lease MP3s have no purpose.
  // Best-effort (never throws); the master and previews are not touched here.
  await pruneTrackMp3s({ id, audio_url: null });
  return NextResponse.json({ success: true });
}
