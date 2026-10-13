/**
 * GET and POST /api/org/[orgId]/restore — bring back an organization inside its grace
 * period (LABEL-39, D10). Owner of a SOFT-DELETED org only; 404 for anyone
 * else, so the route never confirms that a deleted org exists. No fresh
 * sign-in is demanded: restoring cannot lose anything.
 *
 * Reachable without any live membership (proxy gate `session`,
 * lib/security/api-gate#isLabelOsRestoreApiPath): the owner of the only org
 * they had is, once it is deleted, a member of nothing the membership gate
 * can see.
 *
 * 410 once the grace period is over (the purge cron may already be removing
 * it). `org.restored` is an audit event; if it cannot be written the org is
 * deleted again with its original stamp and the request fails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgOwner } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import { canRestore, graceDaysLeft, purgeAfter } from '@/lib/labelos/org-lifecycle';
import { restoreOrg, softDeleteOrg } from '@/lib/labelos/org-lifecycle-store';
import { createLogger } from '@/lib/log';

const log = createLogger('api.org.restore');

/** What the restore page shows. Owner of a soft-deleted org only (404 otherwise); read-only. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const owner = await requireOrgOwner(orgId, { state: 'deleted', freshSignIn: false });
  if (!owner.ok) return owner.res;
  const { org } = owner;
  const deletedAt = org.deleted_at!;
  return NextResponse.json(
    {
      org: { id: org.id, name: org.name, slug: org.slug },
      deletedAt,
      purgeAfter: purgeAfter(deletedAt)?.toISOString() ?? null,
      daysLeft: graceDaysLeft(deletedAt),
      canRestore: canRestore(deletedAt),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const owner = await requireOrgOwner(orgId, { state: 'deleted', freshSignIn: false });
  if (!owner.ok) return owner.res;
  const { admin, org } = owner;
  const deletedAt = org.deleted_at!;

  if (!canRestore(deletedAt)) {
    return NextResponse.json({ error: 'The grace period is over; this organization can no longer be restored' }, { status: 410 });
  }

  try {
    if (!(await restoreOrg(admin, org.id, deletedAt))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  } catch (err) {
    log.error('restore org failed', { orgId: org.id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not restore the organization' }, { status: 500 });
  }

  try {
    await recordEvent(admin, { orgId: org.id, userId: owner.userId }, 'org.restored', { type: 'org', id: org.id }, { deletedAt }, { audit: true });
  } catch (err) {
    try {
      await softDeleteOrg(admin, org.id, new Date(deletedAt));
    } catch (revertErr) {
      log.error('could not delete the organization again after a failed audit write', { orgId: org.id, error: errorMessage(revertErr) });
    }
    log.error('restore org audit failed', { orgId: org.id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not restore the organization' }, { status: 500 });
  }
  log.info('org restored', { orgId: org.id });
  return NextResponse.json({ org: { id: org.id, name: org.name, slug: org.slug, kind: org.kind }, href: `/o/${org.slug}` });
}
