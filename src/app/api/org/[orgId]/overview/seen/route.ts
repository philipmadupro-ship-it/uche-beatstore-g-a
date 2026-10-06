/**
 * POST /api/org/[orgId]/overview/seen (LABEL-20) — the member has looked at
 * the Overview's digest through `through` (the `asOf` it was served with).
 * Moves `user_profiles.last_seen_overview_at` forward, never back and never
 * past now, for the SESSION's user: the body names no one, so no member can
 * move another's mark. The column is one per user, not per org
 * (lib/labelos/last-seen). Capability `catalog.read`, the one the digest needs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { OrgOverviewSeenBodySchema } from '@/lib/contracts';
import { markOverviewSeen } from '@/lib/labelos/last-seen';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.overview.seen');

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgOverviewSeenBodySchema);
  if (!parsed.ok) return parsed.res;

  const result = await markOverviewSeen(access.admin, access.userId, parsed.data.through);
  if (!result.ok) {
    log.error('mark seen failed', { orgId: access.orgId, error: result.error });
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
  }
  return NextResponse.json({ lastSeenAt: result.lastSeenAt }, { headers: { 'Cache-Control': 'no-store' } });
}
