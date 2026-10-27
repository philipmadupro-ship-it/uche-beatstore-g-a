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
 *
 * ARTIST CONSENT (LABEL-71, migration 186). Listing asks every credited artist
 * (the release's artist plus the roster artists behind confirmed credits on
 * its songs) for their say: a `proposed` row each, and one `listing_proposed`
 * notification per account that stands for them. Silence does not block — the
 * release serves — but any artist's `no` is final: `planList` refuses to list
 * (or re-list) until that artist says yes, and the public routes stop serving
 * on the next request. An artist with no account in the org cannot be told and
 * is counted as unreachable in the answer; nothing is invented for them. The
 * artists' proposals are written BEFORE the release goes public, so a failure
 * there leaves it private. Migration 186 missing: no consent step (the store
 * behaves as it did before LABEL-71).
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
import { proposalRecipients, summarizeConsents, planProposal, answerableContacts } from '@/lib/labelos/store-consent';
import { insertProposals, loadAccountLinks, loadCreditedArtists, readConsents, readVeto } from '@/lib/labelos/store-consent-store';
import { askArtistsAboutListing } from '@/lib/labelos/store-consent-notify';
import { askerName } from '@/lib/labelos/tasks-store';
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

/**
 * What the viewer may read of the consent step: the rolled-up status of the release, one line per artist
 * IN THEIR OWN SCOPE (a member limited to some artists is not told the others' names or answers), and the
 * contacts they themselves answer for (an artist sees their own question here too).
 */
async function consentView(
  access: { admin: any; orgId: string; userId: string; artistScope: ReadonlySet<string> | readonly string[] | null },
  release: { id: string },
  consents: Awaited<ReturnType<typeof readConsents>>,
) {
  if (!consents.schemaReady) return { schemaReady: false };
  const summary = summarizeConsents(consents.rows);
  const scope = access.artistScope === null ? null : new Set([...access.artistScope].map((c) => c.toLowerCase()));
  const visible = consents.rows.filter((r) => scope === null || scope.has(r.artist_contact_id));
  const ids = visible.map((r) => r.artist_contact_id);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await access.admin.from('contacts').select('id, name').eq('org_id', access.orgId).in('id', ids);
    for (const c of (data ?? []) as { id: string; name: string | null }[]) names.set(c.id.toLowerCase(), c.name ?? 'Artist');
  }
  const mine = new Set(await answerableForViewer(access, consents));
  return {
    schemaReady: true,
    status: summary.status,
    artists: visible.map((r) => ({ contactId: r.artist_contact_id, name: names.get(r.artist_contact_id) ?? 'Artist', state: r.state, decidedAt: r.decided_at, mine: mine.has(r.artist_contact_id) })),
    releaseId: release.id,
  };
}

async function answerableForViewer(access: { admin: any; orgId: string; userId: string }, consents: Awaited<ReturnType<typeof readConsents>>): Promise<string[]> {
  const links = await loadAccountLinks(access.admin, access.orgId, consents.rows.map((r) => r.artist_contact_id));
  return answerableContacts(links, access.userId);
}

async function consentStatus(admin: any, releaseId: string) {
  try {
    return summarizeConsents((await readConsents(admin, releaseId)).rows).status;
  } catch {
    return 'waiting' as const;
  }
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
    const [owner, items, { playback, schemaReady }, consents, veto] = await Promise.all([
      loadStoreOwnerOrgs(access.admin),
      loadListingItems(access.admin, org, release.id),
      readPlayback(access.admin, release.id),
      readConsents(access.admin, release.id),
      readVeto(access.admin, release.id),
    ]);
    const now = new Date();
    const plan = planList({ release, itemCount: items.length, orgId: org, owner, currentPlayback: playback, blockedItems: blockedItems(items), consent: consents.rows, vetoed: veto.vetoed }, now);
    const unlist = planUnlist({ ...release, store_listed: true }, false, now);
    return json(200, {
      ...stateOf(release, playback, plan.ok ? { ok: true } : { ok: false, error: plan.error, field: plan.field ?? null }, unlist.ok && unlist.askToDeletePreviews),
      playbackChoice: schemaReady,
      consent: await consentView(access, release, consents),
      vetoed: veto.vetoed,
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
  let consents;
  let veto;
  try {
    [owner, items, current, consents, veto] = await Promise.all([
      loadStoreOwnerOrgs(admin),
      loadListingItems(admin, org, release.id),
      readPlayback(admin, release.id),
      readConsents(admin, release.id),
      readVeto(admin, release.id),
    ]);
  } catch (err) {
    log.error('listing facts failed', { releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the release' });
  }
  const plan = planList(
    { release, itemCount: items.length, orgId: org, owner, playback: body.playback, currentPlayback: current.playback, blockedItems: blockedItems(items), consent: consents.rows, vetoed: veto.vetoed },
    now,
  );
  if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
  if (!current.schemaReady && body.playback === 'full') return NEEDS_158();

  // Ask the credited artists BEFORE anything goes public: the proposals are plain rows (idempotent), so a
  // failure here, or a later one, leaves the release private and the artists simply not yet notified.
  let proposal: { asked: string[]; recipients: ReturnType<typeof proposalRecipients>['recipients']; unreachable: string[] } = { asked: [], recipients: [], unreachable: [] };
  if (consents.schemaReady) {
    try {
      const credited = await loadCreditedArtists(admin, release);
      const planned = planProposal(credited, consents.rows);
      // A fresh listing asks everyone still unanswered (an earlier attempt may have written the rows but never
      // got as far as the bell); a change to a listing already public only asks the artists newly credited.
      const unanswered = new Set(consents.rows.filter((r) => r.state === 'proposed').map((r) => r.artist_contact_id));
      const toAsk = plan.alreadyListed ? planned.insert : credited.filter((c) => planned.insert.includes(c) || unanswered.has(c));
      const links = toAsk.length > 0 ? await loadAccountLinks(admin, org, toAsk) : [];
      const who = proposalRecipients(toAsk, links, access.userId);
      const { error: askError } = await insertProposals(admin, release, planned.insert, access.userId);
      if (askError) {
        log.error('consent proposals failed', { releaseId, error: askError.message });
        return json(500, { error: 'Could not ask the artists on this release; nothing was listed' });
      }
      proposal = { asked: toAsk, recipients: who.recipients, unreachable: who.unreachable };
    } catch (err) {
      log.error('consent facts failed', { releaseId, error: errorMessage(err) });
      return json(500, { error: 'Could not read who is credited on this release; nothing was listed' });
    }
  }

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
      // LABEL-71: counts only — never who, never what they answered.
      consentAsked: proposal.asked.length,
      consentUnreachable: proposal.unreachable.length,
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
  // Tell the artists. Best effort, after the listing is recorded: the release is listed either way, and a
  // bell that failed to write is the lister's to see in `consent.notified`, not a failed listing.
  let notified = 0;
  if (proposal.recipients.length > 0) {
    const res = await askArtistsAboutListing(admin, {
      orgId: org,
      askerId: access.userId,
      askerName: await askerName(admin, org, access.userId),
      releaseId: release.id,
      releaseTitle: release.title,
      recipients: proposal.recipients,
    });
    notified = res.asked;
  }
  return json(200, {
    listed: true,
    playback: plan.playback,
    promoted: promoted.length,
    consent: consents.schemaReady
      ? { schemaReady: true, asked: proposal.asked.length, notified, unreachable: proposal.unreachable.length, status: await consentStatus(admin, release.id) }
      : { schemaReady: false },
  });
}
