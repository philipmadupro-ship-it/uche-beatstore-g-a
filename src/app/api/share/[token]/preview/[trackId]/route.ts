import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { verifyShareMediaGrant } from '@/lib/share-media-token';
import { errorMessage } from '@/lib/errors';
import {
  lockableOf,
  resolveShareToken,
  resolvedShareIncludesTrack,
  shareAccessFailure,
  shareGateResponse,
} from '@/lib/share/token-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; trackId: string }> },
) {
  const { token, trackId } = await params;
  const url = new URL(req.url);

  if (!verifyShareMediaGrant(token, trackId, url.searchParams.get('expires'), url.searchParams.get('sig'))) {
    return NextResponse.json({ error: 'Preview grant expired or invalid' }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const admin = createServiceClient();
    const resolved = await resolveShareToken(admin, token, ['project_share', 'share_link', 'paid_access']);
    if (!resolved || !(await resolvedShareIncludesTrack(admin, resolved, trackId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // The HMAC grant above was minted after the share page passed the
    // password gate; <audio> cannot resend the header.
    const failure = await shareAccessFailure(lockableOf(resolved), { password: '', checkPassword: false });
    if (failure) return shareGateResponse(failure);

    const { data: track } = await admin
      .from('tracks')
      .select('preview_url, audio_url')
      .eq('id', trackId)
      .maybeSingle();
    const source = track?.preview_url || track?.audio_url;
    if (!source) {
      return NextResponse.json({ error: 'Preview unavailable' }, { status: 404 });
    }

    return streamAudioPreviewSource(req, source);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
