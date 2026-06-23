import { NextRequest, NextResponse } from 'next/server';
import { abortMultipart } from '@/lib/storage/multipart';
import { getSession, markStatus, deleteSession } from '@/lib/storage/upload-sessions';
import { requireUploadSessionOwner } from '@/lib/storage/upload-session-auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId: string = body.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    const s = await getSession(sessionId);
    if (!s) return NextResponse.json({ ok: true, alreadyGone: true });
    const owner = await requireUploadSessionOwner(s);
    if (!owner.ok) return owner.res;

    try {
      await abortMultipart({ uploadId: s.uploadId, key: s.key });
    } catch (err) {
      console.warn('abortMultipart failed (may already be gone):', err);
    }
    await markStatus(sessionId, 'aborted');
    await deleteSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('upload/abort error:', err);
    return NextResponse.json({ error: err?.message || 'abort failed' }, { status: 500 });
  }
}
