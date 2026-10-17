/**
 * PATCH /api/platform/licensees/[orgId] — replace a licensee's licence
 * (LABEL-47): its modules and its seat / artist caps (null = unlimited).
 * Platform operators only; everyone else 404. Only live artist / label orgs:
 * the producer's own org is not a licensee (404).
 *
 * One database function writes the row and the audit event
 * `org.entitlements_changed` (with what it replaced) in the org itself. A cap
 * set below what the org already uses is allowed: it only stops further
 * additions, it never removes anyone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/platform-access';
import { PlatformEntitlementsBodySchema } from '@/lib/contracts';
import { accountFace } from '@/lib/labelos/account';
import { auditRpc } from '@/lib/labelos/audit-rpc';
import { ReadError } from '@/lib/labelos/paged-read';
import { licensePayload, planLicense } from '@/lib/labelos/platform';
import { PLATFORM_NOT_READY, isMissingPlatform, readLicenceRow, readLicenseeOrg } from '@/lib/labelos/platform-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';

const log = createLogger('api.platform.licensee');
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access.res;
  const { orgId } = await params;
  if (!isUUID(orgId)) return NOT_FOUND();
  const parsed = await readBody(req, PlatformEntitlementsBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const org = await readLicenseeOrg(access.admin, orgId);
    const face = org ? accountFace(org) : null;
    if (!org || !face) return NOT_FOUND();
    const plan = planLicense({ face, ...parsed.data });
    const previous = await readLicenceRow(access.admin, org.id);
    const { data, error } = await auditRpc(access.admin, 'platformSetEntitlements', {
      p_actor: access.userId,
      p_org: org.id,
      p_modules: plan.modules,
      p_max_seats: plan.maxSeats,
      p_max_artists: plan.maxArtists,
      p_payload: licensePayload(plan, previous),
    });
    if (isMissingPlatform(error)) return NextResponse.json({ error: PLATFORM_NOT_READY }, { status: 503 });
    if (error) throw new Error(error.message);
    if (data?.error === 'not_found' || data?.error === 'not_operator') return NOT_FOUND();
    return NextResponse.json({ entitlements: data?.entitlements ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof ReadError && isMissingPlatform(err.raw)) return NextResponse.json({ error: PLATFORM_NOT_READY }, { status: 503 });
    log.error('set entitlements failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not save the licence' }, { status: 500 });
  }
}
