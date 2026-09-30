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
    return NextResponse.json({ error: 'Peaks grant expired or invalid' }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const admin = createServiceClient();
    const resolved = await resolveShareToken(admin, token, ['project_share', 'share_link', 'paid_access', 'artist_portal']);
    if (!resolved || !(await resolvedShareIncludesTrack(admin, resolved, trackId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Same HMAC-grant rule as the preview route: the password was checked
    // when the grant was minted.
    const failure = await shareAccessFailure(lockableOf(resolved), { password: '', checkPassword: false });
    if (failure) return shareGateResponse(failure);

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
