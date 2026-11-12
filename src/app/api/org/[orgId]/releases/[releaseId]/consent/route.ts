/**
 * PUT /api/org/[orgId]/releases/[releaseId]/consent — a credited artist's own
 * answer on putting the release on the store: `{ decision: 'yes' | 'no' }`
 * (LABEL-71; owner decisions A and E, doc 21 §5.1, doc 22 §5).
 *
 * WHO. Only an account that stands for a credited artist of THIS release
 * (`answerableFor`: the owner of an artist org for its artist, or a member whose
 * role is `artist` scoped to that artist). NOT the account of a party linked to
 * the artist — a rights writer can put any account on a party and confirm it as
 * themself. Not a capability: a label's A&R scoped to the same artist is not
 * the artist, a manager is not the artist, and the body names no artist.
 * Accepted deviation: an admin with `members.manage` can invite an address they
 * control as role `artist` scoped to the contact; that account then answers.
 * It needs an invitation the invitee accepts with a verified email and leaves
 * member audit events (`invitation.created`, `member.joined`). Anyone
 * else — a stranger, an external member, a member with no say on this release
 * — gets the same 404 as a release that does not exist.
 *
 * WHAT. `planDecision` (pure): asked → yes | no, yes → no, no → yes; a repeat
 * is a 200 that writes nothing. A `no` is final for the label: in the SAME
 * request the release comes off the store (`store_listed` false, playback back
 * to `preview`, promoted public previews deleted) and the public routes stop serving on their next read because
 * they check the row themselves. It cannot be listed again until this artist
 * says yes.
 *
 * AUDIT. The answer is an audit act (`listing.consent_decided`), and a `no`
 * that unlists also records `release.store_unlisted`. With migration 201 each
 * answer is ONE database function (`labelos_audit_consent_decide`): the consent
 * row, the unlisting and both events commit together, so an event that cannot
 * be written leaves nothing behind and there is nothing to put back (the promoted
 * public previews, which are storage, are deleted after it commits). Without 201
 * the previous path runs, described next. A `no` is the safe
 * direction: if its event cannot be written the answer STANDS (the release is
 * already private) and the caller is told it was not recorded. A `yes` is
 * put back exactly as it was if its event cannot be written — a yes that is
 * not on record must not let a release go public.
 *
 * Migration 186 missing: 503 naming it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody, isUUID } from '@/lib/validate';
import { OrgListingConsentBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent, type EventPayload } from '@/lib/labelos/activity';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { releaseEventSubject } from '@/lib/labelos/releases';
import { loadListingRelease, readPlayback } from '@/lib/labelos/store-listing-store';
import { planDecision, type ConsentState } from '@/lib/labelos/store-consent';
import { NEEDS_186, answerableFor, enforceRefusal, insertProposals, loadCreditedArtists, readConsents, restoreConsent, setConsent, takeOffStore } from '@/lib/labelos/store-consent-store';
import { deletePromotedPreviews } from '@/lib/storage/store-release-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.consent');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Not found' });

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  if (!isUUID(releaseId)) return NOT_FOUND();
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgListingConsentBodySchema);
  if (!parsed.ok) return parsed.res;
  const { decision } = parsed.data;
  const { admin, orgId: org, userId } = access;
  const actor = { orgId: org, userId };

  try {
    const release = await loadListingRelease(admin, org, releaseId.toLowerCase());
    if (!release) return NOT_FOUND();
    const consents = await readConsents(admin, release.id);
    if (!consents.schemaReady) return json(503, { error: NEEDS_186, migration: '186', schemaReady: false });
    const mine = new Set(await answerableFor(admin, org, userId));
    let rows = consents.rows.filter((r) => mine.has(r.artist_contact_id));
    // An artist credited on this release who was never asked — it was listed before migration 186, or the credit
    // was confirmed after the listing — still has the last word: their question is created now, as asked, and
    // answered below. Only a contact that really is credited on it (never one the caller merely names).
    const unasked = (await loadCreditedArtists(admin, release)).filter((c) => mine.has(c) && !rows.some((r) => r.artist_contact_id === c));
    if (unasked.length > 0) {
      const made = await insertProposals(admin, release, unasked, null);
      if (made.error) {
        log.error('consent row for an unasked artist failed', { releaseId, error: made.error.message });
        return json(500, { error: 'Could not record your answer' });
      }
      rows = (await readConsents(admin, release.id)).rows.filter((r) => mine.has(r.artist_contact_id));
    }
    if (rows.length === 0) return NOT_FOUND();

    const subject = releaseEventSubject(release);
    const now = new Date();
    let changed = 0;
    let unlisted = false;
    let unrecorded = false;

    const unlistPayload = { reason: 'artist_declined', askedToDeletePreviews: false, deletePreviews: true };
    const ctx = { release_artist_id: release.contact_id, project_id: release.project_id };
    let rpcMissing = false;
    let viaRpc = false;
    /**
     * One call to 201's function. `from` null = enforce a no that already stands. Returns what happened, or 'missing'
     * when migration 201 is not applied (the caller then uses the previous path), or a Response for a failure.
     */
    const decideAtomic = async (row: (typeof rows)[number], from: ConsentState | null, to: 'yes' | 'no', payload: EventPayload) => {
      const rpc = await auditRpc(admin, 'consentDecide', {
        p_org: org,
        p_actor: userId,
        p_release: release.id,
        p_artist: row.artist_contact_id,
        p_from: from,
        p_to: to,
        p_ctx: ctx,
        p_payload: payload,
        p_unlist_payload: unlistPayload,
      });
      if (rpc.error) {
        if (isMissingAuditRpc(rpc.error)) return 'missing' as const;
        log.error('consent decide failed', { releaseId, decision, error: rpc.error.message });
        return json(500, { error: 'Could not record your answer; nothing was changed. Try again.' });
      }
      const out = rpc.data as { changed?: boolean; unlisted?: boolean; error?: string } | null;
      // Gone (or no longer a no, for an enforce) between the read and the call: nothing to apply.
      if (out?.error) return { changed: false, unlisted: false };
      return { changed: out?.changed === true, unlisted: out?.unlisted === true };
    };

    for (const row of rows) {
      const plan = planDecision(row.state, decision);
      if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
      if (!rpcMissing && (plan.change === 'set' || decision === 'no')) {
        const done = await decideAtomic(row, plan.change === 'set' ? plan.from : null, plan.change === 'set' ? plan.to : 'no', plan.change === 'set' ? { decision: plan.to, from: plan.from, withdrew: plan.withdraw } : {});
        if (done instanceof Response) return done;
        if (done !== 'missing') {
          viaRpc = true;
          if (done.changed) changed += 1;
          if (done.unlisted) unlisted = true;
          // Someone answered in the meantime and ours was not applied: still make sure a no that stands has the release off.
          if (plan.change === 'set' && !done.changed && decision === 'no') {
            const again = await decideAtomic(row, null, 'no', {});
            if (again instanceof Response) return again;
            if (again !== 'missing' && again.unlisted) unlisted = true;
          }
          continue;
        }
        rpcMissing = true;
      }
      if (plan.change === 'set') {
        const set = await setConsent(admin, row, plan.from, plan.to, userId, now);
        if (set.error) {
          log.error('consent write failed', { releaseId, error: set.error.message });
          return json(500, { error: 'Could not record your answer' });
        }
        // Someone (the same artist in another tab) answered in the meantime: their answer stands, ours is not applied.
        if (!set.changed) continue;
        changed += 1;
        try {
          await recordEvent(admin, actor, 'listing.consent_decided', { ...subject, artistId: row.artist_contact_id }, { decision: plan.to, from: plan.from, withdrew: plan.withdraw });
        } catch (err) {
          log.error('consent audit failed', { releaseId, decision, error: errorMessage(err) });
          if (plan.to === 'yes') {
            // The unsafe direction: put the row back as it was.
            const back = await restoreConsent(admin, org, row);
            if (back.error) log.error('consent put-back FAILED: a yes stands without its event', { releaseId, error: back.error.message });
            // Undone to a no (no → yes → no): the release may have been listed in the gap — take it off again.
            else if (row.state === 'no') {
              const playback = await readPlayback(admin, release.id);
              await enforceRefusal(admin, org, release.id, playback.schemaReady).catch((e) => log.error('refusal enforcement after put-back failed', { releaseId, error: errorMessage(e) }));
            }
            return json(500, { error: 'Could not record your answer; nothing was changed. Try again.' });
          }
          unrecorded = true;
        }
      }
    }

    // A no (also one given a moment ago whose unlisting did not finish) takes the release off the store now. The
    // update itself is conditional on the release being listed, so it needs no read of that flag first: a listing
    // that landed after this request began is taken off too. With migration 201 the unlisting and its event already
    // happened inside the function; only the storage (the promoted public previews) is left.
    const refusing = decision === 'no';
    if (refusing && viaRpc) {
      if (unlisted) await deletePromotedPreviews(release.id).catch((e) => log.error('preview delete failed', { releaseId, error: errorMessage(e) }));
    } else if (refusing) {
      const playback = await readPlayback(admin, release.id);
      const off = await takeOffStore(admin, org, release.id, playback.schemaReady);
      if (off.error) {
        // The answer is recorded and the public routes already refuse the release; only the flag is stale.
        log.error('unlist after a no failed (the public routes still refuse it)', { releaseId, error: off.error.message });
      } else if (off.changed) {
        unlisted = true;
        try {
          await recordEvent(admin, actor, 'release.store_unlisted', subject, { reason: 'artist_declined', askedToDeletePreviews: false, deletePreviews: true });
        } catch (err) {
          log.error('unlist audit after a no failed', { releaseId, error: errorMessage(err) });
          unrecorded = true;
        }
        // The artist's no outranks the owner's choice about previews (`planUnlist` leaves that to the owner for
        // music that was publicly out): the promoted public copies go. Listing it again promotes them anew.
        await deletePromotedPreviews(release.id).catch((e) => log.error('preview delete failed', { releaseId, error: errorMessage(e) }));
      }
    }

    if (unrecorded) {
      return json(500, {
        error: 'Your answer is saved and the release is off the store, but the record of it could not be written. Nothing is public.',
        decision,
        unlisted,
        recorded: false,
      });
    }
    return json(200, { decision, changed: changed > 0, unlisted });
  } catch (err) {
    log.error('consent failed', { orgId: org, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not record your answer' });
  }
}
