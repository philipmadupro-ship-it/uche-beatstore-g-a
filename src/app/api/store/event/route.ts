import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { StoreEventBodySchema } from '@/lib/contracts';
import { isUUID } from '@/lib/validate';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

const log = createLogger('api.store.event');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/store/event
 * body: { event_type, session_id, track_id?, license_id?, metadata? }
 *
 * Public-by-design funnel telemetry — the storefront counterpart to
 * /api/store/play, but for buying actions (pdp_view, add_to_cart,
 * remove_from_cart, checkout_start, purchase). Visitors are
 * unauthenticated, so we run service-role and reduce identity to a
 * salted IP hash. `session_id` (anonymous, client-generated) is what
 * lets /analytics stitch events into a per-visitor funnel.
 *
 * Fire-and-forget: always 200 (even on failure) so telemetry never
 * blocks the shopping UX. seller_user_id is resolved from track_id when
 * present so producer-scoped funnel reads stay cheap.
 */
function hashIp(ip: string): string {
  const salt = process.env.STRIPE_WEBHOOK_SECRET ?? 'antigravity-default-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'local-store' });
  }

  try {
    // Per-IP cap on telemetry writes. Fire-and-forget: on limit we still
    // return 200 so the storefront never sees an error from a dropped event.
    if (!(await rateLimitDurable(`event:${clientIp(req)}`, 60, 60_000))) {
      return NextResponse.json({ ok: true, skipped: 'rate-limited' });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = StoreEventBodySchema.safeParse(raw);
    if (!parsed.success) {
      // Bad telemetry is dropped, not surfaced — never break the client.
      return NextResponse.json({ ok: true, skipped: 'invalid' });
    }
    const { event_type, session_id, track_id, license_id, metadata } = parsed.data;

    const admin = createServiceClient();

    // Resolve the seller from the track when we have one, so funnel reads
    // can scope by owner without a join. A malformed/absent track id just
    // leaves seller null (the event still counts for global funnel math).
    let sellerUserId: string | null = null;
    let resolvedTrackId: string | null = null;
    if (track_id && isUUID(track_id)) {
      const { data: track } = await admin
        .from('tracks')
        .select('id, user_id')
        .eq('id', track_id)
        .maybeSingle();
      if (track) {
        resolvedTrackId = (track as any).id;
        sellerUserId = (track as any).user_id ?? null;
      }
    }

    // Fall back to an explicit seller in metadata (cart/checkout events that
    // don't carry a single track but know the store owner).
    if (!sellerUserId && metadata && isUUID(metadata.seller_user_id)) {
      sellerUserId = metadata.seller_user_id as string;
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';

    const { error: insertErr } = await admin.from('store_events').insert({
      event_type,
      session_id,
      track_id: resolvedTrackId,
      license_id: license_id ?? null,
      seller_user_id: sellerUserId,
      metadata: metadata ?? null,
      ip_hash: hashIp(ip),
    });
    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.warn('store_event insert failed', { error: errorMessage(err) });
    // 200 even on failure — telemetry must not break the storefront.
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 200 });
  }
}
