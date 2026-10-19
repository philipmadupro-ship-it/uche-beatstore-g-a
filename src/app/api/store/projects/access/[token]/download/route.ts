import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { streamAudioSource } from '@/lib/audio/stream-source';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { recordDownload, shouldLogGrant, type DownloadDenial } from '@/lib/store/download-audit';

const log = createLogger('api.store.projects.access.download');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const trackId = req.nextUrl.searchParams.get('track_id');
  const format = req.nextUrl.searchParams.get('format') === 'wav' ? 'wav' : 'mp3';

  if (!trackId) {
    return NextResponse.json({ error: 'track_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Same per-IP cap as /api/store/download-file (they share a bucket), before
  // any lookup, so a bundle token cannot be hammered or guessed at speed.
  const ip = clientIp(req);
  if (!(await rateLimitDurable(`dl:${ip}`, 240, 60_000))) {
    return NextResponse.json(
      { error: 'Too many download requests. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  try {
    const admin = createServiceClient();
    const { data: access, error: aErr } = await admin
      .from('project_access_links')
      .select('id, project_id, expires_at, seller_user_id')
      .eq('token', token)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // From here the token is real, so what happens to it is auditable.
    const audit = (outcome: 'granted' | 'denied', reason?: DownloadDenial) =>
      recordDownload(admin, {
        sellerUserId: access.seller_user_id ?? null, trackId, purchaseKind: 'project',
        purchaseId: access.id ?? null, format, outcome, reason, ip,
      });
    if (access.expires_at && new Date(access.expires_at).getTime() < Date.now()) {
      await audit('denied', 'expired');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: belongs } = await admin
      .from('project_tracks')
      .select('track_id')
      .eq('project_id', access.project_id)
      .eq('track_id', trackId)
      .maybeSingle();
    if (!belongs) {
      await audit('denied', 'track-not-in-purchase');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: track, error: tErr } = await admin
      .from('tracks')
      .select('audio_url, wav_url, title')
      .eq('id', trackId)
      .maybeSingle();
    if (tErr) throw tErr;

    const source = format === 'wav' ? track?.wav_url : track?.audio_url;
    if (!source) {
      await audit('denied', 'file-missing');
      return NextResponse.json({ error: `${format.toUpperCase()} unavailable` }, { status: 404 });
    }

    const extMatch = source.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
    const ext = (format === 'wav' ? 'wav' : extMatch?.[1] ?? 'mp3').toLowerCase();
    const filename = `${track?.title || 'track'}.${ext}`;
    if (shouldLogGrant(req.headers.get('range'), req.headers.has('x-download-probe'))) {
      await audit('granted');
    }
    return streamAudioSource(req, source, filename);
  } catch (err) {
    // Public route: log the detail, never return it (DB/storage internals).
    log.error('project download failed', { trackId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
