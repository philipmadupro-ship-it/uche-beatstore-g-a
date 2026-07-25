import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getById } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

interface TrackPeaksRow {
  id: string;
  peaks_url?: string | null;
  store_listed?: boolean | null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveStorePeaks(trackId: string): Promise<string | null> {
  if (isSupabaseConfigured()) {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('tracks')
      .select('id, peaks_url, store_listed')
      .eq('id', trackId)
      .eq('store_listed', true)
      .maybeSingle();
    if (error) throw error;
    const row = data as TrackPeaksRow | null;
    return row?.peaks_url || null;
  }

  const row = getById<TrackPeaksRow>('tracks', trackId);
  if (!row?.store_listed) return null;
  return row.peaks_url || null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) return jsonError('Missing track id', 400);

  try {
    const peaksUrl = await resolveStorePeaks(id);
    if (!peaksUrl) return jsonError('Peaks not found', 404);

    const upstream = await streamAudioPreviewSource(req, peaksUrl);
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
