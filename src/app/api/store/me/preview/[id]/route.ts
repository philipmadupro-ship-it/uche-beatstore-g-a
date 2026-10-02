import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { resolveBuyerEmail } from '@/lib/store/buyer-identity';
import { buyerOwnsTrack } from '@/lib/store/buyer-ownership';
import { canStreamPublicly, publicPreviewSource, type PreviewTrackRow } from '@/lib/store/public-preview-access';

const log = createLogger('api.store.me.preview');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/me/preview/[id]?session=1 | ?token=…
 *
 * Audio for a beat played from the buyer's account. Identity-gated like the
 * rest of /api/store/me, and it streams the SAME public preview clip as
 * /api/store/preview/[id] — never the master or the WAV. What it adds is
 * ownership: a beat the buyer paid for plays even after the sale delisted it
 * (an exclusive does), while a beat they neither own nor the store shows is a
 * 404, so this is not a back door to an unlisted track.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const resolved = await resolveBuyerEmail(req);
    if (!resolved) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = createServiceClient();
    const { data, error } = await admin
      .from('tracks')
      .select('preview_url, audio_url, store_listed, user_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const row = data as PreviewTrackRow | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const allowed = (await buyerOwnsTrack(admin, resolved.email, id))
      || (await canStreamPublicly(admin, id, row));
    const source = allowed ? publicPreviewSource(row) : null;
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const upstream = await streamAudioPreviewSource(req, source);
    const headers = new Headers(upstream.headers);
    // Identity-gated: a shared cache must never hand it to someone else.
    headers.set('cache-control', 'private, max-age=60');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    // Buyer-facing route: log the detail, never return it.
    log.error('buyer preview failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Preview unavailable' }, { status: 500 });
  }
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return GET(req, ctx);
}
