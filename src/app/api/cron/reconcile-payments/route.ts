import { NextRequest, NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { findUnfulfilledSessions, type StripeSessionLite } from '@/lib/stripe/reconcile';

const log = createLogger('cron.reconcile-payments');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How far back to reconcile each run. Comfortably wider than the cron interval
// so a session can't slip between windows; the webhook usually fulfils within
// seconds, so a session still unmatched after this long is a real failure.
const LOOKBACK_HOURS = 48;

/**
 * Payments reconciliation safety net.
 *
 * Lists recent *paid* Stripe checkout sessions and verifies each produced a
 * fulfillment row (license_purchases or project_access_links). A paid session
 * with no row means the buyer paid but the webhook never fulfilled — silent
 * lost revenue / angry customer. Those are logged at error level so they
 * surface in Sentry/alerting. Read-only: it never mutates, it reports.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ skipped: 'Stripe not configured' });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ skipped: 'Supabase not configured' });
  }

  const stripe = getStripe();
  const admin = createServiceClient();
  const since = Math.floor((Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000) / 1000);

  try {
    // Pull completed sessions in the window (auto-paginates up to the cap).
    const sessions: StripeSessionLite[] = [];
    for await (const s of stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 })) {
      sessions.push({
        id: s.id,
        payment_status: s.payment_status ?? null,
        amount_total: s.amount_total ?? null,
        purchase_kind: (s.metadata?.purchase_kind as string | undefined) ?? null,
      });
      if (sessions.length >= 500) break; // safety cap for a single run
    }

    const ids = sessions.map((s) => s.id);
    const fulfilled = new Set<string>();
    if (ids.length > 0) {
      const [lp, pal] = await Promise.all([
        admin.from('license_purchases').select('stripe_session_id').in('stripe_session_id', ids),
        admin.from('project_access_links').select('stripe_session_id').in('stripe_session_id', ids),
      ]);
      for (const r of lp.data ?? []) if (r.stripe_session_id) fulfilled.add(r.stripe_session_id);
      for (const r of pal.data ?? []) if (r.stripe_session_id) fulfilled.add(r.stripe_session_id);
    }

    const unfulfilled = findUnfulfilledSessions(sessions, fulfilled);
    if (unfulfilled.length > 0) {
      // Error level → Sentry/alerting. Never log buyer email here.
      log.error('paid sessions with no fulfillment row', {
        count: unfulfilled.length,
        sessions: unfulfilled,
      });
    } else {
      log.info('reconciliation clean', { paidChecked: sessions.filter((s) => s.payment_status === 'paid').length });
    }

    return NextResponse.json({
      window_hours: LOOKBACK_HOURS,
      sessions_scanned: sessions.length,
      unfulfilled_count: unfulfilled.length,
      unfulfilled,
    });
  } catch (err) {
    log.error('reconciliation failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
