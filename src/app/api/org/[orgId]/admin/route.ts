/**
 * GET /api/org/[orgId]/admin (doc 25, phase 3) — what the admin centre shows:
 * the team in numbers (roles, team accounts waiting on a password or switched
 * off, pending invitations), seats and roster artists against the licence,
 * the licensed modules, and the last few team changes.
 *
 * Capability `members.manage` (owner and admin). Counts and names only — no
 * email, no settings value, no payload. The team changes are internal events,
 * listed only for a whole-org member with `business.read.internal`
 * (`recent: null` otherwise). Read-only, so it records no event; an external
 * project member holds no org membership and is refused like anyone else.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { ADMIN_CENTRE_CAPABILITY, mayOpenAdminCentre } from '@/lib/labelos/admin-centre';
import { loadAdminSummary } from '@/lib/labelos/admin-centre-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.admin');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, ADMIN_CENTRE_CAPABILITY);
  if (!access.ok) return access.res;
  // A producer org is run from the dashboard; it has no admin centre.
  if (!mayOpenAdminCentre({ role: access.role, orgKind: access.orgKind, capabilities: access.capabilities })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const summary = await loadAdminSummary(access);
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    log.error('admin summary failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the admin centre' }, { status: 500 });
  }
}
