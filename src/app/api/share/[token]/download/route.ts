import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { streamAudioSource } from '@/lib/audio/stream-source';
import {
  lockableOf,
  resolveShareToken,
  resolvedShareIncludesTrack,
  shareAccessFailure,
  shareGateResponse,
  shareLifecycleFailure,
  shareNotFoundResponse,
  sharePasswordFrom,
} from '@/lib/share/token-access';

const log = createLogger('api.share.download');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/share/[token]/download?track_id=<uuid>&session_id=<cs_xxx>
 *
 * Single gate that both free and paid downloads flow through.
 *
 *   1. share.allow_downloads = true                → free pass
 *   2. share.allow_downloads = false +
 *      session_id matches a license_purchases row
 *      for this share + track + still-unlocked     → grant
 *   3. otherwise                                   → 403
 *
 * On grant we stream the file directly from this gated route. The raw storage
 * URL never appears in JSON, DOM, or redirect Location.
 *
 * Token resolution and the revoked / expired / password gate come from
 * `lib/share/token-access`, shared with every other public share route.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get('track_id');
  const sessionId = searchParams.get('session_id');

  if (!trackId) {
    return NextResponse.json({ error: 'track_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const admin = createServiceClient();

    const resolved = await resolveShareToken(admin, token, ['project_share', 'share_link', 'paid_access']);
    if (!resolved) return shareNotFoundResponse();

    // Order is part of the contract: a dead link says so (410) before
    // anything else, and membership (403) is decided before the password.
    const lifecycle = shareLifecycleFailure(lockableOf(resolved));
    if (lifecycle) return shareGateResponse(lifecycle);
    if (!(await resolvedShareIncludesTrack(admin, resolved, trackId))) {
      return NextResponse.json({ error: 'Download not permitted for this track' }, { status: 403 });
    }
    const locked = await shareAccessFailure(lockableOf(resolved), { password: sharePasswordFrom(req) });
    if (locked) return shareGateResponse(locked);

    // A purchase token proves the purchase for its project's tracks; any
    // other share is a free pass only when the producer allowed downloads.
    let granted = resolved.kind === 'paid_access' || resolved.row.allow_downloads === true;

    // Paid pass: a purchase row covering this share + session + track.
    // We require session_id so a random visitor can't probe another buyer's
    // email to inherit access; session_id is given to the buyer via Stripe's
    // redirect URL and stays in their localStorage.
    if (!granted && sessionId) {
      const { data: purchase } = await admin
        .from('license_purchases')
        .select('track_ids, download_unlocked, share_token')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();

      if (
        purchase &&
        purchase.share_token === token &&
        purchase.download_unlocked === true &&
        Array.isArray(purchase.track_ids) &&
        purchase.track_ids.includes(trackId)
      ) {
        granted = true;
      }
    }

    if (!granted) {
      return NextResponse.json({ error: 'Download not permitted for this track' }, { status: 403 });
    }

    // Look up the audio URL + a friendly filename. The track row carries
    // the canonical title; the audio proxy stamps Content-Disposition.
    const { data: track } = await admin
      .from('tracks')
      .select('audio_url, title')
      .eq('id', trackId)
      .maybeSingle();
    if (!track?.audio_url) {
      return NextResponse.json({ error: 'Track audio missing' }, { status: 404 });
    }

    const extMatch = track.audio_url.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
    const ext = (extMatch?.[1] ?? 'mp3').toLowerCase();
    const filename = `${track.title || 'track'}.${ext}`;
    return streamAudioSource(req, track.audio_url, filename);
  } catch (err) {
    log.error('download gate failed', { token, trackId, error: errorMessage(err) });
    return publicError(err);
  }
}
