import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, insert, deleteRow, query, requireRowOwnership, update } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectTracksAddBodySchema, ProjectTracksDeleteBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { z } from 'zod';

interface JunctionRow {
  id?: string;
  project_id: string;
  track_id: string;
  position?: number;
}

/**
 * Add existing library tracks to a project. Appends at end (max
 * position + 1). No-ops for tracks already in the project — returns
 * `added` + `skipped` counts so the UI can render a useful toast.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const parsed = await readBody(req, ProjectTracksAddBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_ids } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', projectId);
      if (!owner.ok) return owner.res;
      const supabase = owner.admin;

      const { data: existing } = await supabase
        .from('project_tracks')
        .select('track_id, position')
        .eq('project_id', projectId);

      const rows = (existing ?? []) as JunctionRow[];
      const have = new Set(rows.map((p) => p.track_id));
      const startPos = rows.reduce((m, p) => Math.max(m, p.position ?? 0), 0) + 1;

      const toInsert = track_ids
        .filter((tid) => !have.has(tid))
        .map((tid, i) => ({
          project_id: projectId,
          track_id: tid,
          role: 'main',
          position: startPos + i,
        }));

      if (toInsert.length) {
        const { error } = await supabase.from('project_tracks').insert(toInsert);
        if (error) throw error;
      }
      return NextResponse.json({ added: toInsert.length, skipped: track_ids.length - toInsert.length });
    }

    const existingLocal = query('project_tracks', (pt) => (pt as JunctionRow).project_id === projectId) as JunctionRow[];
    const have = new Set(existingLocal.map((p) => p.track_id));
    const startPos = existingLocal.reduce((m, p) => Math.max(m, p.position ?? 0), 0) + 1;
    let added = 0;
    for (const tid of track_ids) {
      if (have.has(tid)) continue;
      insert('project_tracks', {
        project_id: projectId,
        track_id: tid,
        role: 'main',
        position: startPos + added,
        added_at: new Date().toISOString(),
      });
      added++;
    }
    return NextResponse.json({ added, skipped: track_ids.length - added });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}


/**
 * Remove a track from the project. Doesn't touch the track itself —
 * the row stays in the library; only the junction goes away.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const parsed = await readBody(req, ProjectTracksDeleteBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_id } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', projectId);
      if (!owner.ok) return owner.res;
      const { error } = await owner.admin
        .from('project_tracks')
        .delete()
        .eq('project_id', projectId)
        .eq('track_id', track_id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    const rows = query(
      'project_tracks',
      (pt) => (pt as JunctionRow).project_id === projectId && (pt as JunctionRow).track_id === track_id,
    ) as JunctionRow[];
    for (const row of rows) {
      if (row.id) deleteRow('project_tracks', row.id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}


/**
 * PATCH /api/projects/[id]/tracks — bulk reorder.
 * Body: { positions: [{ track_id, position }] }
 * Replaces positions for the listed tracks in one transaction-like loop.
 */
const ReorderBodySchema = z.object({
  positions: z.array(z.object({ track_id: z.string().uuid(), position: z.number().int().min(0) })).min(1).max(500),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const parsed = await readBody(req, ReorderBodySchema);
  if (!parsed.ok) return parsed.res;
  const { positions } = parsed.data;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', projectId);
      if (!owner.ok) return owner.res;
      // Batch update: each row is a separate RPC-style upsert.
      for (const { track_id, position } of positions) {
        const { error } = await owner.admin
          .from('project_tracks')
          .update({ position })
          .eq('project_id', projectId)
          .eq('track_id', track_id);
        if (error) throw error;
      }
      return NextResponse.json({ success: true });
    }
    // Local-store path
    for (const { track_id, position } of positions) {
      const rows = query('project_tracks', (pt) =>
        (pt as JunctionRow).project_id === projectId && (pt as JunctionRow).track_id === track_id,
      ) as JunctionRow[];
      for (const row of rows) {
        if (row.id) update('project_tracks', row.id, { position });
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
