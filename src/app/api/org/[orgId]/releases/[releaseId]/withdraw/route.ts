/**
 * POST /api/org/[orgId]/releases/[releaseId]/withdraw — pull a DELIVERED
 * release back (LABEL-56). Cancelling is for a draft; a release that went out
 * is withdrawn: the record, its tracklist and its gates history stay, it comes
 * off the public store, and it is not delivered again. Body: `{ note?,
 * delete_previews? }`.
 *
 * `release.write` on the release (requireObjectAccess: 404 for another org's
 * release, one outside the member's artists or a producer-side id). A release
 * entered as already out is, as everywhere, the owner's or an admin's. The
 * rules are the pure lib/labelos/release-withdrawal:
 *   - only a `delivered` release; anything else is 409, nothing is written;
 *   - if it is on the store, the same step takes it off, by LABEL-42's unlist
 *     rules (`planUnlist`): playback goes back to `preview`, promoted previews
 *     are deleted only for music that was never publicly out AND only if the
 *     caller asked.
 *
 * Idempotency and the audit trail follow LABEL-33's delivery: ONE conditional
 * UPDATE (`… WHERE state = 'delivered'`) claims the change, so two requests
 * cannot both win and a repeat is 409 with no second event. `release.withdrawn`
 * is an audit verb (internal: the reason is business, not the artist's creative
 * record) written right after the claim; if it cannot be written the claim is
 * put back, so a withdrawal with no record cannot stand. When the release was
 * listed, `release.store_unlisted` follows (best effort: the withdrawal event
 * already says `unlisted`).
 *
 * Migration 193 adds the `withdrawn` state; before it the UPDATE is refused by
 * the old CHECK and the answer is 503 naming 193 — nothing else changed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgReleaseWithdrawBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { RELEASE_COLUMNS, releaseEventSubject, toReleaseView, type ReleaseRow } from '@/lib/labelos/releases';
import { planWithdrawal } from '@/lib/labelos/release-withdrawal';
import { loadListingRelease, readPlayback } from '@/lib/labelos/store-listing-store';
import { deletePromotedPreviews } from '@/lib/storage/store-release-media';
import { importedNeedsOwnerOrAdmin, schemaAware } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.withdraw');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

const NEEDS_193 = () =>
  json(503, { error: 'Withdrawing a release needs migration 193 applied on Supabase.', migration: '193', schemaReady: false });

/** The old `releases_state_check` refusing 'withdrawn' (23514), i.e. 193 is not applied. */
const isStateCheck = (error: { code?: string; message?: string }) =>
  error.code === '23514' && /releases_state_check|violates check constraint/i.test(error.message ?? '');

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const parsed = await readBody(req, OrgReleaseWithdrawBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { admin } = access;
  const org = access.object.orgId;

  let release;
  try {
    release = await loadListingRelease(admin, org, access.object.id);
  } catch (err) {
    log.error('read failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the release' });
  }
  if (!release) return json(404, { error: 'Not found' });
  const notYours = importedNeedsOwnerOrAdmin(release, access.role);
  if (notYours) return notYours.res;

  const plan = planWithdrawal(release, { note: body.note ?? null, deletePreviews: body.delete_previews === true }, new Date());
  if (!plan.ok) return json(plan.status, { error: plan.error, field: plan.field });

  const was = plan.unlist ? await readPlayback(admin, release.id).catch(() => ({ playback: 'preview' as const, schemaReady: false })) : { playback: 'preview' as const, schemaReady: false };
  const before = {
    state: 'delivered',
    store_listed: release.store_listed,
    store_listed_at: release.store_listed_at,
    ...(plan.unlist && was.schemaReady ? { store_playback: was.playback } : {}),
  };

  // Claim delivered → withdrawn (and off the store, in the same statement: a withdrawn release cannot be listed).
  let withdrawn: ReleaseRow | null;
  try {
    const { data, error } = await admin
      .from('releases')
      .update({
        state: 'withdrawn',
        ...(plan.unlist ? { store_listed: false, store_listed_at: null, ...(was.schemaReady ? { store_playback: 'preview' } : {}) } : {}),
      })
      .eq('id', release.id)
      .eq('org_id', org)
      .eq('state', 'delivered')
      .eq('store_listed', release.store_listed)
      .select(RELEASE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (isStateCheck(error)) return NEEDS_193();
      log.error('withdraw failed', { releaseId, error: error.message });
      return json(500, { error: 'Could not withdraw the release' });
    }
    withdrawn = (data as unknown as ReleaseRow | null) ?? null;
  } catch (err) {
    log.error('withdraw failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not withdraw the release' });
  }
  if (!withdrawn) return json(409, { error: 'The release changed while it was being withdrawn; check it and try again', field: 'state' });

  const actor = { orgId: org, userId: access.userId };
  const subject = releaseEventSubject(release);
  try {
    await recordEvent(
      admin,
      actor,
      'release.withdrawn',
      subject,
      {
        title: release.title,
        wasListed: release.store_listed,
        unlisted: plan.unlist,
        ...(plan.unlist ? { askedToDeletePreviews: plan.askToDeletePreviews, deletePreviews: plan.deletePreviews } : {}),
        ...(plan.note ? { note: plan.note } : {}),
      },
      { visibility: 'internal' },
    );
  } catch (err) {
    // No withdrawal without its record: put the delivery (and its listing) back, only if it is still our claim.
    log.error('withdraw audit failed', { releaseId, error: errorMessage(err) });
    const { error: revertError } = await admin
      .from('releases')
      .update(before)
      .eq('id', release.id)
      .eq('org_id', org)
      .eq('state', 'withdrawn');
    if (revertError) {
      log.error('withdraw put-back FAILED: release is withdrawn without its event', { releaseId, error: revertError.message });
      return json(500, { error: 'The release was withdrawn but the record of it could not be written, and it could not be undone. Withdraw it again, or ask an owner.', withdrawn: true });
    }
    return json(500, { error: 'Could not withdraw the release' });
  }

  if (plan.unlist) {
    try {
      await recordEvent(admin, actor, 'release.store_unlisted', subject, {
        askedToDeletePreviews: plan.askToDeletePreviews,
        deletePreviews: plan.deletePreviews,
        viaWithdrawal: true,
      });
    } catch (err) {
      log.error('unlist event after a withdrawal failed (the withdrawal event records the unlisting)', { releaseId, error: errorMessage(err) });
    }
  }

  let previewsDeleted = false;
  if (plan.deletePreviews) {
    try {
      await deletePromotedPreviews(release.id);
      previewsDeleted = true;
    } catch (err) {
      // Already withdrawn and off the store; say the previews are still there rather than failing the withdrawal.
      log.error('preview delete failed', { releaseId, error: errorMessage(err) });
    }
  }

  return json(200, { release: toReleaseView(withdrawn), unlisted: plan.unlist, previewsDeleted });
}
