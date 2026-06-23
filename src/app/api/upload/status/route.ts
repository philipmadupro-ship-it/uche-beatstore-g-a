import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/storage/upload-sessions';
import { listParts } from '@/lib/storage/multipart';
import { requireUploadSessionOwner } from '@/lib/storage/upload-session-auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }
  const s = await getSession(sessionId);
  if (!s) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
  const owner = await requireUploadSessionOwner(s);
  if (!owner.ok) return owner.res;

  // Reconcile with backend in case server restarted mid-upload
  let parts = s.parts;
  try {
    const remote = await listParts({ uploadId: s.uploadId, key: s.key });
    if (remote.length > parts.length) parts = remote;
  } catch {
    // R2 list may fail if upload was aborted — fall through with cached parts
  }

  return NextResponse.json({
    sessionId: s.sessionId,
    fileName: s.fileName,
    fileSize: s.fileSize,
    partSize: s.partSize,
    totalParts: s.totalParts,
    completedPartNumbers: parts.map((p) => p.PartNumber).sort((a, b) => a - b),
    status: s.status,
  });
}
