import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = createServiceClient();
    const { data: track, error } = await admin
      .from('tracks')
      .select('preview_url, audio_url, store_listed')
      .eq('id', id)
      .eq('store_listed', true)
      .maybeSingle();

    if (error) throw error;
    const source = track?.preview_url || (
      typeof track?.audio_url === 'string' && !track.audio_url.startsWith('r2://')
        ? track.audio_url
        : null
    );
    if (!source) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const upstream = await streamAudioPreviewSource(req, source);
    const headers = new Headers(upstream.headers);
    headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return GET(req, ctx);
}
