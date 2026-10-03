/**
 * GET  /api/org/[orgId]/projects/[id]/assets — the org project's files the
 *      member may open (LABEL-15), plus what they may add.
 * POST /api/org/[orgId]/projects/[id]/assets — add one:
 *   multipart  file + kind? + label? + sensitivity?  (up to 4 MB, through the server)
 *   JSON       { url, file_name, kind?, label?, sensitivity? } after a presigned
 *              PUT (./presign). The reference must be one this org project's
 *              presign minted (`orgs/<org>/assets/<project>/…` in the private
 *              bucket) and must exist.
 *
 * The org twin of /api/projects/[id]/assets, which is unchanged: the same
 * allowlist (plus the org extras), storage helpers and view shape, with the
 * org's capability rules (lib/labelos/org-assets) instead of ownership. A
 * contract or split sheet is always restricted. The member must be able to
 * open the file they add (a member without contracts.read cannot add a
 * restricted one). Rows are written by the service role with no user_id —
 * org rows have no owner (142); the uploader is `created_by`. Org files are
 * never put in a portal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgAssetFormFieldsSchema, OrgAssetRegisterBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import {
  assetValidationMessage,
  defaultAssetLabel,
  MAX_DIRECT_UPLOAD_BYTES,
  validateAssetFile,
} from '@/lib/projects/assets';
import {
  canReadOrgAsset,
  canWriteOrgAsset,
  guessOrgAssetKind,
  orgAssetPermissions,
  ORG_ASSET_COLUMNS,
  orgAssetObjectKey,
  orgProjectAssetKeyOf,
  resolveSensitivity,
  toOrgAssetView,
  type AssetSensitivity,
  type OrgAssetKind,
  type OrgAssetRow,
} from '@/lib/labelos/org-assets';
import { deleteProjectAssetObject, projectAssetBuckets, projectAssetSize, storeProjectAsset } from '@/lib/storage/project-assets';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { notReady } from './access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.assets');

type Params = { params: Promise<{ orgId: string; id: string }> };

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, assets: [] });
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const org = access.object.orgId;

  // The project is in scope (requireObjectAccess); its files are listed by
  // project and org, then each held to the member's capabilities.
  const { data, error } = await access.admin
    .from('project_assets')
    .select(ORG_ASSET_COLUMNS)
    .eq('org_id', org)
    .eq('project_id', id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ schemaReady: false, assets: [] });
    log.error('list failed', { id, error: errorMessage(error) });
    return json(500, 'Could not list files');
  }
  const assets = ((data ?? []) as OrgAssetRow[]).filter((row) => canReadOrgAsset(access.capabilities, row)).map(toOrgAssetView);
  return NextResponse.json(
    { schemaReady: true, assets, permissions: orgAssetPermissions(access.capabilities) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, 'Organization files need Supabase.');
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const org = access.object.orgId;

  // PostgREST answers an INSERT into a missing column with a bare 404; a
  // read reports it properly. Check before anything is stored.
  const probe = await admin.from('project_assets').select('id, org_id, sensitivity').eq('project_id', id).limit(1);
  if (probe.error && isMissingSchema(probe.error)) return notReady().res;

  let fileName: string;
  let kind: OrgAssetKind;
  let sensitivity: AssetSensitivity;
  let label: string | undefined;
  let url: string;
  let mime: string;
  let size: number;
  let storedHere = false;

  try {
    const type = req.headers.get('content-type') ?? '';
    if (type.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!form || !(file instanceof File)) return json(400, 'No file provided');
      if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
        return json(413, 'Files over 4 MB upload directly to storage — request a presigned upload.');
      }
      const fields = OrgAssetFormFieldsSchema.safeParse({
        kind: form.get('kind') ?? undefined,
        label: form.get('label') ?? undefined,
        sensitivity: form.get('sensitivity') ?? undefined,
      });
      if (!fields.success) return json(400, fields.error.issues[0]?.message ?? 'Invalid fields');
      const check = validateAssetFile({ name: file.name, size: file.size }, { org: true });
      if (!check.ok) return json(check.error === 'too-large' ? 413 : 415, assetValidationMessage(check.error, { org: true }));
      fileName = file.name;
      kind = fields.data.kind ?? guessOrgAssetKind(fileName);
      sensitivity = resolveSensitivity(kind, fields.data.sensitivity);
      if (!canWriteOrgAsset(access.capabilities, { kind, sensitivity })) return json(403, 'Forbidden');
      label = fields.data.label;
      mime = check.mime;
      size = file.size;
      url = await storeProjectAsset(Buffer.from(await file.arrayBuffer()), orgAssetObjectKey(org, id, nanoid(16), check.extension), mime);
      storedHere = true;
    } else {
      const parsed = OrgAssetRegisterBodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
      const body = parsed.data;
      if (!orgProjectAssetKeyOf(body.url, org, id, projectAssetBuckets())) {
        return json(400, 'That upload does not belong to this project.');
      }
      // One row per stored object: a replayed register would give two rows
      // one object, and deleting either would break the other.
      const dup = await admin.from('project_assets').select('id').eq('url', body.url).limit(1);
      if (dup.error) throw dup.error;
      if ((dup.data ?? []).length > 0) return json(409, 'That upload is already registered.');
      // From here no row points at the object, so a refusal removes it.
      storedHere = true;
      kind = body.kind ?? guessOrgAssetKind(body.file_name);
      sensitivity = resolveSensitivity(kind, body.sensitivity);
      if (!canWriteOrgAsset(access.capabilities, { kind, sensitivity })) {
        await deleteProjectAssetObject(body.url).catch(() => {});
        return json(403, 'Forbidden');
      }
      const stored = await projectAssetSize(body.url);
      if (stored == null) return json(409, 'The upload did not finish. Try again.');
      const check = validateAssetFile({ name: body.file_name, size: stored }, { org: true });
      if (!check.ok) {
        await deleteProjectAssetObject(body.url).catch(() => {});
        return json(check.error === 'too-large' ? 413 : 415, assetValidationMessage(check.error, { org: true }));
      }
      fileName = body.file_name;
      label = body.label;
      mime = check.mime;
      size = stored;
      url = body.url;
    }

    const { data: last } = await admin
      .from('project_assets')
      .select('position')
      .eq('org_id', org)
      .eq('project_id', id)
      .order('position', { ascending: false })
      .limit(1);
    const position = ((last as Array<{ position: number }> | null)?.[0]?.position ?? -1) + 1;

    const { data, error } = await admin
      .from('project_assets')
      .insert({
        user_id: null,
        org_id: org,
        created_by: access.userId,
        project_id: id,
        kind,
        sensitivity,
        label: label?.trim() || defaultAssetLabel(fileName),
        file_name: fileName.split(/[\\/]/).pop()!.slice(0, 300),
        url,
        mime,
        size_bytes: size,
        position,
        in_portal: false,
        portal_at: null,
      })
      .select(ORG_ASSET_COLUMNS)
      .single();
    if (error) {
      if (storedHere) await deleteProjectAssetObject(url).catch(() => {});
      if (isMissingSchema(error)) return notReady().res;
      throw error;
    }
    const row = data as OrgAssetRow;
    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'file.uploaded',
      { type: 'asset', id: row.id, projectId: id },
      { kind, sensitivity },
      // A restricted file's existence is business-internal; the rest is
      // creative-side work the project's artist may see (D5).
      { visibility: sensitivity === 'restricted' ? 'internal' : 'artist' },
    );
    return NextResponse.json({ asset: toOrgAssetView(row) }, { status: 201 });
  } catch (err) {
    log.error('upload failed', { id, error: errorMessage(err) });
    return json(500, 'Upload failed');
  }
}
