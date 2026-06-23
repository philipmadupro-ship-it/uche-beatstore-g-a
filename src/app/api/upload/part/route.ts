import { NextRequest, NextResponse } from 'next/server';
import { getUploadPartUrl, uploadPart } from '@/lib/storage/multipart';
import { getSession, recordPart } from '@/lib/storage/upload-sessions';
import { requireUploadSessionOwner } from '@/lib/storage/upload-session-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

function validatePartNumber(value: unknown): number | null {
  const partNumber = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isInteger(partNumber) && partNumber >= 1 ? partNumber : null;
}

function expectedPartSize(session: {
  fileSize: number;
  partSize: number;
  totalParts: number;
}, partNumber: number): number {
  return partNumber === session.totalParts
    ? session.fileSize - (session.totalParts - 1) * session.partSize
    : session.partSize;
}

/**
 * Returns a short-lived R2 URL. Audio bytes then travel browser -> R2.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const partNumber = validatePartNumber(body.partNumber);
    if (!sessionId || !partNumber) {
      return NextResponse.json({ error: 'sessionId and valid partNumber required' }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: `session ${session.status}` }, { status: 409 });
    }
    const owner = await requireUploadSessionOwner(session);
    if (!owner.ok) return owner.res;
    if (partNumber > session.totalParts) {
      return NextResponse.json({ error: 'part number exceeds total parts' }, { status: 400 });
    }

    const url = await getUploadPartUrl({
      uploadId: session.uploadId,
      key: session.key,
      partNumber,
    });
    return NextResponse.json({
      direct: Boolean(url),
      url,
      expectedSize: expectedPartSize(session, partNumber),
      expiresIn: url ? 15 * 60 : null,
    });
  } catch (err) {
    console.error('upload/part sign error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'part signing failed' }, { status: 500 });
  }
}

/**
 * Records the ETag returned by R2 after a direct browser upload.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const partNumber = validatePartNumber(body.partNumber);
    const etag = typeof body.etag === 'string' ? body.etag.trim() : '';
    const size = Number(body.size);
    if (!sessionId || !partNumber || !etag || !Number.isInteger(size) || size <= 0) {
      return NextResponse.json({ error: 'sessionId, partNumber, etag, and size required' }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: `session ${session.status}` }, { status: 409 });
    }
    const owner = await requireUploadSessionOwner(session);
    if (!owner.ok) return owner.res;
    if (partNumber > session.totalParts) {
      return NextResponse.json({ error: 'part number exceeds total parts' }, { status: 400 });
    }
    if (size !== expectedPartSize(session, partNumber)) {
      return NextResponse.json({ error: 'invalid part size' }, { status: 400 });
    }

    const updated = await recordPart(sessionId, {
      PartNumber: partNumber,
      ETag: etag,
      Size: size,
    });
    return NextResponse.json({
      ok: true,
      partNumber,
      etag,
      received: updated?.parts.length ?? 0,
      totalParts: session.totalParts,
    });
  } catch (err) {
    console.error('upload/part confirm error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'part confirmation failed' }, { status: 500 });
  }
}

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
    const partNumber = validatePartNumber(partHeader);
    if (!partNumber) {
      return NextResponse.json({ error: 'invalid part number' }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    }
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: `session ${session.status}` }, { status: 409 });
    }
    const owner = await requireUploadSessionOwner(session);
    if (!owner.ok) return owner.res;
    if (partNumber > session.totalParts) {
      return NextResponse.json({ error: 'part number exceeds total parts' }, { status: 400 });
    }

    const ab = await req.arrayBuffer();
    const body = Buffer.from(ab);
    if (body.length === 0) {
      return NextResponse.json({ error: 'empty part' }, { status: 400 });
    }
    if (body.length !== expectedPartSize(session, partNumber)) {
      return NextResponse.json({ error: 'invalid final part size' }, { status: 400 });
    }

    const part = await uploadPart({
      uploadId: session.uploadId,
      key: session.key,
      partNumber,
      body,
    });

    const updated = await recordPart(sessionId, part);
    return NextResponse.json({
      ok: true,
      partNumber: part.PartNumber,
      etag: part.ETag,
      received: updated?.parts.length ?? 0,
      totalParts: session.totalParts,
    });
  } catch (err: any) {
    console.error('upload/part error:', err);
    return NextResponse.json({ error: err?.message || 'part upload failed' }, { status: 500 });
  }
}
