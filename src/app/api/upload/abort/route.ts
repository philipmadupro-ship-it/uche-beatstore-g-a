import { NextRequest, NextResponse } from 'next/server';
import { abortMultipart } from '@/lib/storage/multipart';
import { getSession, markStatus, deleteSession } from '@/lib/storage/upload-sessions';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.upload.abort');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId: string = body.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    const s = getSession(sessionId);
    if (!s) return NextResponse.json({ ok: true, alreadyGone: true });

    try {
      await abortMultipart({ uploadId: s.uploadId, key: s.key });
    } catch (err) {
      log.warn('abortMultipart failed (may already be gone):', { error: errorMessage(err) });
    }
    markStatus(sessionId, 'aborted');
    deleteSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    log.error('upload/abort error:', { error: errorMessage(err) });
    return NextResponse.json({ error: err?.message || 'abort failed' }, { status: 500 });
  }
}
