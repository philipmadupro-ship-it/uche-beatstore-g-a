/**
 * GET /api/org/[orgId]/overview (LABEL-18) — the owner's roster view:
 * artists × songs by stage and each artist's next release (07 §2.1).
 *
 * Capability `catalog.read`. Everything is computed from what the caller
 * may see: an artists-scoped member gets only their artists (and totals
 * over only those), and songs they may not see (D4) are a count, never a
 * title (lib/labelos/overview-store).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadOrgOverview } from '@/lib/labelos/overview-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.overview');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  try {
    const overview = await loadOrgOverview(access);
    return NextResponse.json({ overview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('overview load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the overview' }, { status: 500 });
  }
}
