import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { verifyShareMediaGrant } from '@/lib/share-media-token';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ShareRow = {
  revoked_at?: string | null;
  expires_at?: string | null;
  content_type?: string | null;
  project_id?: string | null;
  playlist_id?: string | null;
  track_id?: string | null;
  track_ids?: string[] | null;
};

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
    const { data: projectShare } = await admin
      .from('project_shares')
      .select('revoked_at, expires_at, content_type, project_id, playlist_id, track_id')
      .eq('token', token)
      .maybeSingle();

    let share: ShareRow | null = projectShare ?? null;
    let included = share ? await projectShareIncludesTrack(admin, share, trackId) : false;

    if (!share) {
      const { data: flatShare } = await admin
        .from('share_links')
        .select('revoked_at, expires_at, track_ids')
        .eq('token', token)
        .maybeSingle();
      share = flatShare ?? null;
      included = Array.isArray(flatShare?.track_ids) && flatShare.track_ids.includes(trackId);
    }

    if (!share) {
      const { data: paidAccess } = await admin
        .from('project_access_links')
        .select('project_id, expires_at')
        .eq('token', token)
        .maybeSingle();
      if (paidAccess) {
        share = { expires_at: paidAccess.expires_at ?? null };
        included = await projectIncludesTrack(admin, paidAccess.project_id, trackId);
      }
    }

    if (!share || !included) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (share.revoked_at) {
      return NextResponse.json({ error: 'Share revoked' }, { status: 410 });
    }
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Share expired' }, { status: 410 });
    }

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

async function projectShareIncludesTrack(
  admin: ReturnType<typeof createServiceClient>,
  share: ShareRow,
  trackId: string,
): Promise<boolean> {
  const contentType = share.content_type ?? 'project';
  if (contentType === 'track') return share.track_id === trackId;
  if (contentType === 'playlist' && share.playlist_id) {
    const { data } = await admin
      .from('playlist_tracks')
      .select('track_id')
      .eq('playlist_id', share.playlist_id)
      .eq('track_id', trackId)
      .maybeSingle();
    return !!data;
  }
  return share.project_id ? projectIncludesTrack(admin, share.project_id, trackId) : false;
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
