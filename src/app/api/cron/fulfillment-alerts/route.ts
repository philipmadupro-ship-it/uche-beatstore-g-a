import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { findStuckFulfillments, type PurchaseRow } from '@/lib/store/fulfillment-alerts';

const log = createLogger('cron.fulfillment-alerts');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THRESHOLDS = { stemsHours: 24, emailMinutes: 30 };
// Only scan recent history — older stuck rows have already been alerted (the
// notification dedupe makes re-alerting a no-op anyway).
const LOOKBACK_DAYS = 30;

const TITLE: Record<string, string> = {
  awaiting_stems: 'Exclusive sale awaiting stems upload',
  delivery_email_failed: 'Delivery email may have failed',
};

/**
 * Fulfillment-health alerting.
 *
 * Surfaces two silent post-sale failures to the producer: exclusives sold but
 * left awaiting a stems upload, and paid purchases whose delivery email never
 * sent. Writes a deduped in-app notification per stuck purchase, and logs
 * delivery-email failures at error level so they also hit Sentry/alerting.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ skipped: 'Supabase not configured' });
  }

  const admin = createServiceClient();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Candidates: paid purchases in the window that carry either risk flag.
    const { data, error } = await admin
      .from('license_purchases')
      .select('id, seller_user_id, status, needs_stems_upload, fulfillment_email_sent, created_at')
      .eq('status', 'paid')
      .gte('created_at', since)
      .or('needs_stems_upload.eq.true,fulfillment_email_sent.eq.false');
    if (error) throw error;

    const alerts = findStuckFulfillments((data ?? []) as PurchaseRow[], Date.now(), THRESHOLDS);

    let notified = 0;
    for (const a of alerts) {
      const dedupeKey = `stuck_${a.kind}_${a.purchaseId}`;
      // Dedupe: one notification per (purchase, kind) — the cron is idempotent.
      const { data: existing } = await admin
        .from('notifications')
        .select('id')
        .eq('user_id', a.sellerUserId)
        .eq('data->>dedupe_key', dedupeKey)
        .maybeSingle();
      if (existing) continue;

      await admin.from('notifications').insert({
        user_id: a.sellerUserId,
        kind: 'fulfillment_alert',
        title: TITLE[a.kind],
        body: a.kind === 'awaiting_stems'
          ? `A buyer is still waiting on stems (${Math.round(a.ageHours)}h). Upload them on /sales.`
          : `A paid order has no delivery email after ${Math.round(a.ageHours)}h — re-send from /sales.`,
        data: { dedupe_key: dedupeKey, purchase_id: a.purchaseId, alert_kind: a.kind },
      });
      notified++;

      // Email-delivery failures are a revenue/UX risk → error level for Sentry.
      if (a.kind === 'delivery_email_failed') {
        log.error('paid order with no delivery email', { purchaseId: a.purchaseId, ageHours: Math.round(a.ageHours) });
      }
    }

    log.info('fulfillment alerts run', { candidates: data?.length ?? 0, alerts: alerts.length, notified });
    return NextResponse.json({ candidates: data?.length ?? 0, alerts: alerts.length, notified });
  } catch (err) {
    log.error('fulfillment-alerts failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
