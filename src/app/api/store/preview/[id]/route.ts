import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { createLogger } from '@/lib/log';
import { canStreamPublicly, publicPreviewSource, type PreviewTrackRow } from '@/lib/store/public-preview-access';
import { ownedStreamHeaders, sessionOwnsTrack } from '@/lib/store/owned-preview-access';

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
      .maybeSingle();

    if (error) throw error;
    // Listed, or in a featured bundle — and the producer's own track either
    // way. A row a buyer inserted must not become a public stream.
    const row = track as PreviewTrackRow | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Not public (an exclusive delists the beat it sells): the signed-in buyer
    // who owns it may still hear the same public preview. Anyone else 404s.
    const isPublic = await canStreamPublicly(admin, id, row);
    if (!isPublic && !(await sessionOwnsTrack(admin, id, row.user_id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const source = publicPreviewSource(row);
    if (!source) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const upstream = await streamAudioPreviewSource(req, source);
    const headers = new Headers(upstream.headers);
    if (isPublic) {
      headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
    } else {
      ownedStreamHeaders(headers);
    }
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
