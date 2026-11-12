import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { PortalUploadPresignBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortalUpload } from '@/lib/artist-portal/upload-gate';
import { isSchemaNotReady } from '@/lib/artists/http';
import { assetObjectKey, assetValidationMessage, validateAssetFile } from '@/lib/projects/assets';
import { presignProjectAssetPut } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.files.presign');

/**
 * POST /api/portal/[token]/files/presign  { project_id, file_name, size_bytes }
 *   → { uploadUrl, uploadId, contentType }
 *
 * A contact's file too big to pass through the app server goes straight to
 * the PRIVATE bucket on a 15-minute presigned PUT, then is registered with
 * POST ../files { project_id, upload_id, file_name }. Same gate and membership as
 * that route; the key is minted here inside the project's own folder.
 * Without R2 there is nothing to presign: 501, and the client uploads
 * through the server.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalpresign-ip:${clientIp(req)}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const parsed = await readBody(req, PortalUploadPresignBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const admin = createServiceClient();
    const gate = await gatePortalUpload(admin, token, req, parsed.data.project_id, 'presign');
    if (!gate.ok) return gate.res;
    const check = validateAssetFile({ name: parsed.data.file_name, size: parsed.data.size_bytes });
    if (!check.ok) return NextResponse.json({ error: assetValidationMessage(check.error) }, { status: check.error === 'too-large' ? 413 : 415 });
    const uploadId = nanoid(16);
    const signed = await presignProjectAssetPut(assetObjectKey(parsed.data.project_id, uploadId, check.extension), check.mime);
    if (!signed) return NextResponse.json({ error: 'Direct uploads need R2 storage.' }, { status: 501 });
    // The stored reference stays on the server: the client gets the PUT URL
    // and an opaque id to register with.
    return NextResponse.json({ uploadUrl: signed.uploadUrl, uploadId: `${uploadId}.${check.extension}`, contentType: check.mime }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    log.error('portal presign failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 });
  }
}
