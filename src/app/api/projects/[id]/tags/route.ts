import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  query,
  insert,
  getAll,
  deleteRow,
  requireRowOwnership,
} from '@/lib/db';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { TagCreateBodySchema, TagDeleteBodySchema } from '@/lib/contracts';

/**
 * Project-tag CRUD (migration 081). Mirrors the track-tag route — the junction
 * has no user_id, so ownership flows through the parent project via
 * requireRowOwnership('projects', id) before touching project_tags.
 *
 * GET returns { tag, category } objects (not bare strings) so the projects
 * list + filter can match by category (genre/mood/project_type/…).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      const { data, error } = await owner.admin
        .from('project_tags')
        .select('tag, category')
        .eq('project_id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json(data || []);
    }

    const tags = query('project_tags', (t) => (t as { project_id: string }).project_id === id);
    return NextResponse.json((tags as { tag: string; category?: string }[]).map((t) => ({ tag: t.tag, category: t.category ?? null })));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, TagCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const { tag, category } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      const { data: newTag, error } = await owner.admin
        .from('project_tags')
        .upsert({ project_id: id, tag, category }, { onConflict: 'project_id,tag' })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, tag: newTag });
    }

    const existing = query('project_tags',
      (t) => (t as { project_id: string; tag: string }).project_id === id
        && (t as { project_id: string; tag: string }).tag === tag,
    );
    if (existing.length === 0) {
      insert('project_tags', { project_id: id, tag, category });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, TagDeleteBodySchema);
  if (!parsed.ok) return parsed.res;
  const { tag } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      const { error } = await owner.admin
        .from('project_tags')
        .delete()
        .eq('project_id', id)
        .eq('tag', tag);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true });
    }

    const allTags = getAll('project_tags') as { id: string; project_id: string; tag: string }[];
    const target = allTags.find((t) => t.project_id === id && t.tag === tag);
    if (target) deleteRow('project_tags', target.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
