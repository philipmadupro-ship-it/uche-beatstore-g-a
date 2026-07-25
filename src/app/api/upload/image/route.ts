import { NextRequest, NextResponse } from 'next/server';
import { uploadImage } from '@/lib/storage/upload';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { imageUploadErrorMessage, validateImageUpload } from '@/lib/upload/image-validation';
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
    // Auth: prevents drive-by writes from anonymous clients. We don't need
    // the user_id on the upload itself — the row PATCH that follows is
    // already owner-gated.
    const auth = await requireUser();
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

    // Delegate to shared uploadImage — handles R2 vs local fallback,
    // uses the shared r2 client, and sets correct cache headers.
    const url = await uploadImage(buffer, validation.extension, validation.mimeType);
    return NextResponse.json({ success: true, url });
  } catch (error) {
    log.error('Image Upload Error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) || 'Upload failed' }, { status: 500 });
  }
}
