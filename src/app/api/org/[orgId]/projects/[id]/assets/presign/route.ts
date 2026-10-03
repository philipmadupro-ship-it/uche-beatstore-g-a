/**
 * POST /api/org/[orgId]/projects/[id]/assets/presign  { file_name, size_bytes }
 *   → { uploadUrl, url, contentType }
 *
 * The org twin of /api/projects/[id]/assets/presign (LABEL-15). A file too
 * big for the app server is PUT straight to the PRIVATE bucket under
 * `orgs/<org>/assets/<project>/`, then registered with POST ../assets, which
 * refuses any other key. The kind is not known yet, so this needs only that
 * the member may add SOME file here (normal or restricted,
 * lib/labelos/org-assets orgAssetPermissions); registering checks the kind and sensitivity. Without
 * R2 there is nothing to presign: 501, and the client uploads through the
 * server.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectAssetPresignBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { assetValidationMessage, validateAssetFile } from '@/lib/projects/assets';
import { orgAssetObjectKey, orgAssetPermissions } from '@/lib/labelos/org-assets';
import { presignProjectAssetPut } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.assets.presign');

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; id: string }> }) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Organization files need Supabase.' }, { status: 501 });
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const perms = orgAssetPermissions(access.capabilities);
  if (!perms.write && !perms.restricted) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = await readBody(req, ProjectAssetPresignBodySchema);
  if (!parsed.ok) return parsed.res;
  const check = validateAssetFile({ name: parsed.data.file_name, size: parsed.data.size_bytes }, { org: true });
  if (!check.ok) {
    return NextResponse.json({ error: assetValidationMessage(check.error, { org: true }) }, { status: check.error === 'too-large' ? 413 : 415 });
  }

  try {
    const signed = await presignProjectAssetPut(orgAssetObjectKey(access.object.orgId, id, nanoid(16), check.extension), check.mime);
    if (!signed) return NextResponse.json({ error: 'Direct uploads need R2 storage.' }, { status: 501 });
    return NextResponse.json({ ...signed, contentType: check.mime });
  } catch (err) {
    log.error('presign failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 });
  }
}
