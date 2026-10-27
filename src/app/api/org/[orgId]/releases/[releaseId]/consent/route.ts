/**
 * PUT /api/org/[orgId]/releases/[releaseId]/consent — a credited artist's own
 * answer on putting the release on the store: `{ decision: 'yes' | 'no' }`
 * (LABEL-71; owner decisions A and E, doc 21 §5.1, doc 22 §5).
 *
 * WHO. Only an account that stands for a credited artist of THIS release
 * (`answerableFor`: a member whose role is `artist` scoped to that artist, or
 * the account of a party linked to them). Not a capability: a label's A&R
 * scoped to the same artist is not the artist, an owner is not the artist, and
 * the body names no artist, so nobody can answer for somebody else. Anyone
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
 * that unlists also records `release.store_unlisted`. A `no` is the safe
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
import { recordEvent } from '@/lib/labelos/activity';
import { releaseEventSubject } from '@/lib/labelos/releases';
import { loadListingRelease, readPlayback } from '@/lib/labelos/store-listing-store';
import { planDecision } from '@/lib/labelos/store-consent';
import { NEEDS_186, answerableFor, insertProposals, loadCreditedArtists, readConsents, restoreConsent, setConsent, takeOffStore } from '@/lib/labelos/store-consent-store';
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

    for (const row of rows) {
      const plan = planDecision(row.state, decision);
      if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
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
            return json(500, { error: 'Could not record your answer; nothing was changed. Try again.' });
          }
          unrecorded = true;
        }
      }
    }

    // A no (also one given a moment ago whose unlisting did not finish) takes the release off the store now. The
    // update itself is conditional on the release being listed, so it needs no read of that flag first: a listing
    // that landed after this request began is taken off too.
    const refusing = decision === 'no';
    if (refusing) {
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
