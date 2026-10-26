/**
 * The three part handlers of a multipart upload — sign (POST), confirm a
 * direct PUT (PATCH), proxy a part (PUT) — shared by the producer's
 * `/api/upload/part` and the org's `/api/org/[orgId]/upload/part` (LABEL-14).
 * Only who may touch a session differs, so that is the one parameter:
 * `authorize` runs after the session is found and before anything is signed,
 * recorded or written. Moved here verbatim from the producer route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUploadPartUrl, uploadPart } from '@/lib/storage/multipart';
import { getSession, recordPart, type UploadSession } from '@/lib/storage/upload-sessions';
import { errorMessage } from '@/lib/errors';

export type AuthorizeUploadSession = (
  session: UploadSession,
) => Promise<{ ok: true } | { ok: false; res: NextResponse }>;

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

/** Most parts one signing request may cover (a 500 MiB file is ~63 parts). */
const MAX_BATCH_PARTS = 200;

/**
 * Returns a short-lived R2 URL. Audio bytes then travel browser -> R2.
 *
 * `partNumbers: number[]` signs a whole file's parts in ONE request. Signing
 * is a local computation, but each request still pays a session lookup and a
 * Supabase auth check, and the browser used to make one per part, in series
 * with the PUT it was waiting to send.
 */
export async function handlePartSign(req: NextRequest, authorize: AuthorizeUploadSession) {
  try {
    const body = await req.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (Array.isArray(body.partNumbers)) return signBatch(sessionId, body.partNumbers, authorize);
    const partNumber = validatePartNumber(body.partNumber);
    if (!sessionId || !partNumber) {
      return NextResponse.json({ error: 'sessionId and valid partNumber required' }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: `session ${session.status}` }, { status: 409 });
    }
    const owner = await authorize(session);
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

async function signBatch(sessionId: string, requested: unknown[], authorize: AuthorizeUploadSession) {
  const partNumbers = Array.from(new Set(requested.map(validatePartNumber)));
  if (!sessionId || partNumbers.length === 0 || partNumbers.length > MAX_BATCH_PARTS || partNumbers.includes(null)) {
    return NextResponse.json({ error: 'sessionId and 1-200 valid partNumbers required' }, { status: 400 });
  }
  const session = await getSession(sessionId);
  if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
  if (session.status !== 'in_progress') {
    return NextResponse.json({ error: `session ${session.status}` }, { status: 409 });
  }
  const owner = await authorize(session);
  if (!owner.ok) return owner.res;
  if (partNumbers.some((n) => (n as number) > session.totalParts)) {
    return NextResponse.json({ error: 'part number exceeds total parts' }, { status: 400 });
  }

  const urls: Record<number, string> = {};
  for (const n of partNumbers as number[]) {
    const url = await getUploadPartUrl({ uploadId: session.uploadId, key: session.key, partNumber: n });
    if (url) urls[n] = url;
  }
  // Empty `urls` means R2 is not configured: the caller proxies each part.
  return NextResponse.json({ direct: Object.keys(urls).length > 0, urls, expiresIn: 15 * 60 });
}

/**
 * Records the ETag returned by R2 after a direct browser upload.
 */
export async function handlePartConfirm(req: NextRequest, authorize: AuthorizeUploadSession) {
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
    const owner = await authorize(session);
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
export async function handlePartProxy(req: NextRequest, authorize: AuthorizeUploadSession) {
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
    const owner = await authorize(session);
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
  } catch (err: unknown) {
    console.error('upload/part error:', err);
    return NextResponse.json({ error: errorMessage(err) || 'part upload failed' }, { status: 500 });
  }
}
