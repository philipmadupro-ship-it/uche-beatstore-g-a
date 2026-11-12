/**
 * GET /api/org/[orgId]/releases/[releaseId]/readiness — where each of the
 * release's seven gates stands (LABEL-32, 09 §4). Derived on every read from
 * the tracklist, legal readiness, approvals and the org's switches; nothing
 * is stored. No event: a read.
 *
 * Authorised like the release itself: requireObjectAccess on `releases`
 * (`catalog.read`, scope through the release's project): 404 for another
 * org's release, one outside the member's artists, a producer-side id or a
 * missing one. External project members never reach it.
 *
 * What the caller is told: a blocker that would name a party, a legal
 * identifier or a split (the credits & splits gate) is listed only with
 * `rights.read`; without it the gate still reports its status and the
 * counts. Migrations 144 / 153 / 155 / 157 missing answer
 * `{ schemaReady: false }`, as the song's legal readiness does.
 */
import { mayReadRightsDetail } from '@/lib/labelos/credits';
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { evaluateReleaseReadiness, releaseReadinessView } from '@/lib/labelos/release-readiness';
import { loadReleaseReadinessFacts, ReleaseReadinessNotReadyError } from '@/lib/labelos/release-readiness-store';
import { schemaAware } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.readiness');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Release readiness needs Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) {
    const denied = await schemaAware(access);
    // Migration 144 missing is "not set up", like the other readiness route.
    return denied.res.status === 503 ? json(200, { schemaReady: false }) : denied.res;
  }

  try {
    const facts = await loadReleaseReadinessFacts(access.admin, access.object.orgId, access.object.id);
    if (!facts) return json(404, { error: 'Not found' });
    const readiness = releaseReadinessView(evaluateReleaseReadiness(facts), mayReadRightsDetail(access.capabilities, access.role));
    return json(200, { schemaReady: true, readiness });
  } catch (err) {
    if (err instanceof ReleaseReadinessNotReadyError) return json(200, { schemaReady: false });
    log.error('release readiness failed', { orgId: access.object.orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not work out release readiness' });
  }
}
