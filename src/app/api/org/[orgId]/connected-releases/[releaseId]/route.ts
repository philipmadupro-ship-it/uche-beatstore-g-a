/**
 * PUT /api/org/[orgId]/connected-releases/[releaseId] — the store owner's
 * Unlist and Allow again for one release of a connected artist (LABEL-71).
 * `{ listed: false }` takes it off THIS store; `{ listed: true }` lifts that.
 *
 * It is a veto kept in the LABEL org's own rows (`store_listing_vetoes`): the
 * artist org is never written to (LABEL-41), and the public routes read the
 * veto next to `store_listed`, so the release stops serving on the next
 * request. Allowing it again lists nothing — whether the release is on the
 * store is still the artist side's act, and a credited artist's `no` still
 * holds. A repeat is a 200 that writes nothing.
 *
 * Store owner only (same 404 as the list). An audit act on both sides:
 * `listing.vetoed` / `listing.veto_lifted` in the label org, and a copy in the
 * artist org's feed, best effort. A veto is the safe direction — if its event
 * cannot be written it stands and the caller is told; lifting one is put back
 * if its event cannot be written. Migration 186 missing: 503 naming it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody, isUUID } from '@/lib/validate';
import { OrgConnectedReleaseBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { releaseEventSubject } from '@/lib/labelos/releases';
import { planVeto } from '@/lib/labelos/store-consent';
import { NEEDS_186, readVeto } from '@/lib/labelos/store-consent-store';
import { connectedReleaseFor, isStoreOwner } from '@/lib/labelos/connected-releases-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.connected-releases.veto');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Not found' });

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, releaseId: rawId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  if (!isUUID(rawId)) return NOT_FOUND();
  const releaseId = rawId.toLowerCase();
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  if (access.orgKind !== 'label' || access.role !== 'owner') return NOT_FOUND();
  const parsed = await readBody(req, OrgConnectedReleaseBodySchema);
  if (!parsed.ok) return parsed.res;
  const { admin, orgId: org, userId } = access;
  const want = parsed.data.listed ? 'allow' : 'veto';

  try {
    if (!(await isStoreOwner(admin, userId))) return NOT_FOUND();
    const release = await connectedReleaseFor(admin, org, releaseId);
    if (!release) return NOT_FOUND();
    const veto = await readVeto(admin, release.id);
    if (!veto.schemaReady) return json(503, { error: NEEDS_186, migration: '186', schemaReady: false });
    const plan = planVeto({ want, vetoed: veto.vetoed, listed: release.store_listed });
    if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
    if (plan.change === 'none') return json(200, { listed: want === 'allow', changed: false });

    const label = { orgId: org, userId };
    if (plan.change === 'veto') {
      const { error } = await admin.from('store_listing_vetoes').upsert({ release_id: release.id, org_id: org, vetoed_by: userId }, { onConflict: 'release_id', ignoreDuplicates: true });
      if (error) {
        log.error('veto write failed', { releaseId, error: error.message });
        return json(500, { error: 'Could not take the release off the store' });
      }
      try {
        await recordEvent(admin, label, 'listing.vetoed', { type: 'release', id: release.id, releaseId: release.id }, { listed: false });
      } catch (err) {
        // The safe direction stands: the release is off the store; only its record is missing.
        log.error('veto audit failed (the veto stands)', { releaseId, error: errorMessage(err) });
        return json(500, { error: 'The release is off your store, but the record of it could not be written. Nothing is public.', listed: false, recorded: false });
      }
    } else {
      const { error } = await admin.from('store_listing_vetoes').delete().eq('release_id', release.id).eq('org_id', org);
      if (error) {
        log.error('veto lift failed', { releaseId, error: error.message });
        return json(500, { error: 'Could not allow the release again' });
      }
      try {
        await recordEvent(admin, label, 'listing.veto_lifted', { type: 'release', id: release.id, releaseId: release.id }, { listed: true });
      } catch (err) {
        log.error('veto-lift audit failed: putting the veto back', { releaseId, error: errorMessage(err) });
        const back = await admin.from('store_listing_vetoes').upsert({ release_id: release.id, org_id: org, vetoed_by: userId }, { onConflict: 'release_id', ignoreDuplicates: true });
        if (back.error) log.error('veto put-back FAILED: the release is allowed without its event', { releaseId, error: back.error.message });
        return json(500, { error: 'Could not allow the release again; nothing was changed. Try again.' });
      }
    }

    // The artist side sees what happened to its release, in its own feed. Best effort: the label's event is the audited one.
    try {
      await recordEvent(admin, { orgId: release.org_id, userId }, plan.change === 'veto' ? 'listing.vetoed' : 'listing.veto_lifted', releaseEventSubject(release), { listed: plan.change !== 'veto' });
    } catch (err) {
      log.warn('artist-side veto event not written', { releaseId, error: errorMessage(err) });
    }
    return json(200, { listed: plan.change === 'allow', changed: true });
  } catch (err) {
    log.error('veto failed', { orgId: org, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not change the release' });
  }
}
