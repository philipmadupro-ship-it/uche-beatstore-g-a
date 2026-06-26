import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

const log = createLogger('api.store.play');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/store/play  body: { track_id: string, source?: string }
 *
 * Records a play of a store-listed track. Public-by-design (no auth);
 * visitor identity is reduced to a salted IP hash so producers can
 * count distinct-ish listeners without us storing PII.
 *
 * This is the storefront-side counterpart to `share_plays` (which only
 * counts plays via DM'd share links). /api/analytics now sums both
 * for an honest "plays" metric.
 *
 * Rate-limited by ip_hash + track_id + 60s window — repeated requests
 * within the window are accepted (200) but skipped at the DB. Keeps
 * scrub-bar replays from inflating the count.
 */
function hashIp(ip: string): string {
  // Salt the hash so two deploys can't cross-correlate IPs.
  const salt = process.env.STRIPE_WEBHOOK_SECRET ?? 'antigravity-default-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    // No-op when there's nowhere to write — local-store dev mode.
    return NextResponse.json({ ok: true, skipped: 'local-store' });
  }

  try {
    // Per-IP cap on top of the existing 60s per-track dedup. Fire-and-forget:
    // on limit still return 200 so playback UX is never affected.
    if (!(await rateLimitDurable(`play:${clientIp(req)}`, 60, 60_000))) {
      return NextResponse.json({ ok: true, skipped: 'rate-limited' });
    }
    const body = await req.json().catch(() => ({}));
    const trackId = typeof body.track_id === 'string' ? body.track_id : '';
    const source = typeof body.source === 'string' ? body.source.slice(0, 64) : '';
    if (!trackId) {
      return NextResponse.json({ error: 'track_id required' }, { status: 400 });
    }

    const admin = createServiceClient();

    // Resolve seller for denormalisation. Track may not exist (404
    // body sent from a stale tab); treat as no-op.
    const { data: track } = await admin
      .from('tracks')
      .select('id, user_id, store_listed')
      .eq('id', trackId)
      .maybeSingle();
    if (!track || !(track as any).store_listed) {
      return NextResponse.json({ ok: true, skipped: 'not-listed' });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const ipHash = hashIp(ip);

    // 60s de-dup window — same ipHash + track within a minute = same play.
    const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from('store_plays')
      .select('id')
      .eq('track_id', trackId)
      .eq('ip_hash', ipHash)
      .gte('played_at', cutoff)
      .limit(1);
    if (recent && recent.length > 0) {
      return NextResponse.json({ ok: true, skipped: 'rate-limited' });
    }

    const { error: insertErr } = await admin.from('store_plays').insert({
      track_id: trackId,
      seller_user_id: (track as any).user_id ?? null,
      ip_hash: ipHash,
      source: source || null,
    });
    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.warn('store_play insert failed', { error: errorMessage(err) });
    // 200 even on failure — telemetry shouldn't break the listening UX.
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 200 });
  }
}
