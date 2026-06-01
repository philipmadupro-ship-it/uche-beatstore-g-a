import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  requireRowOwnership,
  query,
  getAll,
  insert,
  deleteRow,
} from '@/lib/db';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { ProjectFoldersSetBodySchema } from '@/lib/contracts';

/**
 * Folder membership for one project (mig 083).
 *
 *   GET → { folder_ids: string[] }   current membership
 *   PUT → { folder_ids } replaces the membership set
 *
 * Ownership: the project is gated by requireRowOwnership('projects', id). The
 * junction RLS only validates the project parent, so the PUT additionally
 * verifies every posted folder_id belongs to the caller before writing —
 * otherwise a forged id could file the project into someone else's folder.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;
      const { data, error } = await owner.admin
        .from('project_folder_items')
        .select('folder_id')
        .eq('project_id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ folder_ids: (data ?? []).map((r: { folder_id: string }) => r.folder_id) });
    }
    const rows = query('project_folder_items', (r) => (r as { project_id: string }).project_id === id);
    return NextResponse.json({ folder_ids: (rows as { folder_id: string }[]).map((r) => r.folder_id) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, ProjectFoldersSetBodySchema);
  if (!parsed.ok) return parsed.res;
  const wanted = [...new Set(parsed.data.folder_ids)];

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      // Verify the caller owns every folder they're filing into.
      if (wanted.length > 0) {
        const { data: owned, error: ownErr } = await owner.admin
          .from('project_folders')
          .select('id')
          .eq('user_id', owner.userId)
          .in('id', wanted);
        if (ownErr) throw new Error(ownErr.message);
        const ownedSet = new Set((owned ?? []).map((f: { id: string }) => f.id));
        if (wanted.some((fid) => !ownedSet.has(fid))) {
          return NextResponse.json({ error: 'Unknown or unowned folder' }, { status: 403 });
        }
      }

      // Replace membership: clear then bulk-insert the new set.
      const del = await owner.admin.from('project_folder_items').delete().eq('project_id', id);
      if (del.error) throw new Error(del.error.message);
      if (wanted.length > 0) {
        const { error: insErr } = await owner.admin
          .from('project_folder_items')
          .insert(wanted.map((folder_id) => ({ folder_id, project_id: id })));
        if (insErr) throw new Error(insErr.message);
      }
      return NextResponse.json({ success: true, folder_ids: wanted });
    }

    // Local-store fallback.
    const existing = getAll('project_folder_items') as { id: string; project_id: string; folder_id: string }[];
    existing.filter((r) => r.project_id === id).forEach((r) => deleteRow('project_folder_items', r.id));
    wanted.forEach((folder_id) => insert('project_folder_items', { project_id: id, folder_id }));
    return NextResponse.json({ success: true, folder_ids: wanted });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
