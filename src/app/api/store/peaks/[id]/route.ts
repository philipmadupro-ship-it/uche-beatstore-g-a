import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getById } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { errorMessage } from '@/lib/errors';
import { canStreamPublicly } from '@/lib/store/public-preview-access';
import { ownedStreamHeaders, sessionOwnsTrack } from '@/lib/store/owned-preview-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

interface TrackPeaksRow {
  id: string;
  user_id?: string | null;
  peaks_url?: string | null;
  store_listed?: boolean | null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

interface ResolvedPeaks {
  url: string;
  /** Served to the owner of a delisted beat, so it depends on the cookie. */
  owned: boolean;
}

async function resolveStorePeaks(trackId: string): Promise<ResolvedPeaks | null> {
  if (isSupabaseConfigured()) {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('tracks')
      .select('id, user_id, peaks_url, store_listed')
      .eq('id', trackId)
      .maybeSingle();
    if (error) throw error;
    const row = data as TrackPeaksRow | null;
    // Same rule as the preview it draws: listed or in a featured bundle.
    if (!row) return null;
    const isPublic = await canStreamPublicly(admin, trackId, {
      user_id: row.user_id ?? null,
      store_listed: row.store_listed ?? null,
    });
    // An exclusive delists the beat it sells; its buyer still gets the waveform.
    if (!isPublic && !(await sessionOwnsTrack(admin, trackId, row.user_id))) return null;
    return row.peaks_url ? { url: row.peaks_url, owned: !isPublic } : null;
  }

  const row = getById<TrackPeaksRow>('tracks', trackId);
  if (!row?.store_listed) return null;
  return row.peaks_url ? { url: row.peaks_url, owned: false } : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) return jsonError('Missing track id', 400);

  try {
    const peaks = await resolveStorePeaks(id);
    if (!peaks) return jsonError('Peaks not found', 404);

    const upstream = await streamAudioPreviewSource(req, peaks.url);
    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    }

    const headers = new Headers(upstream.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', 'Range, Content-Type');
    headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges');
    headers.set('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    headers.set('x-content-type-options', 'nosniff');
    if (peaks.owned) ownedStreamHeaders(headers);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function HEAD(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
