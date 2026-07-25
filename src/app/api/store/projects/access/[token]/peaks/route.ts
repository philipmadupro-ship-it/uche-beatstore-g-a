import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProjectAccessRow {
  project_id: string;
  expires_at?: string | null;
}

interface ProjectTrackRow {
  track_id: string;
}

interface TrackPeaksRow {
  peaks_url?: string | null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const trackId = req.nextUrl.searchParams.get('track_id');

  if (!trackId) return jsonError('Missing track_id', 400);
  if (!isSupabaseConfigured()) return jsonError('Not found', 404);

  try {
    const admin = createServiceClient();
    const { data: access, error: accessError } = await admin
      .from('project_access_links')
      .select('project_id, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (accessError) throw accessError;
    const accessRow = access as ProjectAccessRow | null;
    if (!accessRow) return jsonError('Not found', 404);
    if (accessRow.expires_at && new Date(accessRow.expires_at).getTime() < Date.now()) {
      return jsonError('Not found', 404);
    }

    const { data: projectTrack } = await admin
      .from('project_tracks')
      .select('track_id')
      .eq('project_id', accessRow.project_id)
      .eq('track_id', trackId)
      .maybeSingle();
    if (!(projectTrack as ProjectTrackRow | null)?.track_id) return jsonError('Not found', 404);

    const { data: track, error: trackError } = await admin
      .from('tracks')
      .select('peaks_url')
      .eq('id', trackId)
      .maybeSingle();
    if (trackError) throw trackError;

    const peaksUrl = (track as TrackPeaksRow | null)?.peaks_url;
    if (!peaksUrl) return jsonError('Peaks unavailable', 404);

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
    return jsonError(errorMessage(err), 500);
  }
}

export async function HEAD(req: NextRequest, context: { params: Promise<{ token: string }> }) {
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
