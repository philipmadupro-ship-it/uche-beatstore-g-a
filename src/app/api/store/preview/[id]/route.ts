import { isProducerUserId } from '@/lib/auth/producer';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { createLogger } from '@/lib/log';

const log = createLogger('api.store.preview');

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
      .select('preview_url, audio_url, store_listed, user_id')
      .eq('id', id)
      .eq('store_listed', true)
      .maybeSingle();

    if (error) throw error;
    // Only the producer's catalogue is public. A row a buyer inserted
    // themselves must not become a public stream of whatever it points at.
    if (track && !(await isProducerUserId(admin, track.user_id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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
    // Public route: log the detail, never return it (DB/storage internals).
    log.error('preview failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Preview unavailable' }, { status: 500 });
  }
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return GET(req, ctx);
}
