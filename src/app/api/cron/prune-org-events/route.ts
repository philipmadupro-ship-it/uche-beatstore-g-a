import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { pruneOldEvents } from '@/lib/labelos/org-lifecycle-store';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.prune-org-events');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Postgres / PostgREST wording for a table that is not there (136 not applied). */
const MISSING_SCHEMA = /does not exist|schema cache|Could not find the table/i;

/**
 * Prune everyday activity older than 24 months (D9, LABEL-39). Audit events —
 * membership, sharing, restricted downloads, approvals, the org's own
 * lifecycle — are never touched: they live as long as the org does.
 *
 * Bounded per run (see pruneOldEvents) and idempotent, so a backlog drains
 * over a few days and a repeat run deletes nothing. CRON_SECRET-gated; a no-op
 * where Supabase is not configured or the Label OS migrations are not applied
 * yet (it does not look at LABEL_OS_ENABLED).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ skipped: 'Supabase not configured' });

  try {
    const result = await pruneOldEvents(createServiceClient());
    log.info('pruned activity_events', result);
    return NextResponse.json(result);
  } catch (err) {
    if (MISSING_SCHEMA.test(errorMessage(err))) return NextResponse.json({ skipped: 'Label OS migrations are not applied' });
    log.error('prune failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
