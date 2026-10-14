import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { DigestSchemaMissing, databasePorts } from '@/lib/labelos/weekly-digest-store';
import { runWeeklyDigest } from '@/lib/labelos/weekly-digest-run';

const log = createLogger('cron.weekly-digest');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Seconds. The run stops starting work at BUDGET_MS and leaves the rest unclaimed for tomorrow. */
export const maxDuration = 60;
const BUDGET_MS = 45_000;

/**
 * Weekly Label OS digest (LABEL-38), opt-in per member. Schedule: vercel.json,
 * DAILY (Hobby's limit). The week key only changes on Monday, so the first run
 * of the week does the work and the later ones are retries: a member whose
 * send failed (claim released), or who was left unclaimed when the time budget
 * ran out, is picked up by the next run in the same ISO week. Extra runs send
 * nothing else.
 *
 * Each due member gets at most ONE digest per ISO week: the week is claimed
 * with a compare-and-set in the database before anything is sent, so a repeat
 * or concurrent run sends nothing. The content is built for each recipient through their
 * own scope. With no Resend key members are not emailed (nothing is claimed);
 * with no Label OS tables (migration 160) it is a no-op. CRON_SECRET-gated;
 * like the other Label OS crons it does not look at LABEL_OS_ENABLED (the
 * flag gates the app's routes, and the opt-in rows only exist where an owner
 * switched the digest on).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ skipped: 'Supabase not configured' });

  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const result = await runWeeklyDigest(databasePorts(createServiceClient(), base), new Date(), { budgetMs: BUDGET_MS });
    log.info('weekly digest run', result);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DigestSchemaMissing) return NextResponse.json({ skipped: 'Label OS migrations are not applied' });
    log.error('weekly digest failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
