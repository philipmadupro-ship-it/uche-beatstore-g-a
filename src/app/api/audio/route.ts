import { NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/local-store';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { streamAudioPreviewSource, streamAudioSource } from '@/lib/audio/stream-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Audio proxy. Same-origin → no CORS issues for WaveSurfer decoding.
 * Forwards Range requests to R2 so the browser can seek and stream.
 *
 * Accepts ?src=<full audio url> OR ?key=<r2 object key>.
 * Only allows hosts on our R2 public URL or local /uploads paths.
 */
export async function GET(req: NextRequest) {
  if (isSupabaseConfigured()) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Not authenticated', { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let src = searchParams.get('src');
  const key = searchParams.get('key');

  if (!src && key) {
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '');
    if (!base) return new Response('Missing R2 base URL', { status: 500 });
    src = `${base}/${key.replace(/^\//, '')}`;
  }

  if (!src) {
    return new Response('Missing src', { status: 400 });
  }

  const download = searchParams.get('download') === '1';
  const filename = searchParams.get('filename') || src.split('/').pop() || 'audio';
  const upstream = download
    ? await streamAudioSource(req, src, filename)
    : await streamAudioPreviewSource(req, src);

  const headers = new Headers(upstream.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  headers.set('access-control-allow-headers', 'Range, Content-Type');
  headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges');
  headers.set('cache-control', 'private, no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function HEAD(req: NextRequest) {
  return GET(req);
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
