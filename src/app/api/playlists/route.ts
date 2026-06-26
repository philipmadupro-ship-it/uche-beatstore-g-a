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
import { parsePagination } from '@/lib/validate';

type PlaylistTrackPreviewRow = {
  playlist_id: string;
  track_id: string;
  position?: number | null;
};
type PlaylistTagRow = { playlist_id: string; tag: string; category?: string | null };
type PlaylistFolderItemRow = { playlist_id: string; folder_id: string };

function addPreviewCover(map: Map<string, string[]>, ownerId: string, cover?: unknown) {
  if (typeof cover !== 'string' || !cover) return;
  const covers = map.get(ownerId) ?? [];
  if (!covers.includes(cover) && covers.length < 4) {
    covers.push(cover);
    map.set(ownerId, covers);
  }
}

/**
 * GET /api/playlists — caller's playlists + null-owner legacy rows, with
 * track_count attached via the playlist_tracks junction.
 */
export async function GET(req: NextRequest) {
  type PlaylistRow = { id: string; user_id: string | null; [k: string]: unknown };

  const { limit, offset } = parsePagination(new URL(req.url).searchParams);
  const playlists = await scopedList<PlaylistRow>('playlists', {
    orderBy: 'created_at',
    ascending: false,
    limit,
    offset,
  });
  if (isErrorResponse(playlists)) return playlists;

  const ids = playlists.map((p) => p.id);
  const counts = new Map<string, number>();
  const tagsByPlaylist = new Map<string, { tag: string; category: string | null }[]>();
  const foldersByPlaylist = new Map<string, string[]>();
  const previewCoversByPlaylist = new Map<string, string[]>();

  if (isSupabaseConfigured() && ids.length) {
    const admin = createServiceClient();
    const [{ data: pts }, { data: tagRows }, { data: folderRows }] = await Promise.all([
      admin.from('playlist_tracks').select('playlist_id, track_id, position').in('playlist_id', ids),
      admin.from('playlist_tags').select('playlist_id, tag, category').in('playlist_id', ids),
      admin.from('playlist_folder_items').select('playlist_id, folder_id').in('playlist_id', ids),
    ]);

    const playlistTrackRows = (pts ?? []) as PlaylistTrackPreviewRow[];
    const trackIds = [...new Set(playlistTrackRows.map((pt) => pt.track_id).filter(Boolean))];
    const coverByTrack = new Map<string, string | null>();
    if (trackIds.length) {
      const { data: trackRows } = await admin.from('tracks').select('id, cover_url').in('id', trackIds);
      (trackRows ?? []).forEach((track: { id: string; cover_url: string | null }) => {
        coverByTrack.set(track.id, track.cover_url);
      });
    }

    playlistTrackRows.forEach((pt) => counts.set(pt.playlist_id, (counts.get(pt.playlist_id) ?? 0) + 1));
    [...playlistTrackRows]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((pt) => addPreviewCover(previewCoversByPlaylist, pt.playlist_id, coverByTrack.get(pt.track_id)));

    (tagRows ?? []).forEach((r: PlaylistTagRow) => {
      const arr = tagsByPlaylist.get(r.playlist_id) ?? [];
      arr.push({ tag: r.tag, category: r.category ?? null });
      tagsByPlaylist.set(r.playlist_id, arr);
    });
    (folderRows ?? []).forEach((r: PlaylistFolderItemRow) => {
      const arr = foldersByPlaylist.get(r.playlist_id) ?? [];
      arr.push(r.folder_id);
      foldersByPlaylist.set(r.playlist_id, arr);
    });
  } else if (!isSupabaseConfigured()) {
    const allPT = getAll('playlist_tracks') as PlaylistTrackPreviewRow[];
    const coverByTrack = new Map(
      (getAll('tracks') as { id: string; cover_url?: string | null }[]).map((track) => [track.id, track.cover_url ?? null]),
    );
    allPT.forEach((pt) => counts.set(pt.playlist_id, (counts.get(pt.playlist_id) ?? 0) + 1));
    [...allPT]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((pt) => addPreviewCover(previewCoversByPlaylist, pt.playlist_id, coverByTrack.get(pt.track_id)));
    (getAll('playlist_tags') as PlaylistTagRow[]).forEach((r) => { const arr = tagsByPlaylist.get(r.playlist_id) ?? []; arr.push({ tag: r.tag, category: r.category ?? null }); tagsByPlaylist.set(r.playlist_id, arr); });
    (getAll('playlist_folder_items') as PlaylistFolderItemRow[]).forEach((r) => { const arr = foldersByPlaylist.get(r.playlist_id) ?? []; arr.push(r.folder_id); foldersByPlaylist.set(r.playlist_id, arr); });
  }

  const withCount = playlists.map((p) => ({
    ...p,
    track_count: counts.get(p.id) ?? 0,
    tags: tagsByPlaylist.get(p.id) ?? [],
    folder_ids: foldersByPlaylist.get(p.id) ?? [],
    preview_covers: previewCoversByPlaylist.get(p.id) ?? [],
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
