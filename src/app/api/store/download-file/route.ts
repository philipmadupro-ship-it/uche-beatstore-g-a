import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { getPresignedUrl, r2KeyFromUrl } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.download-file');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/download-file?session_id=cs_xxx&track_id=yyy
 *
 * Per-file download gate for the /store/download portal.
 * Validates the session_id covers this track, then 302 → /api/audio
 * proxy (same pattern as /api/share/[token]/download).
 *
 * Security model:
 *   - session_id is a Stripe cs_xxx (not guessable)
 *   - We confirm download_unlocked=true on the purchase row
 *   - We confirm track_id is in the purchase's track_ids array
 *   - We never expose the raw R2/storage URL in the redirect
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  const trackId = searchParams.get('track_id');

  if (!sessionId || !trackId) {
    return NextResponse.json({ error: 'session_id and track_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const admin = createServiceClient();

    const { data: purchase } = await admin
      .from('license_purchases')
      .select('download_unlocked, track_ids')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }
    if (!purchase.download_unlocked) {
      return NextResponse.json({ error: 'Download access revoked' }, { status: 403 });
    }
    if (!Array.isArray(purchase.track_ids) || !purchase.track_ids.includes(trackId)) {
      return NextResponse.json({ error: 'Track not in this purchase' }, { status: 403 });
    }

    const { data: track } = await admin
      .from('tracks')
      .select('audio_url, title')
      .eq('id', trackId)
      .maybeSingle();

    if (!track?.audio_url) {
      return NextResponse.json({ error: 'Track audio not found' }, { status: 404 });
    }

    const extMatch = track.audio_url.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
    const ext = (extMatch?.[1] ?? 'mp3').toLowerCase();
    const filename = `${track.title || 'track'}.${ext}`;

    // Prefer a short-TTL R2 presigned URL so the redirect target dies within
    // the hour; fall back to the (permanent) proxy for local/legacy paths.
    const key = r2KeyFromUrl(track.audio_url);
    if (key) {
      try {
        const signed = await getPresignedUrl(key, { downloadFilename: filename, expiresIn: 3600 });
        return NextResponse.redirect(signed, 302);
      } catch (err) {
        log.warn('presign failed, falling back to proxy', { sessionId, trackId, error: errorMessage(err) });
      }
    }
    const proxied = `/api/audio?src=${encodeURIComponent(track.audio_url)}&download=1&filename=${encodeURIComponent(filename)}`;
    return NextResponse.redirect(new URL(proxied, req.url), 302);
  } catch (err) {
    log.error('download-file failed', { sessionId, trackId, error: errorMessage(err) });
    return publicError(err);
  }
}
