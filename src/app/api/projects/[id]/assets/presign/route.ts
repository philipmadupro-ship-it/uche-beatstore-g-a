import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectAssetPresignBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { assetObjectKey, assetValidationMessage, validateAssetFile } from '@/lib/projects/assets';
import { presignProjectAssetPut } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.assets.presign');

/**
 * POST /api/projects/[id]/assets/presign  { file_name, size_bytes }
 *   → { uploadUrl, url, contentType }
 *
 * A file too big to pass through the app server (Vercel caps bodies at
 * ~4.5 MB) is PUT straight to the private bucket, then registered with
 * POST ../assets { url, … }. The key is minted here, inside this project's
 * folder, and the register step refuses any other key. Without R2 there is
 * nothing to presign: 501, and the client uploads through the server.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Project files need Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;

  const parsed = await readBody(req, ProjectAssetPresignBodySchema);
  if (!parsed.ok) return parsed.res;
  const check = validateAssetFile({ name: parsed.data.file_name, size: parsed.data.size_bytes });
  if (!check.ok) return NextResponse.json({ error: assetValidationMessage(check.error) }, { status: check.error === 'too-large' ? 413 : 415 });

  try {
    const signed = await presignProjectAssetPut(assetObjectKey(id, nanoid(16), check.extension), check.mime);
    if (!signed) return NextResponse.json({ error: 'Direct uploads need R2 storage.' }, { status: 501 });
    return NextResponse.json({ ...signed, contentType: check.mime });
  } catch (err) {
    log.error('presign failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 });
  }
}
