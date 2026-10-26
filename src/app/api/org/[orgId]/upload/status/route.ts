/**
 * GET /api/org/[orgId]/upload/status?sessionId= (LABEL-14) — which parts of
 * an org upload are already stored, so the uploads tray can resume one after
 * a reload. Same as the producer's `/api/upload/status`, behind the org
 * session gate (../access).
 */
import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { listParts } from '@/lib/storage/multipart';
import { getSession } from '@/lib/storage/upload-sessions';
import { requireUploadActor } from '@/lib/auth/org-access';
import { orgSessionAuthorizer } from '../access';

export const runtime = 'nodejs';

const log = createLogger('api.org.upload.status');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const access = await requireUploadActor(orgId);
  if (!access.ok) return access.res;
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId || sessionId.length > 64) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  try {
    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    const gate = await orgSessionAuthorizer(access)(session);
    if (!gate.ok) return gate.res;

    let parts = session.parts;
    try {
      const remote = await listParts({ uploadId: session.uploadId, key: session.key });
      if (remote.length > parts.length) parts = remote;
    } catch {
      // An aborted upload cannot be listed; fall back to the recorded parts.
    }
    return NextResponse.json({
      sessionId: session.sessionId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      partSize: session.partSize,
      totalParts: session.totalParts,
      completedPartNumbers: parts.map((p) => p.PartNumber).sort((a, b) => a - b),
      status: session.status,
    });
  } catch (err) {
    log.error('org upload status failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'status failed' }, { status: 500 });
  }
}
