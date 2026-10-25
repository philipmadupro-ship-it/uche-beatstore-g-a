import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PortalUploadFormFieldsSchema, PortalUploadRegisterBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortalUpload } from '@/lib/artist-portal/upload-gate';
import { buildPortalUploadNotification } from '@/lib/artist-portal/uploads';
import { toPortalFile } from '@/lib/artist-portal/view';
import { isSchemaNotReady } from '@/lib/artists/http';
import {
  assetObjectKey,
  assetValidationMessage,
  defaultAssetLabel,
  guessAssetKind,
  MAX_DIRECT_UPLOAD_BYTES,
  projectAssetKeyOf,
  validateAssetFile,
} from '@/lib/projects/assets';
import { deleteProjectAssetObject, privateProjectAssetRef, projectAssetBuckets, projectAssetSize, storeProjectAsset } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.files.upload');

function notReady() {
  // Before migration 191 no link can have uploads on, so this is only reached
  // in the window between a deploy and the migration. Same answer as outside
  // the portal: nothing to see.
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

/**
 * POST /api/portal/[token]/files — a contact uploads their own file into a
 * project of their portal (PORTAL-UP, mig 191):
 *   multipart  file + project_id + label?        (up to 4 MB, through the server)
 *   JSON       { project_id, upload_id, file_name, label? } after ./presign
 *
 * Public by token (`/api/portal/` is on the api-gate allowlist); every check
 * is here. Gate, then membership: a project outside this portal is 404, one
 * inside with uploads off 403 (lib/artist-portal/upload-gate). The file
 * rules are the producer's (extension allowlist, the allowlist's MIME, the
 * private bucket, `.html` / `.svg` refused). The row is the producer's
 * (`user_id` = the portal owner), credited to the contact, and in the portal
 * so the artist sees what they sent. The producer gets a notification and a
 * timeline row; neither failing costs the artist the upload.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalupload-ip:${clientIp(req)}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const admin = createServiceClient();
  let storedUrl: string | null = null;
  try {
    let projectId: string;
    let fileName: string;
    let label: string | undefined;
    let mime: string;
    let size: number;
    let url: string;

    const type = req.headers.get('content-type') ?? '';
    if (type.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!form || !(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      const fields = PortalUploadFormFieldsSchema.safeParse({
        project_id: form.get('project_id') ?? undefined,
        label: form.get('label') ?? undefined,
      });
      if (!fields.success) return NextResponse.json({ error: fields.error.issues[0]?.message ?? 'Invalid fields' }, { status: 400 });
      projectId = fields.data.project_id;
      const gate = await gatePortalUpload(admin, token, req, projectId);
      if (!gate.ok) return gate.res;
      if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Files over 4 MB upload directly to storage — request a presigned upload.' }, { status: 413 });
      }
      const check = validateAssetFile({ name: file.name, size: file.size });
      if (!check.ok) return NextResponse.json({ error: assetValidationMessage(check.error) }, { status: check.error === 'too-large' ? 413 : 415 });
      fileName = file.name;
      label = fields.data.label;
      mime = check.mime;
      size = file.size;
      url = await storeProjectAsset(Buffer.from(await file.arrayBuffer()), assetObjectKey(projectId, nanoid(16), check.extension), mime);
      storedUrl = url;
      return await finish(admin, gate.portal, { projectId, fileName, label, mime, size, url });
    }

    const parsed = PortalUploadRegisterBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
    const body = parsed.data;
    projectId = body.project_id;
    const gate = await gatePortalUpload(admin, token, req, projectId);
    if (!gate.ok) return gate.res;
    // The reference is rebuilt here, inside THIS project's folder of the
    // private bucket — the shape ./presign mints — never taken from the client.
    const [uploadKeyId, uploadExt] = body.upload_id.split('.');
    const ref = privateProjectAssetRef(assetObjectKey(projectId, uploadKeyId, uploadExt));
    if (!ref || !projectAssetKeyOf(ref, projectId, projectAssetBuckets())) {
      return NextResponse.json({ error: 'That upload does not belong to this project.' }, { status: 400 });
    }
    const stored = await projectAssetSize(ref);
    if (stored == null) return NextResponse.json({ error: 'The upload did not finish. Try again.' }, { status: 409 });
    // A key can be registered once: a second row would let a link that lost
    // uploads re-attach an old object.
    const { data: dup, error: dupErr } = await admin.from('project_assets').select('id').eq('url', ref).limit(1);
    if (dupErr) throw dupErr;
    if ((dup ?? []).length > 0) return NextResponse.json({ error: 'That upload is already registered.' }, { status: 409 });
    const check = validateAssetFile({ name: body.file_name, size: stored });
    if (!check.ok) {
      await deleteProjectAssetObject(ref).catch(() => {});
      return NextResponse.json({ error: assetValidationMessage(check.error) }, { status: check.error === 'too-large' ? 413 : 415 });
    }
    fileName = body.file_name;
    label = body.label;
    mime = check.mime;
    size = stored;
    url = ref;
    storedUrl = url;
    return await finish(admin, gate.portal, { projectId, fileName, label, mime, size, url });
  } catch (err) {
    if (storedUrl) await deleteProjectAssetObject(storedUrl).catch(() => {});
    if (isSchemaNotReady(err)) return notReady();
    log.error('portal upload failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

async function finish(
  admin: ReturnType<typeof createServiceClient>,
  portal: { user_id: string; contact_id: string; token: string },
  f: { projectId: string; fileName: string; label: string | undefined; mime: string; size: number; url: string },
): Promise<NextResponse> {
  const ownerId = portal.user_id;
  const { data: last } = await admin
    .from('project_assets')
    .select('position')
    .eq('project_id', f.projectId)
    .eq('user_id', ownerId)
    .order('position', { ascending: false })
    .limit(1);
  const position = ((last as Array<{ position: number }> | null)?.[0]?.position ?? -1) + 1;
  const now = new Date().toISOString();
  const baseName = f.fileName.split(/[\\/]/).pop()!.slice(0, 300);
  const label = f.label?.trim() || defaultAssetLabel(baseName);

  const { data, error } = await admin
    .from('project_assets')
    .insert({
      user_id: ownerId,
      project_id: f.projectId,
      kind: guessAssetKind(baseName),
      label,
      file_name: baseName,
      url: f.url,
      mime: f.mime,
      size_bytes: f.size,
      position,
      in_portal: true,
      portal_at: now,
      uploaded_by_contact_id: portal.contact_id,
    })
    .select('id, project_id, kind, label, file_name, mime, size_bytes')
    .single();
  if (error) throw error;
  const asset = data as { id: string; project_id: string; kind: string; label: string; file_name: string; mime: string | null; size_bytes: number | null };

  // Tell the producer. Best-effort: the file is saved.
  const [contactRes, projectRes] = await Promise.all([
    admin.from('contacts').select('name').eq('id', portal.contact_id).eq('user_id', ownerId).maybeSingle(),
    admin.from('projects').select('name').eq('id', f.projectId).eq('user_id', ownerId).maybeSingle(),
  ]);
  const contactName = (contactRes.data as { name?: string | null } | null)?.name ?? '';
  const projectName = (projectRes.data as { name?: string | null } | null)?.name ?? null;
  const note = buildPortalUploadNotification({
    ownerId, contactId: portal.contact_id, contactName, projectId: f.projectId, projectName, assetId: asset.id, label: asset.label,
  });
  const [nRes, aRes] = await Promise.all([
    admin.from('notifications').insert(note),
    admin.from('contact_activity').insert({
      contact_id: portal.contact_id,
      user_id: ownerId,
      kind: 'file_uploaded',
      title: `Uploaded ${asset.label} to ${projectName?.trim() || 'a project'}`,
      metadata: { asset_id: asset.id, project_id: f.projectId, source: 'portal' },
    }),
  ]);
  if (nRes.error) log.warn('upload notification failed', { error: errorMessage(nRes.error) });
  if (aRes.error) log.warn('upload timeline row failed', { error: errorMessage(aRes.error) });

  return NextResponse.json(
    { file: toPortalFile(asset, { token: portal.token, isNew: false, fromYou: true }) },
    { status: 201, headers: { 'cache-control': 'private, no-store' } },
  );
}
