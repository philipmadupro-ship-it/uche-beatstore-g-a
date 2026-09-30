import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectAssetPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { PROJECT_ASSET_COLUMNS, toProjectAssetView, type ProjectAssetRow } from '@/lib/projects/asset-view';
import { deleteProjectAssetObject } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.assets.item');

/**
 * PATCH  /api/projects/[id]/assets/[assetId]  { label?, kind?, in_portal?, position? }
 * DELETE /api/projects/[id]/assets/[assetId]  — the row, then the stored object.
 *
 * Switching `in_portal` on stamps `portal_at`, so a file that sat on the
 * project for weeks is NEW to the artist the day it is shared.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Project files need Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;
  const parsed = await readBody(req, ProjectAssetPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const { data: current, error: curErr } = await auth.admin
      .from('project_assets')
      .select('in_portal')
      .eq('id', assetId)
      .eq('project_id', id)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { ...parsed.data, updated_at: now };
    if (parsed.data.in_portal === true && !(current as { in_portal: boolean }).in_portal) patch.portal_at = now;

    const { data, error } = await auth.admin
      .from('project_assets')
      .update(patch)
      .eq('id', assetId)
      .eq('project_id', id)
      .eq('user_id', auth.userId)
      .select(PROJECT_ASSET_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ asset: toProjectAssetView(data as ProjectAssetRow) });
  } catch (err) {
    log.error('patch failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Project files need Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;

  try {
    const { data, error } = await auth.admin
      .from('project_assets')
      .delete()
      .eq('id', assetId)
      .eq('project_id', id)
      .eq('user_id', auth.userId)
      .select('url');
    if (error) throw error;
    const row = (data as Array<{ url: string }> | null)?.[0];
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // The row is gone, so nothing can reach the object any more; removing it
    // is housekeeping and must not fail the delete.
    const { count } = await auth.admin
      .from('project_assets')
      .select('id', { count: 'exact', head: true })
      .eq('url', row.url);
    if (!count) {
      await deleteProjectAssetObject(row.url).catch((e: unknown) => log.warn('object delete failed', { assetId, error: errorMessage(e) }));
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error('delete failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
