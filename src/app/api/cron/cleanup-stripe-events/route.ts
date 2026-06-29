import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.cleanup-stripe-events');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stripe retries a webhook event for up to ~3 days. We keep the idempotency
// log far longer than that as a safety margin, then prune so the table doesn't
// grow unbounded. Anything older than this can never be re-delivered.
const RETENTION_DAYS = 30;

/**
 * Prune the Stripe event-idempotency log (`processed_stripe_events`, mig 041).
 *
 * The webhook inserts one row per event.id to guarantee exactly-once
 * processing. Those rows are only useful while Stripe might still redeliver
 * the event (~3 days); past the retention window they're dead weight. This
 * cron deletes them daily. CRON_SECRET-gated like every scheduled route.
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

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const admin = createServiceClient();

  try {
    const { data, error } = await admin
      .from('processed_stripe_events')
      .delete()
      .lt('created_at', cutoff)
      .select('event_id');
    if (error) throw error;

    const deleted = data?.length ?? 0;
    log.info('pruned processed_stripe_events', { deleted, cutoff, retentionDays: RETENTION_DAYS });
    return NextResponse.json({ deleted, cutoff });
  } catch (err) {
    log.error('cleanup failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
