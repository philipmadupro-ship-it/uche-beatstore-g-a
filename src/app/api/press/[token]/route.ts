/**
 * GET /api/press/[token] (LABEL-66) — the public press-kit page's data. No
 * account, no session: the share link is the only credential, for ONE kit.
 * Modelled on the external signer's entrance (/api/sign/[token]) and the
 * artist portal:
 *
 *  - Every failure to identify the caller is the same `404 {error:"Not found"}`
 *    — malformed or unknown token, revoked, expired, a withdrawn or cancelled
 *    release, a deleted or unlicensed org, a database without migration 184 —
 *    so a caller learns nothing about which. (A database fault is 503.)
 *  - The token is checked for SHAPE first, then looked up by the hash of it;
 *    only the hash is stored.
 *  - A coarse per-address limiter counts everything; a per-link one is spent
 *    only after the token resolved, so guesses cannot lock the real reader out.
 *  - The body is built FIELD BY FIELD by `publicPressView` (lib/labelos/press).
 *    EMBARGO and audio are decided here on EVERY request; the response is
 *    `no-store`, so no cache can outlive the embargo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { isWellFormedPressToken, hashPressToken } from '@/lib/labelos/press-token';
import { buildPublicPress, noteShareView, resolvePublicPress } from '@/lib/labelos/press-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.press');
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE });
const tooMany = () => NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429, headers: PRIVATE });

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isWellFormedPressToken(token)) return notFound();
  if (!isSupabaseConfigured()) return notFound();
  if (!(await rateLimitDurable(`press-ip-page:${clientIp(req)}`, 300, 60 * 60 * 1000))) return tooMany();
  try {
    const admin = createServiceClient();
    const now = new Date();
    const ctx = await resolvePublicPress(admin, token, now);
    if (!ctx) return notFound();
    if (!(await rateLimitDurable(`press-link:${hashPressToken(token).slice(0, 16)}`, 120, 60 * 60 * 1000))) return tooMany();
    const view = await buildPublicPress(admin, ctx, token, now);
    await noteShareView(admin, ctx.org, ctx.shareId, now).catch(() => undefined);
    return NextResponse.json({ press: view }, { headers: PRIVATE });
  } catch (err) {
    log.error('press page failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Press kit unavailable' }, { status: 503, headers: PRIVATE });
  }
}
