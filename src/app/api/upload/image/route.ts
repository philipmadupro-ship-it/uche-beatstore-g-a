import { NextRequest, NextResponse } from 'next/server';
import { deleteUploadedImage, uploadImage, uploadedImageKey } from '@/lib/storage/upload';
import { requireProducer } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';
import { UploadedImageDeleteBodySchema } from '@/lib/contracts';
import { imageUploadErrorMessage, matchesImageSignature, validateImageUpload } from '@/lib/upload/image-validation';
const log = createLogger('api.upload.image');

export const runtime = 'nodejs';

/**
 * POST /api/upload/image
 *
 * Used by project / track / playlist cover uploaders. Pre-fix this route:
 *  - had no auth gate (any visitor could fill the bucket)
 *  - had no MIME or size validation (any file accepted as "image")
 *  - piggybacked on uploadAudio() and dumped images into the `tracks/` path
 *
 * The PATCH call that wires `cover_url` onto the parent row still lives on
 * the client. We return a richer error shape so the caller can show a
 * toast and skip the PATCH when the upload itself fails.
 */
export async function POST(req: NextRequest) {
  try {
    // Producer only: buyers sign in through the same Supabase auth, and this
    // writes to the PUBLIC bucket — "authenticated" would let any buyer host
    // files on the producer's R2. The row PATCH that follows is owner-gated.
    const auth = await requireProducer();
    if (!auth.ok) return auth.res;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }
    const validation = validateImageUpload(file);
    if (!validation.ok) {
      const status = validation.error === 'too-large' ? 413 : 415;
      return NextResponse.json({ error: imageUploadErrorMessage(validation.error) }, { status });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // The declared MIME type is client-controlled; check the bytes agree.
    if (!matchesImageSignature(buffer, validation.mimeType)) {
      return NextResponse.json({ error: imageUploadErrorMessage('unsupported-type') }, { status: 415 });
    }

    // Delegate to shared uploadImage — handles R2 vs local fallback,
    // uses the shared r2 client, and sets correct cache headers.
    const url = await uploadImage(buffer, validation.extension, validation.mimeType);
    return NextResponse.json({ success: true, url });
  } catch (error) {
    log.error('Image Upload Error:', { error: errorMessage(error) });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

/**
 * Columns that can hold a URL minted by POST above. DELETE refuses while any
 * of them points at the image — including when the check itself errors (for
 * example a column a pending migration has not added yet): skipping cleanup
 * costs an orphaned object, deleting a live cover costs the producer's art.
 */
const IMAGE_REFERENCES: Array<{ table: string; column: string }> = [
  { table: 'tracks', column: 'cover_url' },
  { table: 'projects', column: 'cover_url' },
  { table: 'playlists', column: 'cover_url' },
  ...['hero_image_url', 'og_image_url', 'logo_url', 'default_artwork_url',
    'default_artwork_project_url', 'default_artwork_playlist_url']
    .map((column) => ({ table: 'creator_profiles', column })),
];

/**
 * DELETE /api/upload/image  { url }
 *
 * Cleanup for an upload whose row PATCH failed, so a failed save does not
 * leave an orphaned object in the public bucket. Only URLs in the exact shape
 * POST returns are accepted, and only while no row references them.
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireProducer();
    if (!auth.ok) return auth.res;

    const parsed = await readBody(req, UploadedImageDeleteBodySchema);
    if (!parsed.ok) return parsed.res;
    const { url } = parsed.data;
    if (!uploadedImageKey(url)) {
      return NextResponse.json({ error: 'Not an uploaded image' }, { status: 400 });
    }

    const checks = await Promise.all(IMAGE_REFERENCES.map(({ table, column }) =>
      // Not owner-filtered on purpose: a reference from ANY row blocks deletion.
      auth.admin.from(table).select('*', { head: true, count: 'exact' }).eq(column, url)));
    if (checks.some(({ error, count }) => error || (count ?? 0) > 0)) {
      return NextResponse.json({ error: 'Image is in use' }, { status: 409 });
    }

    await deleteUploadedImage(url);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('Image delete error:', { error: errorMessage(error) });
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
