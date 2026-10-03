/**
 * Who may touch which org project file (LABEL-15), shared by the
 * `/api/org/[orgId]/projects/[id]/assets*` routes. Not a route itself.
 *
 *  - The PROJECT: each route calls requireObjectAccess on `projects` —
 *    another org's, a producer project (org_id NULL) or one outside the
 *    member's artists is 404; no `catalog.read` is 403.
 *  - The FILE: each route calls requireObjectAccess on `project_assets` (its
 *    org from the row, scope through its project); `orgAssetRow` then
 *    requires the file to belong to the project in the path (404
 *    otherwise), and applies the pure rules in
 *    lib/labelos/org-assets: a file the member cannot open — working
 *    material without `audio.working`, or a restricted file without
 *    `contracts.read` — is 403. Scope is 404, capability 403, as everywhere
 *    in org-access, so a 403 never confirms something outside the scope.
 */
import { NextResponse } from 'next/server';
import type { ObjectAccessResult } from '@/lib/auth/org-access';
import type { OwnershipFail } from '@/lib/auth/ownership';
import { canReadOrgAsset, canWriteOrgAsset, ORG_ASSET_COLUMNS, type OrgAssetRow } from '@/lib/labelos/org-assets';
import { isMissingSchema } from '@/lib/artists/workspace-load';

type ObjectAccessOk = Extract<ObjectAccessResult, { ok: true }>;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): OwnershipFail => ({
  ok: false,
  res: NextResponse.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } }),
});

export const notReady = () =>
  fail(503, 'Organization files need migration 143 applied on Supabase.', { migration: '143', schemaReady: false });

export type AssetAccess = { ok: true; row: OrgAssetRow };

/**
 * After the route's `requireObjectAccess({ table: 'project_assets', … })`:
 * the file, if it belongs to the project in the path and the member may
 * open it (`mode: 'read'`) or change it (`mode: 'write'`). The row is read
 * with the service role, by id, project and org — never by user.
 */
export async function orgAssetRow(
  access: ObjectAccessOk,
  projectId: string,
  mode: 'read' | 'write',
): Promise<AssetAccess | OwnershipFail> {
  const { object } = access;
  if (object.projectId?.toLowerCase() !== projectId.toLowerCase()) return fail(404, 'Not found');
  const { data, error } = await access.admin
    .from('project_assets')
    .select(ORG_ASSET_COLUMNS)
    .eq('id', object.id)
    .eq('project_id', object.projectId)
    .eq('org_id', object.orgId)
    .maybeSingle();
  if (error) return isMissingSchema(error) ? notReady() : fail(500, 'Could not read the file');
  const row = data as OrgAssetRow | null;
  if (!row) return fail(404, 'Not found');
  const allowed = mode === 'read' ? canReadOrgAsset(access.capabilities, row) : canWriteOrgAsset(access.capabilities, row);
  if (!allowed) return fail(403, 'Forbidden');
  return { ok: true, row };
}
