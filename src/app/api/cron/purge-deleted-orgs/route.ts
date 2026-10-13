import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { dueOrgs, purgeOrg } from '@/lib/labelos/org-lifecycle-store';
import { createLogger } from '@/lib/log';
import { deleteOrgObjects } from '@/lib/storage/org-objects';

const log = createLogger('cron.purge-deleted-orgs');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Postgres / PostgREST wording for a table that is not there (136 not applied). */
const MISSING_SCHEMA = /does not exist|schema cache|Could not find the table/i;
export const maxDuration = 300;

/** A run purges at most this many orgs; the rest wait for tomorrow (a purge lists and deletes every object). */
const ORGS_PER_RUN = 5;

/**
 * Permanently delete the organizations whose 30-day grace period (D10) is
 * over (LABEL-39): first every object under `orgs/<org_id>/`, then the
 * organization row, whose ON DELETE CASCADE removes every row of the org —
 * audit events included, which is why they "survive until hard delete".
 *
 * An org whose objects cannot be deleted is KEPT (and retried tomorrow), never
 * half-purged. Idempotent: an org already gone is simply not listed.
 * CRON_SECRET-gated like every scheduled route, and a no-op where Supabase is
 * not configured or the Label OS migrations are not applied yet. It does NOT
 * look at LABEL_OS_ENABLED: an owner was promised a deletion date, and
 * switching the flag off must not stall it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ skipped: 'Supabase not configured' });

  const admin = createServiceClient();
  try {
    const due = await dueOrgs(admin, new Date(), ORGS_PER_RUN);
    const outcomes = [];
    for (const org of due) {
      const outcome = await purgeOrg(admin, org, deleteOrgObjects);
      if (outcome.status === 'purged') log.info('org purged', { orgId: org.id, objects: outcome.objects });
      outcomes.push(outcome);
    }
    return NextResponse.json({
      due: due.length,
      purged: outcomes.filter((o) => o.status === 'purged').length,
      kept: outcomes.filter((o) => o.status === 'kept').map((o) => ({ orgId: o.orgId, reason: (o as { reason: string }).reason })),
    });
  } catch (err) {
    if (MISSING_SCHEMA.test(errorMessage(err))) return NextResponse.json({ skipped: 'Label OS migrations are not applied' });
    log.error('purge failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
