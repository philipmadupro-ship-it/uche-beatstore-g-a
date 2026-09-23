import { NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/local-store';
import { requireProducer } from '@/lib/auth/ownership';
import { streamAudioPreviewSource, streamAudioSource } from '@/lib/audio/stream-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Audio proxy for the PRODUCER'S OWN dashboard. Same-origin → no CORS issues
 * for WaveSurfer decoding. Forwards Range requests to R2 so the browser can
 * seek and stream.
 *
 * Accepts ?src=<full audio url> OR ?key=<r2 object key>.
 *
 * ## Why this is producer-only, and not merely authenticated
 *
 * `src` is taken from the query string and never checked against the caller.
 * This route will hand back ANY object it can reach, including a master WAV or
 * a stem in the private bucket — and with `redirect=1` it hands back a
 * presigned R2 URL that then works with no session at all.
 *
 * It used to gate on `supabase.auth.getUser()` alone. Buyers sign in through
 * the SAME Supabase auth as the producer (magic link / Google, see
 * `/store/account`), so "is anyone logged in" was true for every buyer with an
 * account — and any of them who learned or guessed an `r2://` key could pull
 * the unwatermarked master of a beat they had not licensed. That is the exact
 * trap `requireProducer` was written for; its own comment says
 * "authenticated is not producer".
 *
 * Nothing buyer-facing needs this route, which is what makes the tighter gate
 * safe: post-purchase delivery goes through `/api/store/download-file`, store
 * previews through `/api/store/preview/[id]`, and share pages through the
 * short-lived HMAC grants in `lib/share-media-token.ts` — CLAUDE.md records
 * routing share media here as a bug already shipped and fixed once.
 *
 * Residual, accepted: a producer can still pass any `src`, so this is a gate
 * on WHO calls rather than on WHICH object. With a single-producer model
 * (AGENTS.md: "No multi-tenant producer model (yet)") those are the same set.
 * If a second producer is ever added, this needs a per-object ownership check
 * as well, or one producer can read another's masters.
 */
export async function GET(req: NextRequest) {
  // No Supabase means local no-database dev, where there is no auth to check
  // and nothing private to protect. Unchanged behaviour.
  if (isSupabaseConfigured()) {
    const auth = await requireProducer();
    if (!auth.ok) return auth.res;
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

  // Playback fast path: instead of piping every byte through this function
  // (slow first byte, one held connection per listener), answer with a 302 to
  // a short-lived presigned R2 URL. Presigning is local HMAC — no network —
  // so this response is ~instant, and the <audio> element then streams (and
  // Range-seeks) directly from R2. Opt-in because WaveSurfer decode surfaces
  // need same-origin bytes (CORS) and must keep the streaming proxy.
  if (searchParams.get('redirect') === '1' && src.startsWith('r2://')) {
    try {
      const { getPresignedUrl } = await import('@/lib/storage/upload');
      const signed = await getPresignedUrl(src);
      return new Response(null, {
        status: 302,
        headers: {
          location: signed,
          // Reusable briefly (well under the 1h signature validity) so seeks
          // don't re-hit the function.
          'cache-control': 'private, max-age=300',
        },
      });
    } catch {
      // fall through to the streaming proxy below
    }
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
