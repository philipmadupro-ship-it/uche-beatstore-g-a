import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { ProjectAssetFormFieldsSchema, ProjectAssetRegisterBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import {
  assetObjectKey,
  assetValidationMessage,
  defaultAssetLabel,
  guessAssetKind,
  MAX_DIRECT_UPLOAD_BYTES,
  projectAssetKeyOf,
  validateAssetFile,
  type ProjectAssetKind,
} from '@/lib/projects/assets';
import { PROJECT_ASSET_COLUMNS, toProjectAssetView, type ProjectAssetRow } from '@/lib/projects/asset-view';
import { deleteProjectAssetObject, projectAssetBuckets, projectAssetSize, storeProjectAsset } from '@/lib/storage/project-assets';
import { isMissingSchema } from '@/lib/artists/workspace-load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.assets');

function notReady() {
  return NextResponse.json(
    { error: 'Project files need migration 127 applied on Supabase.', migration: '127', schemaReady: false },
    { status: 503 },
  );
}

/**
 * GET  /api/projects/[id]/assets — the project's files (no storage reference).
 * POST /api/projects/[id]/assets — add one:
 *   multipart  file + kind? + label? + in_portal?  (up to 4 MB, through the server)
 *   JSON       { url, file_name, kind?, label?, in_portal? } after a presigned PUT
 *              (see ./presign). The reference must be an object this project's
 *              presign issued, and it must exist.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, assets: [] });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;

  const { data, error } = await auth.admin
    .from('project_assets')
    .select(PROJECT_ASSET_COLUMNS)
    .eq('project_id', id)
    .eq('user_id', auth.userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ schemaReady: false, assets: [] });
    log.error('list failed', { id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ schemaReady: true, assets: ((data ?? []) as ProjectAssetRow[]).map(toProjectAssetView) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Project files need Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  // Before migration 127 PostgREST answers an INSERT into the missing table
  // with a bare 404 and an empty body, which nothing can recognise; a read
  // reports it properly. Check first, so nothing is stored for a row that
  // cannot be written.
  const probe = await admin.from('project_assets').select('id').eq('project_id', id).limit(1);
  if (probe.error && isMissingSchema(probe.error)) return notReady();

  let fileName: string;
  let kind: ProjectAssetKind | undefined;
  let label: string | undefined;
  let inPortal: boolean;
  let url: string;
  let mime: string;
  let size: number;
  let storedHere = false;

  try {
    const type = req.headers.get('content-type') ?? '';
    if (type.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!form || !(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Files over 4 MB upload directly to storage — request a presigned upload.' }, { status: 413 });
      }
      const fields = ProjectAssetFormFieldsSchema.safeParse({
        kind: form.get('kind') ?? undefined,
        label: form.get('label') ?? undefined,
        in_portal: form.get('in_portal') ?? undefined,
      });
      if (!fields.success) return NextResponse.json({ error: fields.error.issues[0]?.message ?? 'Invalid fields' }, { status: 400 });
      const check = validateAssetFile({ name: file.name, size: file.size });
      if (!check.ok) return NextResponse.json({ error: assetValidationMessage(check.error) }, { status: check.error === 'too-large' ? 413 : 415 });
      fileName = file.name;
      ({ kind, label } = fields.data);
      inPortal = fields.data.in_portal ?? false;
      mime = check.mime;
      size = file.size;
      url = await storeProjectAsset(Buffer.from(await file.arrayBuffer()), assetObjectKey(id, nanoid(16), check.extension), mime);
      storedHere = true;
    } else {
      const parsed = ProjectAssetRegisterBodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
      const body = parsed.data;
      if (!projectAssetKeyOf(body.url, id, projectAssetBuckets())) {
        return NextResponse.json({ error: 'That upload does not belong to this project.' }, { status: 400 });
      }
      const stored = await projectAssetSize(body.url);
      if (stored == null) return NextResponse.json({ error: 'The upload did not finish. Try again.' }, { status: 409 });
      const check = validateAssetFile({ name: body.file_name, size: stored });
      if (!check.ok) {
        await deleteProjectAssetObject(body.url).catch(() => {});
        return NextResponse.json({ error: assetValidationMessage(check.error) }, { status: check.error === 'too-large' ? 413 : 415 });
      }
      fileName = body.file_name;
      kind = body.kind;
      label = body.label;
      inPortal = body.in_portal;
      mime = check.mime;
      size = stored;
      url = body.url;
    }

    const { data: last } = await admin
      .from('project_assets')
      .select('position')
      .eq('project_id', id)
      .eq('user_id', userId)
      .order('position', { ascending: false })
      .limit(1);
    const position = ((last as Array<{ position: number }> | null)?.[0]?.position ?? -1) + 1;
    const now = new Date().toISOString();

    const { data, error } = await admin
      .from('project_assets')
      .insert({
        user_id: userId,
        project_id: id,
        kind: kind ?? guessAssetKind(fileName),
        label: label?.trim() || defaultAssetLabel(fileName),
        file_name: fileName.split(/[\\/]/).pop()!.slice(0, 300),
        url,
        mime,
        size_bytes: size,
        position,
        in_portal: inPortal,
        portal_at: inPortal ? now : null,
      })
      .select(PROJECT_ASSET_COLUMNS)
      .single();
    if (error) {
      if (storedHere) await deleteProjectAssetObject(url).catch(() => {});
      if (isMissingSchema(error)) return notReady();
      throw error;
    }
    return NextResponse.json({ asset: toProjectAssetView(data as ProjectAssetRow) }, { status: 201 });
  } catch (err) {
    log.error('upload failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
