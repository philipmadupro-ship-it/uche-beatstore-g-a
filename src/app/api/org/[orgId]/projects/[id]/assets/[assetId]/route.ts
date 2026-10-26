/**
 * PATCH  /api/org/[orgId]/projects/[id]/assets/[assetId]  { label?, kind?, sensitivity?, position? }
 * DELETE /api/org/[orgId]/projects/[id]/assets/[assetId]  — the row, then the stored object.
 *
 * The org twin of /api/projects/[id]/assets/[assetId] (LABEL-15). The member
 * must be able to change the file as it is (lib/labelos/org-assets
 * canWriteOrgAsset) and, for a PATCH, as it would become: a member without
 * contracts.read cannot lift a restriction, nor restrict a file they could
 * then no longer see. A contract or split sheet stays restricted whatever
 * the body says; a kind change keeps the current sensitivity unless the body
 * names one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgAssetPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { fileEventVisibility, recordEvent } from '@/lib/labelos/activity';
import { createLogger } from '@/lib/log';
import { canWriteOrgAsset, ORG_ASSET_COLUMNS, resolveSensitivity, toOrgAssetView, type AssetSensitivity, type OrgAssetRow } from '@/lib/labelos/org-assets';
import { deleteProjectAssetObject } from '@/lib/storage/project-assets';
import { orgAssetRow } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.assets.item');

type Params = { params: Promise<{ orgId: string; id: string; assetId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Organization files need Supabase.' }, { status: 501 });
  const access = await requireObjectAccess({ table: 'project_assets', id: assetId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const found = await orgAssetRow(access, id, 'write');
  if (!found.ok) return found.res;
  const parsed = await readBody(req, OrgAssetPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  const current = found.row;
  const kind = parsed.data.kind ?? current.kind;
  const sensitivity = resolveSensitivity(kind, parsed.data.sensitivity ?? (current.sensitivity as AssetSensitivity));
  if (!canWriteOrgAsset(access.capabilities, { kind, sensitivity })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const patch: Record<string, unknown> = { ...parsed.data, sensitivity, updated_at: new Date().toISOString() };
    const { data, error } = await access.admin
      .from('project_assets')
      .update(patch)
      .eq('id', assetId)
      .eq('project_id', current.project_id)
      .eq('org_id', access.object.orgId)
      .select(ORG_ASSET_COLUMNS)
      .single();
    if (error) throw error;
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'file.updated',
      { type: 'asset', id: assetId, projectId: current.project_id },
      { fields: Object.keys(parsed.data).sort(), kind, sensitivity },
      // A file that is, or was, restricted keeps its history business-internal.
      { visibility: fileEventVisibility(sensitivity, current.sensitivity) },
    );
    return NextResponse.json({ asset: toOrgAssetView(data as OrgAssetRow) });
  } catch (err) {
    log.error('patch failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not save the file' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Organization files need Supabase.' }, { status: 501 });
  const access = await requireObjectAccess({ table: 'project_assets', id: assetId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const found = await orgAssetRow(access, id, 'write');
  if (!found.ok) return found.res;

  try {
    const { data, error } = await access.admin
      .from('project_assets')
      .delete()
      .eq('id', assetId)
      .eq('project_id', found.row.project_id)
      .eq('org_id', access.object.orgId)
      .select('url');
    if (error) throw error;
    const row = (data as Array<{ url: string }> | null)?.[0];
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'file.deleted',
      { type: 'asset', id: assetId, projectId: found.row.project_id },
      { kind: found.row.kind, sensitivity: found.row.sensitivity },
      { visibility: fileEventVisibility(found.row.sensitivity) },
    );
    // The row is gone, so nothing can reach the object any more; removing it
    // is housekeeping and must not fail the delete.
    // If the check itself fails, keep the object: an orphan is housekeeping,
    // a deleted object under a surviving row is a broken file.
    const { count, error: countErr } = await access.admin
      .from('project_assets')
      .select('id', { count: 'exact', head: true })
      .eq('url', row.url);
    if (countErr) log.warn('reference check failed; object kept', { assetId, error: errorMessage(countErr) });
    else if (!count) {
      await deleteProjectAssetObject(row.url).catch((e: unknown) => log.warn('object delete failed', { assetId, error: errorMessage(e) }));
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error('delete failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not delete the file' }, { status: 500 });
  }
}
