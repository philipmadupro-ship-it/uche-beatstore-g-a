/**
 * POST /api/org/[orgId]/upload/abort (LABEL-14) — drop an org upload session
 * and its multipart upload. Same as the producer's `/api/upload/abort`, behind
 * the org session gate (../access).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { OrgUploadSessionSchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { abortMultipart } from '@/lib/storage/multipart';
import { deleteSession, getSession, markStatus } from '@/lib/storage/upload-sessions';
import { orgSessionAuthorizer } from '../access';

export const runtime = 'nodejs';

const log = createLogger('api.org.upload.abort');

type Params = { params: Promise<{ orgId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.write');
  if (!access.ok) return access.res;
  const parsed = OrgUploadSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  try {
    const session = await getSession(parsed.data.sessionId);
    if (!session) return NextResponse.json({ ok: true, alreadyGone: true });
    const gate = await orgSessionAuthorizer(access)(session);
    if (!gate.ok) return gate.res;
    try {
      await abortMultipart({ uploadId: session.uploadId, key: session.key });
    } catch (err) {
      log.warn('abortMultipart failed (may already be gone)', { error: errorMessage(err) });
    }
    await markStatus(session.sessionId, 'aborted');
    await deleteSession(session.sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('org upload abort failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'abort failed' }, { status: 500 });
  }
}
