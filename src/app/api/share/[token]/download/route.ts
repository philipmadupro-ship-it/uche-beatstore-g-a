import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { streamAudioSource } from '@/lib/audio/stream-source';
import bcrypt from 'bcryptjs';

const log = createLogger('api.share.download');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DownloadShareRow = {
  allow_downloads: boolean;
  revoked_at: string | null;
  expires_at: string | null;
  content_type?: string | null;
  project_id?: string | null;
  playlist_id?: string | null;
  track_id?: string | null;
  track_ids?: string[] | null;
  password_hash?: string | null;
};

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
      .select('allow_downloads, revoked_at, expires_at, password_hash, content_type, project_id, playlist_id, track_id')
      .eq('token', token)
      .maybeSingle();

    let shareRow: DownloadShareRow | null = projShare ?? null;
    let trackBelongsToShare = false;

    if (shareRow) {
      trackBelongsToShare = await projectShareIncludesTrack(admin, shareRow, trackId);
    }

    if (!shareRow) {
      const { data: linkShare } = await admin
        .from('share_links')
        .select('allow_downloads, revoked_at, expires_at, password_hash, track_ids')
        .eq('token', token)
        .maybeSingle();
      shareRow = linkShare ?? null;
      trackBelongsToShare = Array.isArray(linkShare?.track_ids) && linkShare.track_ids.includes(trackId);
    }

    // Paid storefront project access (project_access_links token) — grant if track belongs to the purchased project
    let isProjectPaidAccess = false;
    if (!shareRow) {
      const { data: paidAccess } = await admin
        .from('project_access_links')
        .select('project_id, expires_at')
        .eq('token', token)
        .maybeSingle();
      if (paidAccess) {
        shareRow = {
          allow_downloads: true,
          revoked_at: null,
          expires_at: paidAccess.expires_at ?? null,
        };
        isProjectPaidAccess = true;
        trackBelongsToShare = await projectIncludesTrack(admin, paidAccess.project_id, trackId);
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
    if (!trackBelongsToShare) {
      return NextResponse.json({ error: 'Download not permitted for this track' }, { status: 403 });
    }
    if (shareRow.password_hash) {
      const submittedPassword = req.headers.get('x-share-password') ?? '';
      if (!submittedPassword || !(await bcrypt.compare(submittedPassword, shareRow.password_hash))) {
        return NextResponse.json({ error: 'Share password required' }, { status: 401 });
      }
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
    return streamAudioSource(req, track.audio_url, filename);
  } catch (err) {
    log.error('download gate failed', { token, trackId, error: errorMessage(err) });
    return publicError(err);
  }
}

async function projectShareIncludesTrack(
  admin: ReturnType<typeof createServiceClient>,
  share: DownloadShareRow,
  trackId: string,
): Promise<boolean> {
  const contentType = share.content_type ?? 'project';
  if (contentType === 'track') {
    return share.track_id === trackId;
  }
  if (contentType === 'playlist' && share.playlist_id) {
    const { data } = await admin
      .from('playlist_tracks')
      .select('track_id')
      .eq('playlist_id', share.playlist_id)
      .eq('track_id', trackId)
      .maybeSingle();
    return !!data;
  }
  if (share.project_id) {
    return projectIncludesTrack(admin, share.project_id, trackId);
  }
  return false;
}

async function projectIncludesTrack(
  admin: ReturnType<typeof createServiceClient>,
  projectId: string,
  trackId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('project_tracks')
    .select('track_id')
    .eq('project_id', projectId)
    .eq('track_id', trackId)
    .maybeSingle();
  return !!data;
}
