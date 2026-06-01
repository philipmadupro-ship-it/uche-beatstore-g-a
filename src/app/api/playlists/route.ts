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
  const tagsByPlaylist = new Map<string, { tag: string; category: string | null }[]>();
  const foldersByPlaylist = new Map<string, string[]>();

  if (isSupabaseConfigured() && ids.length) {
    const admin = createServiceClient();
    const [{ data: pts }, { data: tagRows }, { data: folderRows }] = await Promise.all([
      admin.from('playlist_tracks').select('playlist_id').in('playlist_id', ids),
      admin.from('playlist_tags').select('playlist_id, tag, category').in('playlist_id', ids),
      admin.from('playlist_folder_items').select('playlist_id, folder_id').in('playlist_id', ids),
    ]);
    (pts ?? []).forEach((pt: any) => counts.set(pt.playlist_id, (counts.get(pt.playlist_id) ?? 0) + 1));
    (tagRows ?? []).forEach((r: any) => {
      const arr = tagsByPlaylist.get(r.playlist_id) ?? [];
      arr.push({ tag: r.tag, category: r.category });
      tagsByPlaylist.set(r.playlist_id, arr);
    });
    (folderRows ?? []).forEach((r: any) => {
      const arr = foldersByPlaylist.get(r.playlist_id) ?? [];
      arr.push(r.folder_id);
      foldersByPlaylist.set(r.playlist_id, arr);
    });
  } else if (!isSupabaseConfigured()) {
    (getAll('playlist_tracks') as any[]).forEach((pt) => counts.set(pt.playlist_id, (counts.get(pt.playlist_id) ?? 0) + 1));
    (getAll('playlist_tags') as any[]).forEach((r: any) => { const arr = tagsByPlaylist.get(r.playlist_id) ?? []; arr.push({ tag: r.tag, category: r.category ?? null }); tagsByPlaylist.set(r.playlist_id, arr); });
    (getAll('playlist_folder_items') as any[]).forEach((r: any) => { const arr = foldersByPlaylist.get(r.playlist_id) ?? []; arr.push(r.folder_id); foldersByPlaylist.set(r.playlist_id, arr); });
  }

  const withCount = playlists.map((p) => ({
    ...p,
    track_count: counts.get(p.id) ?? 0,
    tags: tagsByPlaylist.get(p.id) ?? [],
    folder_ids: foldersByPlaylist.get(p.id) ?? [],
  }));
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
