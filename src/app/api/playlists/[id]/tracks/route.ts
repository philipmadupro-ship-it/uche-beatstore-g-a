import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  insert,
  deleteRow,
  update,
  query,
  requireRowOwnership,
} from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { readBody } from '@/lib/validate';
import {
  PlaylistTracksAddBodySchema,
  PlaylistTracksDeleteBodySchema,
  PlaylistTracksReorderBodySchema,
} from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';

/**
 * Playlist-track junction routes. Each handler gates on ownership of the
 * parent playlist via requireRowOwnership('playlists', id). Pre-fix, any
 * authenticated user could mutate any playlist's contents by ID.
 */

interface JunctionRow {
  id?: string;
  playlist_id: string;
  track_id: string;
  position?: number;
}


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: playlistId } = await params;
  const parsed = await readBody(req, PlaylistTracksAddBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_ids } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', playlistId);
      if (!owner.ok) return owner.res;

      const { data: existing } = await owner.admin
        .from('playlist_tracks')
        .select('track_id, position')
        .eq('playlist_id', playlistId);

      const rows = (existing ?? []) as JunctionRow[];
      const have = new Set(rows.map((p) => p.track_id));
      const startPos = rows.reduce((m, p) => Math.max(m, p.position ?? 0), 0) + 1;

      // Only the caller's own tracks. The playlist's owner was checked; the
      // tracks were not, so another user's track — or an organization's, which
      // is ownerless — could be put in a playlist and read back through it
      // (the public store looks a featured playlist's tracks up by id).
      // Chunked: a "add the selection" of a few hundred ids overflows a URL.
      const ownedRows = await selectIn<{ id: string }>(
        (ids) => owner.admin.from('tracks').select('id').in('id', ids).eq('user_id', owner.userId),
        track_ids,
      );
      const owned = new Set(ownedRows.map((t) => t.id));

      const toInsert = track_ids
        .filter((tid) => owned.has(tid) && !have.has(tid))
        .map((tid, i) => ({ playlist_id: playlistId, track_id: tid, position: startPos + i }));

      if (toInsert.length) {
        const { error } = await owner.admin.from('playlist_tracks').insert(toInsert);
        if (error) throw error;
      }
      return NextResponse.json({ added: toInsert.length });
    }

    const existingLocal = query('playlist_tracks', (pt) => (pt as JunctionRow).playlist_id === playlistId) as JunctionRow[];
    const have = new Set(existingLocal.map((p) => p.track_id));
    const startPos = existingLocal.reduce((m, p) => Math.max(m, p.position ?? 0), 0) + 1;
    let added = 0;
    for (const tid of track_ids) {
      if (have.has(tid)) continue;
      insert('playlist_tracks', { playlist_id: playlistId, track_id: tid, position: startPos + added });
      added++;
    }
    return NextResponse.json({ added });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}


export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: playlistId } = await params;
  const parsed = await readBody(req, PlaylistTracksDeleteBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_id } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', playlistId);
      if (!owner.ok) return owner.res;

      const { error } = await owner.admin
        .from('playlist_tracks')
        .delete()
        .eq('playlist_id', playlistId)
        .eq('track_id', track_id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    const rows = query(
      'playlist_tracks',
      (pt) => (pt as JunctionRow).playlist_id === playlistId && (pt as JunctionRow).track_id === track_id,
    ) as JunctionRow[];
    for (const row of rows) {
      if (row.id) deleteRow('playlist_tracks', row.id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}


/** Reorder — body carries the full ordered tracklist. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: playlistId } = await params;
  const parsed = await readBody(req, PlaylistTracksReorderBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_ids } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', playlistId);
      if (!owner.ok) return owner.res;

      // Composite PK is (playlist_id, track_id) — eq both for safety.
      // Sequential updates: lists are usually small (<50).
      for (let i = 0; i < track_ids.length; i++) {
        const { error } = await owner.admin
          .from('playlist_tracks')
          .update({ position: i + 1 })
          .eq('playlist_id', playlistId)
          .eq('track_id', track_ids[i]);
        if (error) throw error;
      }
      return NextResponse.json({ success: true });
    }

    const all = query('playlist_tracks', (pt) => (pt as JunctionRow).playlist_id === playlistId) as JunctionRow[];
    for (const row of all) {
      const newPos = track_ids.indexOf(row.track_id);
      if (newPos >= 0 && row.id) {
        update('playlist_tracks', row.id, { position: newPos + 1 });
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
