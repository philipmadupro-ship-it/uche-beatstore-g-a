/**
 * POST /api/org/[orgId]/upload/init (LABEL-14) — start a chunked audio upload
 * into an org: `{ fileName, fileSize, fileType?, as }`, where `as` is a new
 * song for a roster artist or material for an org song
 * (lib/labelos/org-upload). The producer's `/api/upload/init` is unchanged;
 * this route uses the same multipart helpers and file rules, and differs in
 * three ways:
 *   - who: `catalog.write` on the target artist / song, in scope (./access);
 *   - where: the master's key is `orgs/<org>/tracks/…` in the private bucket,
 *     which also binds the session to this org;
 *   - what: the track type follows from the intent; the client never names
 *     a type, a destination project or a track to replace.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireOrgMember } from '@/lib/auth/org-access';
import { OrgUploadInitSchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { orgUploadKeyPrefix, orgUploadTrackFields } from '@/lib/labelos/org-upload';
import { createLogger } from '@/lib/log';
import { abortMultipart, initMultipart } from '@/lib/storage/multipart';
import { createSession } from '@/lib/storage/upload-sessions';
import { audioUploadProblem, detectContentType, pickPartSize } from '@/lib/upload/audio-rules';
import { authorizeOrgUploadIntent } from '../access';

export const runtime = 'nodejs';
export const maxDuration = 30;

const log = createLogger('api.org.upload.init');

type Params = { params: Promise<{ orgId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = OrgUploadInitSchema.safeParse(raw);
  if (!parsed.success) {
    // Not a member: 403 before the body is described to them.
    const member = await requireOrgMember(orgId);
    if (!member.ok) return member.res;
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
  }
  const body = parsed.data;

  const intent = await authorizeOrgUploadIntent(orgId, body.as);
  if (!intent.ok) return intent.res;
  const { access } = intent;

  const problem = audioUploadProblem(body.fileName, body.fileSize);
  if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });

  try {
    const ext = (body.fileName.split('.').pop() || '').toLowerCase();
    const contentType = detectContentType(ext, body.fileType ?? '');
    const partSize = pickPartSize(body.fileSize);
    const totalParts = Math.ceil(body.fileSize / partSize);

    const { uploadId, key } = await initMultipart(body.fileName, contentType, { keyPrefix: orgUploadKeyPrefix(access.orgId) });
    const sessionId = nanoid(16);
    try {
      await createSession({
        sessionId,
        uploadId,
        key,
        fileName: body.fileName,
        fileSize: body.fileSize,
        contentType,
        partSize,
        totalParts,
        type: orgUploadTrackFields(body.as).type,
        projectId: null,
        replaceTrackId: null,
        userId: access.userId,
      });
    } catch (err) {
      await abortMultipart({ uploadId, key }).catch(() => undefined);
      throw err;
    }
    return NextResponse.json({ sessionId, partSize, totalParts, uploadId });
  } catch (err) {
    log.error('org upload init failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Failed to start the upload' }, { status: 500 });
  }
}
