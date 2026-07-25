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
    return NextResponse.json({ error: 'Peaks grant expired or invalid' }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const admin = createServiceClient();
    const { share, included } = await resolveShareForTrack(admin, token, trackId);

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
      .select('peaks_url')
      .eq('id', trackId)
      .maybeSingle();
    const peaksUrl = typeof track?.peaks_url === 'string' ? track.peaks_url : null;
    if (!peaksUrl) {
      return NextResponse.json({ error: 'Peaks unavailable' }, { status: 404 });
    }

    const upstream = await streamAudioPreviewSource(req, peaksUrl);
    const headers = new Headers(upstream.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', 'Range, Content-Type');
    headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges');
    headers.set('cache-control', 'private, max-age=900');
    headers.set('x-content-type-options', 'nosniff');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

async function resolveShareForTrack(
  admin: ReturnType<typeof createServiceClient>,
  token: string,
  trackId: string,
): Promise<{ share: ShareRow | null; included: boolean }> {
  const { data: projectShare } = await admin
    .from('project_shares')
    .select('revoked_at, expires_at, content_type, project_id, playlist_id, track_id')
    .eq('token', token)
    .maybeSingle();

  if (projectShare) {
    const share = projectShare as ShareRow;
    return { share, included: await projectShareIncludesTrack(admin, share, trackId) };
  }

  const { data: flatShare } = await admin
    .from('share_links')
    .select('revoked_at, expires_at, track_ids')
    .eq('token', token)
    .maybeSingle();

  if (flatShare) {
    const share = flatShare as ShareRow;
    return { share, included: Array.isArray(share.track_ids) && share.track_ids.includes(trackId) };
  }

  const { data: paidAccess } = await admin
    .from('project_access_links')
    .select('project_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!paidAccess) return { share: null, included: false };

  return {
    share: { expires_at: paidAccess.expires_at ?? null },
    included: await projectIncludesTrack(admin, paidAccess.project_id, trackId),
  };
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

export async function HEAD(
  req: NextRequest,
  context: { params: Promise<{ token: string; trackId: string }> },
) {
  return GET(req, context);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Range, Content-Type',
    },
  });
}
