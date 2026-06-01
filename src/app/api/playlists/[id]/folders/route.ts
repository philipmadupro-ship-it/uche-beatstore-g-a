import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, requireRowOwnership, query, getAll, insert, deleteRow } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { PlaylistFoldersSetBodySchema } from '@/lib/contracts';

/** GET current folder membership; PUT replaces the set (with folder-ownership check). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', id);
      if (!owner.ok) return owner.res;
      const { data, error } = await owner.admin.from('playlist_folder_items').select('folder_id').eq('playlist_id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ folder_ids: (data ?? []).map((r: any) => r.folder_id) });
    }
    const rows = query('playlist_folder_items', (r) => (r as any).playlist_id === id);
    return NextResponse.json({ folder_ids: (rows as any[]).map((r) => r.folder_id) });
  } catch (error) { return NextResponse.json({ error: errorMessage(error) }, { status: 500 }); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, PlaylistFoldersSetBodySchema);
  if (!parsed.ok) return parsed.res;
  const wanted = [...new Set(parsed.data.folder_ids)];
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', id);
      if (!owner.ok) return owner.res;
      if (wanted.length > 0) {
        const { data: owned } = await owner.admin.from('playlist_folders').select('id').eq('user_id', owner.userId).in('id', wanted);
        const ownedSet = new Set((owned ?? []).map((f: any) => f.id));
        if (wanted.some((fid) => !ownedSet.has(fid))) return NextResponse.json({ error: 'Unknown or unowned folder' }, { status: 403 });
      }
      await owner.admin.from('playlist_folder_items').delete().eq('playlist_id', id);
      if (wanted.length > 0) await owner.admin.from('playlist_folder_items').insert(wanted.map((folder_id) => ({ folder_id, playlist_id: id })));
      return NextResponse.json({ success: true, folder_ids: wanted });
    }
    const existing = getAll('playlist_folder_items') as any[];
    existing.filter((r) => r.playlist_id === id).forEach((r) => deleteRow('playlist_folder_items', r.id));
    wanted.forEach((folder_id) => insert('playlist_folder_items', { playlist_id: id, folder_id }));
    return NextResponse.json({ success: true, folder_ids: wanted });
  } catch (error) { return NextResponse.json({ error: errorMessage(error) }, { status: 500 }); }
}
