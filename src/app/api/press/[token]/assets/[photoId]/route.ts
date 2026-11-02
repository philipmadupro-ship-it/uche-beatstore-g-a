/**
 * GET /api/press/[token]/assets/[photoId] (LABEL-66) — one photo of a shared
 * press kit, STREAMED through here (no presigned or private URL ever leaves the
 * server). Everything is re-checked on this request: the share (unrevoked,
 * unexpired), the org's licence, the release, the EMBARGO (before it lifts only
 * a photo marked pre-embargo is served), and that the file is still an
 * unrestricted artwork/photo raster image of the release's own project. Every
 * failure is the same 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { isWellFormedPressToken, hashPressToken } from '@/lib/labelos/press-token';
import { publicPhotoSource, resolvePublicPress } from '@/lib/labelos/press-store';
import { streamProjectAsset } from '@/lib/storage/project-assets';
import { isUUID } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.press.assets');
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE });

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; photoId: string }> }) {
  const { token, photoId: rawPhotoId } = await params;
  const photoId = rawPhotoId.toLowerCase();
  if (!isWellFormedPressToken(token) || !isUUID(photoId)) return notFound();
  if (!isSupabaseConfigured()) return notFound();
  if (!(await rateLimitDurable(`press-ip:${clientIp(req)}`, 600, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429, headers: PRIVATE });
  }
  try {
    const admin = createServiceClient();
    const now = new Date();
    const ctx = await resolvePublicPress(admin, token, now);
    if (!ctx) return notFound();
    if (!(await rateLimitDurable(`press-asset:${hashPressToken(token).slice(0, 16)}`, 400, 60 * 60 * 1000))) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429, headers: PRIVATE });
    }
    const src = await publicPhotoSource(admin, ctx, photoId, now);
    if (!src) return notFound();
    const upstream = await streamProjectAsset(req, src.url, { fileName: src.file_name, mime: src.mime, inline: true });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(PRIVATE)) headers.set(k, v);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('press photo failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Photo unavailable' }, { status: 503, headers: PRIVATE });
  }
}
