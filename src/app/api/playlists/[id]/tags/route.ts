import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, query, insert, getAll, deleteRow, requireRowOwnership } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { TagCreateBodySchema, TagDeleteBodySchema } from '@/lib/contracts';

/** Playlist-tag CRUD (mig 086). Mirrors the project-tag route exactly. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', id);
      if (!owner.ok) return owner.res;
      const { data, error } = await owner.admin.from('playlist_tags').select('tag, category').eq('playlist_id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json(data || []);
    }
    const tags = query('playlist_tags', (t) => (t as any).playlist_id === id);
    return NextResponse.json((tags as any[]).map((t) => ({ tag: t.tag, category: t.category ?? null })));
  } catch (error) { return NextResponse.json({ error: errorMessage(error) }, { status: 500 }); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, TagCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const { tag, category } = parsed.data;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', id);
      if (!owner.ok) return owner.res;
      const { data, error } = await owner.admin.from('playlist_tags').upsert({ playlist_id: id, tag, category }, { onConflict: 'playlist_id,tag' }).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, tag: data });
    }
    const existing = query('playlist_tags', (t) => (t as any).playlist_id === id && (t as any).tag === tag);
    if (existing.length === 0) insert('playlist_tags', { playlist_id: id, tag, category });
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ error: errorMessage(error) }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, TagDeleteBodySchema);
  if (!parsed.ok) return parsed.res;
  const { tag } = parsed.data;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('playlists', id);
      if (!owner.ok) return owner.res;
      const { error } = await owner.admin.from('playlist_tags').delete().eq('playlist_id', id).eq('tag', tag);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }
    const all = getAll('playlist_tags') as any[];
    const target = all.find((t) => t.playlist_id === id && t.tag === tag);
    if (target) deleteRow('playlist_tags', target.id);
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ error: errorMessage(error) }, { status: 500 }); }
}
