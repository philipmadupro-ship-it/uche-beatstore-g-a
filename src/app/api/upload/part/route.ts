import { NextRequest, NextResponse } from 'next/server';
import { uploadPart } from '@/lib/storage/multipart';
import { getSession, recordPart } from '@/lib/storage/upload-sessions';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.upload.part');

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Receives a single part for an existing session. Body is the raw chunk bytes.
 * Headers carry the metadata so we never have to copy the chunk into a FormData
 * boundary (faster + smaller).
 *
 * Required headers:
 *   x-session-id: string
 *   x-part-number: 1-based integer
 */
export async function PUT(req: NextRequest) {
  try {
    const sessionId = req.headers.get('x-session-id');
    const partHeader = req.headers.get('x-part-number');
    if (!sessionId || !partHeader) {
      return NextResponse.json({ error: 'missing headers' }, { status: 400 });
    }
    const partNumber = parseInt(partHeader, 10);
    if (!Number.isFinite(partNumber) || partNumber < 1) {
      return NextResponse.json({ error: 'invalid part number' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    }
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: `session ${session.status}` }, { status: 409 });
    }

    const ab = await req.arrayBuffer();
    const body = Buffer.from(ab);
    if (body.length === 0) {
      return NextResponse.json({ error: 'empty part' }, { status: 400 });
    }

    const part = await uploadPart({
      uploadId: session.uploadId,
      key: session.key,
      partNumber,
      body,
    });

    const updated = recordPart(sessionId, part);
    return NextResponse.json({
      ok: true,
      partNumber: part.PartNumber,
      etag: part.ETag,
      received: updated?.parts.length ?? 0,
      totalParts: session.totalParts,
    });
  } catch (err: any) {
    log.error('upload/part error:', { error: errorMessage(err) });
    return NextResponse.json({ error: err?.message || 'part upload failed' }, { status: 500 });
  }
}
