import { NextRequest, NextResponse } from 'next/server';
import {
  scopedList,
  insertOwned,
  isErrorResponse,
  createServiceClient,
  isSupabaseConfigured,
  getAll,
} from '@/lib/db';
import { nextPlaylistName } from '@/lib/naming';

/**
 * GET /api/playlists — caller's playlists + null-owner legacy rows, with
 * track_count attached via the playlist_tracks junction.
 */
export async function GET() {
  type PlaylistRow = { id: string; user_id: string | null; [k: string]: unknown };

  const playlists = await scopedList<PlaylistRow>('playlists', {
    orderBy: 'created_at',
    ascending: false,
  });
  if (isErrorResponse(playlists)) return playlists;

  const ids = playlists.map((p) => p.id);
  const counts = new Map<string, number>();

  if (isSupabaseConfigured() && ids.length) {
    const admin = createServiceClient();
    const { data: pts } = await admin
      .from('playlist_tracks')
      .select('playlist_id')
      .in('playlist_id', ids);
    (pts ?? []).forEach((pt: { playlist_id: string }) => {
      counts.set(pt.playlist_id, (counts.get(pt.playlist_id) ?? 0) + 1);
    });
  } else if (!isSupabaseConfigured()) {
    const allPT = getAll('playlist_tracks') as { playlist_id: string }[];
    allPT.forEach((pt) => counts.set(pt.playlist_id, (counts.get(pt.playlist_id) ?? 0) + 1));
  }

  const withCount = playlists.map((p) => ({ ...p, track_count: counts.get(p.id) ?? 0 }));
  return NextResponse.json({ playlists: withCount }, {
    headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const name = rawName || (await nextPlaylistName(null));

  const result = await insertOwned('playlists', {
    name,
    cover_url: null,
  });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ playlist: result });
}
