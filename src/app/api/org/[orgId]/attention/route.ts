/**
 * GET /api/org/[orgId]/attention (LABEL-35) — the Overview's "Needs
 * attention" list (04 W8, 07 §2.1): blocked releases near their target date,
 * songs stalled in a stage, overdue tasks. Each item names a person and a
 * next action.
 *
 * Capability `catalog.read`, like the Overview it sits on. Everything is
 * computed from what the caller may see (lib/labelos/attention-store): an
 * artists-scoped member gets only their artists' items, a song they may not
 * read (D4) is a count and never a title, and a task is theirs only as its
 * maker, assignee or an owner/admin. Read-only, so it records no event, and
 * not reachable by an external project member (they hold no org membership).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadAttention } from '@/lib/labelos/attention-store';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.attention');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  try {
    const attention = await loadAttention(access);
    return NextResponse.json({ attention }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('attention load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load what needs attention' }, { status: 500 });
  }
}
