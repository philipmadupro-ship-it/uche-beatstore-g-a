import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { streamAudioPreviewSource } from '@/lib/audio/stream-source';
import { createLogger } from '@/lib/log';
import { canStreamPublicly, type PreviewTrackRow } from '@/lib/store/public-preview-access';
import { ownedStreamHeaders, sessionOwnsTrack } from '@/lib/store/owned-preview-access';
import { waveFileUrlFor } from '@/lib/visuals/waveform-file';

const log = createLogger('api.store.wave');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The server-built waveform model (`<preview>.wave.bin`) of a store track, read through
 * this origin because the public R2 host sends no CORS headers. Same access rule as the
 * preview it describes (`/api/store/preview/[id]`), same bytes as anyone could fetch from
 * the public bucket: derived numbers, never audio. A track with no file answers 404 and
 * the browser decodes the preview as before.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('tracks')
      .select('preview_url, audio_url, store_listed, user_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const row = data as PreviewTrackRow | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const isPublic = await canStreamPublicly(admin, id, row);
    if (!isPublic && !(await sessionOwnsTrack(admin, id, row.user_id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Only a clip the pipeline wrote beside its file: never a master (`preview_url` null falls to audio_url).
    const source = row.preview_url ? waveFileUrlFor(row.preview_url) : null;
    if (!source) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const upstream = await streamAudioPreviewSource(req, source);
    if (!upstream.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const headers = new Headers(upstream.headers);
    headers.set('content-type', 'application/octet-stream');
    headers.set('x-content-type-options', 'nosniff');
    if (isPublic) headers.set('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    else ownedStreamHeaders(headers);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('wave failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return GET(req, ctx);
}
