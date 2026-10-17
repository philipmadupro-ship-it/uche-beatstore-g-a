/**
 * GET /api/org/[orgId]/releases/[releaseId]/store — where the release stands
 *      on the public store, and what listing or unlisting it would do.
 * PUT /api/org/[orgId]/releases/[releaseId]/store — `{ listed: true,
 *      playback? }` puts a RELEASED release on the store; `{ listed: false,
 *      delete_previews? }` takes it off (LABEL-42, D8).
 *
 * `release.write` on the release (requireObjectAccess: 404 for another org's
 * release, one outside the member's artists or a producer-side id). The rules
 * are the pure lib/labelos/store-listing:
 *   - only a released release lists (delivered with its date come, or
 *     imported as already out); anything else is 409, nothing is written;
 *   - only the store owner's studio, or an artist connected to it, may list
 *     (Phase 8 brings label / artist storefronts): any other org is 409;
 *   - listing in `preview` mode COPIES each item's private clip to the public
 *     bucket (`promotePreviews`); `full` mode copies nothing — the master is
 *     streamed through the server by /api/store/releases/[id]/audio/[item];
 *   - unlisting deletes the promoted previews only if the music was never
 *     publicly out AND the owner asked for it (the GET says when to ask).
 * Both directions are AUDIT events (`release.store_listed` / `…_unlisted`):
 * written right after the change, and the change is put back if the event
 * cannot be written — a public listing with no record cannot stand.
 * Migration 158 (`store_playback`) missing: GET reads as 'preview'; choosing
 * `full` answers 503 naming it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { orgHasModule, requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgReleaseStoreBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { releaseEventSubject } from '@/lib/labelos/releases';
import { planList, planUnlist, releasedPublicly, type ListingFacts } from '@/lib/labelos/store-listing';
import {
  blockedItems,
  loadListingItems,
  loadListingRelease,
  loadStoreOwnerOrgs,
  readPlayback,
} from '@/lib/labelos/store-listing-store';
import { deletePromotedPreviews, promotePreviews } from '@/lib/storage/store-release-media';
import { isR2Configured } from '@/lib/local-store';
import { fail, importedNeedsOwnerOrAdmin, schemaAware } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.store');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

const NEEDS_158 = () => json(503, { error: 'Choosing how a release plays on the store needs migration 158 applied on Supabase.', migration: '158', schemaReady: false });

function stateOf(r: ListingFacts & { store_listed_at: string | null }, playback: string, canList: unknown, ask: boolean) {
  return { listed: r.store_listed, listedAt: r.store_listed_at, playback, canList, unlist: { askToDeletePreviews: r.store_listed && ask } };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const org = access.object.orgId;
  try {
    const release = await loadListingRelease(access.admin, org, access.object.id);
    if (!release) return json(404, { error: 'Not found' });
    // Store listing is a licensed module (LABEL-47): absent for an org without it — except a release that is
    // still listed from before the module was withdrawn, which must stay readable so it can be taken off.
    if (!orgHasModule(access, 'store') && !release.store_listed) return json(404, { error: 'Not found' });
    const [owner, items, { playback, schemaReady }] = await Promise.all([
      loadStoreOwnerOrgs(access.admin),
      loadListingItems(access.admin, org, release.id),
      readPlayback(access.admin, release.id),
    ]);
    const now = new Date();
    const plan = planList({ release, itemCount: items.length, orgId: org, owner, currentPlayback: playback, blockedItems: blockedItems(items) }, now);
    const unlist = planUnlist({ ...release, store_listed: true }, false, now);
    return json(200, {
      ...stateOf(release, playback, plan.ok ? { ok: true } : { ok: false, error: plan.error, field: plan.field ?? null }, unlist.ok && unlist.askToDeletePreviews),
      playbackChoice: schemaReady,
    });
  } catch (err) {
    log.error('state failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the store listing' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const parsed = await readBody(req, OrgReleaseStoreBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  // Store listing is a licensed module (LABEL-47): listing or changing a listing needs it. Taking a release
  // OFF the store does not — once the module is withdrawn, an earlier listing must still be removable
  // (the same rule as removing a saved Slack webhook).
  if (body.listed && !orgHasModule(access, 'store')) return json(404, { error: 'Not found' });
  const { admin } = access;
  const org = access.object.orgId;
  const actor = { orgId: org, userId: access.userId };

  let release;
  try {
    release = await loadListingRelease(admin, org, access.object.id);
  } catch (err) {
    log.error('read failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the release' });
  }
  if (!release) return json(404, { error: 'Not found' });
  // An import is the owner's word: listing it, changing how it plays and taking it off are theirs (or an admin's).
  const notYours = importedNeedsOwnerOrAdmin(release, access.role);
  if (notYours) return notYours.res;
  // "Full" puts whole masters in front of anyone: the owner's or an admin's choice (like the import's).
  if (body.listed && body.playback === 'full' && access.role !== 'owner' && access.role !== 'admin') {
    return json(403, { error: 'Only an owner or an admin can choose full songs for the store', field: 'playback' });
  }
  const subject = releaseEventSubject(release);
  const now = new Date();

  /* ── take it off ─────────────────────────────────────────────────── */
  if (!body.listed) {
    const plan = planUnlist(release, body.delete_previews === true, now);
    if (!plan.ok) return json(plan.status, { error: plan.error, field: plan.field });
    // Playback goes back to the default with the listing: a later listing by someone who may not choose
    // `full` must not inherit a manager's earlier choice.
    const was = await readPlayback(admin, release.id);
    const before = { store_listed: true, store_listed_at: release.store_listed_at, ...(was.schemaReady ? { store_playback: was.playback } : {}) };
    const { data, error } = await admin
      .from('releases')
      .update({ store_listed: false, store_listed_at: null, ...(was.schemaReady ? { store_playback: 'preview' } : {}) })
      .eq('id', release.id)
      .eq('org_id', org)
      .eq('store_listed', true)
      .select('id')
      .maybeSingle();
    if (error) return fail(500, 'Could not take the release off the store').res;
    if (!data) return json(409, { error: 'This release is not on the store', field: 'store_listed' });
    try {
      await recordEvent(admin, actor, 'release.store_unlisted', subject, {
        askedToDeletePreviews: plan.askToDeletePreviews,
        deletePreviews: plan.deletePreviews,
      });
    } catch (err) {
      log.error('unlist audit failed', { releaseId, error: errorMessage(err) });
      const { error: revertError } = await admin.from('releases').update(before).eq('id', release.id).eq('org_id', org).eq('store_listed', false);
      if (revertError) {
        log.error('unlist put-back FAILED: release is off the store without its event', { releaseId, error: revertError.message });
        return json(500, { error: 'The release is off the store, but the record of it could not be written. Nothing is public; putting it on and taking it off again is safe.', listed: false });
      }
      return json(500, { error: 'Could not take the release off the store' });
    }
    let previewsDeleted = false;
    if (plan.deletePreviews) {
      try {
        await deletePromotedPreviews(release.id);
        previewsDeleted = true;
      } catch (err) {
        // The release is already off the store; say the previews are still there rather than failing the unlist.
        log.error('preview delete failed', { releaseId, error: errorMessage(err) });
      }
    }
    return json(200, { listed: false, previewsDeleted });
  }

  /* ── put it on ───────────────────────────────────────────────────── */
  let owner;
  let items;
  let current;
  try {
    [owner, items, current] = await Promise.all([
      loadStoreOwnerOrgs(admin),
      loadListingItems(admin, org, release.id),
      readPlayback(admin, release.id),
    ]);
  } catch (err) {
    log.error('listing facts failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the release' });
  }
  const plan = planList(
    { release, itemCount: items.length, orgId: org, owner, playback: body.playback, currentPlayback: current.playback, blockedItems: blockedItems(items) },
    now,
  );
  if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
  if (!current.schemaReady && body.playback === 'full') return NEEDS_158();

  // What a visitor can play must exist before the release is public.
  let promoted: string[] = [];
  try {
    if (plan.playback === 'preview') {
      promoted = await promotePreviews(org, release.id, items.map((i) => ({ masterTrackId: i.master_track_id, privatePreviewRef: i.master_preview_ref })));
      // ALL or nothing: a listed release with a silent track is worse than one that waits a few minutes.
      const missing = items.filter((i) => !promoted.includes(i.master_track_id));
      if (isR2Configured() && missing.length > 0) {
        if (promoted.length > 0 && !plan.alreadyListed) await deletePromotedPreviews(release.id).catch(() => undefined);
        return json(409, {
          error: `The preview of ${missing.map((i) => `“${i.title}”`).join(', ')} is not ready yet; try again in a few minutes`,
          field: 'items',
          items: missing.map((i) => i.id),
        });
      }
    } else if (!items.some((i) => i.master_audio_ref)) {
      return json(409, { error: 'None of the recordings on this release can be played', field: 'items' });
    }
  } catch (err) {
    log.error('promote failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not prepare the previews' });
  }

  const before = { store_listed: release.store_listed, store_listed_at: release.store_listed_at };
  const listedAt = release.store_listed_at ?? now.toISOString();
  // Guarded: the statement itself repeats what the plan judged (state, import flag and release date as
  // read), so a change between the plan and this write cannot store a listing for a release that is
  // not out. The date of a release that went out is fixed by the PATCH route as well.
  let guarded = admin
    .from('releases')
    .update({ store_listed: true, store_listed_at: listedAt, ...(current.schemaReady ? { store_playback: plan.playback } : {}) })
    .eq('id', release.id)
    .eq('org_id', org)
    .eq('state', release.state)
    .eq('imported_released', release.imported_released);
  guarded = release.release_date === null ? guarded.is('release_date', null) : guarded.eq('release_date', release.release_date);
  const { data: claimed, error } = await guarded.select('id').maybeSingle();
  if (error) return fail(500, 'Could not put the release on the store').res;
  if (!claimed) {
    // The release changed under the plan. Copies promoted for it must not stay public if the music is not
    // (and was not) publicly out — judged on the release as it is now.
    if (!plan.alreadyListed && promoted.length > 0) {
      try {
        const fresh = await loadListingRelease(admin, org, release.id);
        if (!fresh || !releasedPublicly(fresh, new Date())) await deletePromotedPreviews(release.id);
      } catch (cleanupErr) {
        log.error('could not remove the previews promoted for a listing that did not happen', { releaseId, error: errorMessage(cleanupErr) });
      }
    }
    return json(409, { error: 'The release changed while it was being listed; check it and try again', field: 'state' });
  }
  // recordEvent + put-back, as LABEL-33's delivery: there is no audit RPC for these verbs (that would be a
  // second migration), so the change is written first and undone if its record cannot be written.
  try {
    await recordEvent(admin, actor, 'release.store_listed', subject, {
      playback: plan.playback,
      items: items.length,
      promoted: promoted.length,
      relisted: plan.alreadyListed,
    });
  } catch (err) {
    log.error('list audit failed', { releaseId, error: errorMessage(err) });
    const { error: revertError } = await admin
      .from('releases')
      .update({ ...before, ...(current.schemaReady ? { store_playback: current.playback } : {}) })
      .eq('id', release.id)
      .eq('org_id', org);
    if (revertError) {
      // A public listing with no event: say so loudly. The release stays listed until an owner unlists it.
      log.error('list put-back FAILED: release is listed without its event', { releaseId, error: revertError.message });
      return json(500, { error: 'The release was listed but could not be recorded, and could not be undone. Take it off the store and try again.', listed: true });
    }
    if (!plan.alreadyListed && promoted.length > 0) await deletePromotedPreviews(release.id).catch(() => undefined);
    return json(500, { error: 'Could not put the release on the store' });
  }
  return json(200, { listed: true, playback: plan.playback, promoted: promoted.length });
}
