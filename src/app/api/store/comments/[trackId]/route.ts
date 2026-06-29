import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { publicError } from '@/lib/api-error';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/comments/[trackId]   — public list of non-hidden
 *                                        comments sorted by timestamp,
 *                                        pinned first.
 * POST /api/store/comments/[trackId]  — public write with rate limit
 *                                        (max one comment per (ipHash, trackId)
 *                                        per 30s).
 *
 * The producer's moderation routes (delete / pin / hide) live at
 * /api/tracks/[id]/comments + use requireRowOwnership.
 */

function ipHashFromReq(req: NextRequest, salt: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ comments: [] });

  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('beat_comments')
      .select('id, author_name, timestamp_seconds, body, is_pinned, created_at')
      .eq('track_id', trackId)
      .eq('is_hidden', false)
      .order('is_pinned', { ascending: false })
      .order('timestamp_seconds', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ comments: data ?? [] });
  } catch (err) {
    return publicError(err);
  }
}

const postSchema = z.object({
  author_name: z.string().trim().min(1).max(60),
  author_email: z.string().email().optional().or(z.literal('')),
  body: z.string().trim().min(1).max(500),
  timestamp_seconds: z.number().min(0).max(36000).default(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  // Public comment endpoint — throttle per IP to blunt spam.
  if (!await rateLimitDurable(`storecomment:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Comments unavailable in offline mode' }, { status: 503 });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid comment' },
        { status: 400 },
      );
    }

    const admin = createServiceClient();

    // Resolve the track's owner so we can stamp seller_user_id at insert
    // without trusting the client. Also confirms the track exists +
    // is store_listed (don't accept comments on drafts).
    const { data: track, error: tErr } = await admin
      .from('tracks')
      .select('user_id, store_listed')
      .eq('id', trackId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!track || !(track as any).store_listed) {
      return NextResponse.json({ error: 'Track not available for comments' }, { status: 404 });
    }
    const sellerId = (track as any).user_id as string | null;
    if (!sellerId) {
      return NextResponse.json({ error: 'Track has no owner' }, { status: 400 });
    }

    // Rate-limit: one comment per (ipHash, trackId) per 30 seconds. IP
    // hash is salted with STRIPE_WEBHOOK_SECRET so we don't store raw IPs.
    const salt = process.env.STRIPE_WEBHOOK_SECRET ?? 'fallback-salt-set-the-env-var';
    const ipHash = ipHashFromReq(req, salt);
    const since = new Date(Date.now() - 30_000).toISOString();
    const { data: recent } = await admin
      .from('beat_comments')
      .select('id')
      .eq('track_id', trackId)
      .eq('ip_hash', ipHash)
      .gte('created_at', since)
      .limit(1);
    if (recent && recent.length > 0) {
      return NextResponse.json(
        { error: 'Slow down — wait a few seconds before another comment.' },
        { status: 429 },
      );
    }

    const { data: inserted, error: iErr } = await admin
      .from('beat_comments')
      .insert({
        track_id: trackId,
        seller_user_id: sellerId,
        author_name: parsed.data.author_name,
        author_email: parsed.data.author_email || null,
        body: parsed.data.body,
        timestamp_seconds: parsed.data.timestamp_seconds,
        ip_hash: ipHash,
      })
      .select('id, author_name, timestamp_seconds, body, is_pinned, created_at')
      .single();
    if (iErr) throw iErr;

    return NextResponse.json({ comment: inserted });
  } catch (err) {
    return publicError(err);
  }
}
