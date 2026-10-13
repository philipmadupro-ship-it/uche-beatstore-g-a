/**
 * POST /api/org/[orgId]/releases/[releaseId]/deliver — mark a draft release
 * delivered to a distributor (LABEL-33, 09 §4). No distributor API is called:
 * this records WHO said the release went out, WHERE and WHEN.
 *
 * `release.write` on the release (requireObjectAccess: 404 for another org's
 * release, one outside the member's artists or a producer-side id). The rules
 * are the pure `planDelivery`:
 *   - ready (LABEL-32 `readyToDeliver`, blockers only) → delivers;
 *   - not ready → 422 with the gates, unless `override: true`, which is
 *     OWNER-only (403 otherwise) and needs `override_note` (400 without);
 *   - not a draft → 409, and never a second event.
 *
 * Idempotency: the draft → delivered change is ONE conditional UPDATE
 * (`… WHERE state = 'draft'`), so two requests cannot both claim it; the loser
 * is 409. `release.delivered` is an audit verb and is written right after the
 * claim; if the audit write fails the claim is put back (the same shape as
 * LABEL-39's deletion), so a delivery with no record cannot stand. An
 * overridden delivery's event is `internal`: its note and open gates are
 * business, not the artist's creative record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgReleaseDeliverBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { planDelivery } from '@/lib/labelos/release-delivery';
import { evaluateReleaseReadiness, RELEASE_GATES, releaseReadinessView } from '@/lib/labelos/release-readiness';
import { loadReleaseReadinessFacts, ReleaseReadinessNotReadyError } from '@/lib/labelos/release-readiness-store';
import { RELEASE_COLUMNS, releaseEventSubject, toReleaseView, type ReleaseRow } from '@/lib/labelos/releases';
import { notReady, releaseRow, schemaAware, writeError } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.deliver');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const parsed = await readBody(req, OrgReleaseDeliverBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { release } = found;
  const org = access.object.orgId;

  let readiness;
  try {
    const facts = await loadReleaseReadinessFacts(access.admin, org, release.id);
    if (!facts) return json(404, { error: 'Not found' });
    readiness = evaluateReleaseReadiness(facts);
  } catch (err) {
    if (err instanceof ReleaseReadinessNotReadyError) return notReady().res;
    log.error('readiness failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not work out whether the release is ready' });
  }

  const openGates = RELEASE_GATES.filter((g) => !['approved', 'satisfied', 'not_required'].includes(readiness.gates[g].status));
  const plan = planDelivery(
    { state: release.state, readyToDeliver: readiness.readyToDeliver, openGates },
    { distributor: body.distributor, deliveredOn: body.delivered_on ?? null, override: body.override === true, note: body.override_note ?? null },
    access.role === 'owner',
    new Date(),
  );
  if (!plan.ok) {
    if (plan.status === 422) {
      // The gates, as this caller may read them (rights detail only with rights.read).
      const view = releaseReadinessView(readiness, access.capabilities.has('rights.read'));
      return json(422, { error: plan.error, field: plan.field, readiness: view });
    }
    return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
  }

  // Claim the draft → delivered change; only one request can.
  let delivered: ReleaseRow | null;
  try {
    const { data, error } = await access.admin
      .from('releases')
      .update({ state: 'delivered', delivered_at: plan.deliveredAt, delivered_to: body.distributor })
      .eq('id', release.id)
      .eq('org_id', org)
      .eq('state', 'draft')
      .select(RELEASE_COLUMNS)
      .maybeSingle();
    if (error) return writeError(error, 'Could not deliver the release').res;
    delivered = (data as unknown as ReleaseRow | null) ?? null;
  } catch (err) {
    log.error('deliver failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not deliver the release' });
  }
  if (!delivered) return json(409, { error: 'This release was already delivered', field: 'state' });

  try {
    await recordEvent(
      access.admin,
      { orgId: org, userId: access.userId },
      'release.delivered',
      releaseEventSubject(release),
      {
        distributor: body.distributor,
        deliveredAt: plan.deliveredAt,
        override: plan.override,
        ...(plan.override ? { overrideNote: plan.note, openGates: [...plan.openGates] } : {}),
      },
      plan.override ? { visibility: 'internal' } : {},
    );
  } catch (err) {
    // No delivery without its record: put the draft back, only if it is still our claim.
    try {
      await access.admin
        .from('releases')
        .update({ state: 'draft', delivered_at: null, delivered_to: null })
        .eq('id', release.id)
        .eq('org_id', org)
        .eq('state', 'delivered')
        .eq('delivered_at', plan.deliveredAt);
    } catch (revertErr) {
      log.error('could not put the release back after a failed audit write', { releaseId, error: errorMessage(revertErr) });
    }
    log.error('deliver audit failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not deliver the release' });
  }

  return json(200, { release: toReleaseView(delivered), override: plan.override });
}
