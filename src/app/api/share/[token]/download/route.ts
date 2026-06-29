import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';

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
 * On grant we 302 to /api/audio?src=...&download=1, reusing the existing
 * audio proxy's range-streaming + Content-Disposition handling. We never
 * redirect to the raw R2 URL because that would leak the underlying URL
 * (the buyer could share it and bypass the purchase gate next time).
 *
 * Token resolution mirrors checkout: project_shares first, share_links
 * fallback. Both project and flat share variants hit this same endpoint.
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

    // Resolve the share token. project_shares first, then share_links.
    const { data: projShare } = await admin
      .from('project_shares')
      .select('allow_downloads, revoked_at, expires_at')
      .eq('token', token)
      .maybeSingle();

    let shareRow: { allow_downloads: boolean; revoked_at: string | null; expires_at: string | null } | null = projShare ?? null;

    if (!shareRow) {
      const { data: linkShare } = await admin
        .from('share_links')
        .select('allow_downloads, revoked_at, expires_at')
        .eq('token', token)
        .maybeSingle();
      shareRow = linkShare ?? null;
    }

    // Paid storefront project access (project_access_links token) — grant if track belongs to the purchased project
    let isProjectPaidAccess = false;
    if (!shareRow) {
      const { data: paidAccess } = await admin
        .from('project_access_links')
        .select('project_id')
        .eq('token', token)
        .maybeSingle();
      if (paidAccess) {
        const { data: belongs } = await admin
          .from('project_tracks')
          .select('track_id')
          .eq('project_id', paidAccess.project_id)
          .eq('track_id', trackId)
          .maybeSingle();
        if (belongs) {
          shareRow = { allow_downloads: true, revoked_at: null, expires_at: null } as any;
          isProjectPaidAccess = true;
        }
      }
    }

    if (!shareRow) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }
    if (shareRow.revoked_at) {
      return NextResponse.json({ error: 'Share revoked' }, { status: 410 });
    }
    if (shareRow.expires_at && new Date(shareRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Share expired' }, { status: 410 });
    }

    // Free pass when the producer allowed downloads at the share level.
    let granted = shareRow.allow_downloads === true;

    if (isProjectPaidAccess) {
      granted = true; // token itself proves the purchase for this project's tracks
    }

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
    const proxied = `/api/audio?src=${encodeURIComponent(track.audio_url)}&download=1&filename=${encodeURIComponent(filename)}`;

    // 302 to the proxy. Browser follows, gets the file with the right
    // Content-Disposition. No client code change needed beyond hitting
    // /api/share/[token]/download instead of /api/audio directly.
    return NextResponse.redirect(new URL(proxied, req.url), 302);
  } catch (err) {
    log.error('download gate failed', { token, trackId, error: errorMessage(err) });
    return publicError(err);
  }
}
