/**
 * Withdrawing a delivered release (LABEL-56). Pure: `POST …/releases/[id]/withdraw`
 * reads the row and the member, and this module decides what the request may do.
 *
 * Cancel and withdraw are different acts. Cancelling is for a DRAFT that is
 * not going out. A release that was DELIVERED did go out, so it is never
 * cancelled or deleted: it is withdrawn — the record, the tracklist and the
 * gates history stay, it leaves the public store, and it is not delivered
 * again. The songs on it keep the class they earned by going out
 * (`countsAsOnRelease`).
 *
 * Taking it off the store is LABEL-42's unlist, rule for rule (`planUnlist`):
 * previews promoted for music that was never publicly out may be deleted if
 * the owner asks; music that was publicly out keeps them; playback goes back
 * to `preview`.
 */
import { planUnlist, type ListingFacts } from './store-listing';

export const WITHDRAWAL_NOTE_MAX = 1000;

export type WithdrawalPlan =
  | { ok: true; note: string | null; unlist: boolean; askToDeletePreviews: boolean; deletePreviews: boolean }
  | { ok: false; status: 400 | 409; error: string; field: string };

export function planWithdrawal(
  release: Pick<ListingFacts, 'state' | 'imported_released' | 'store_listed' | 'release_date'> & { store_listed_at?: string | null },
  req: { note: string | null; deletePreviews: boolean },
  now: Date,
): WithdrawalPlan {
  const note = req.note?.trim() ? req.note.trim() : null;
  if (note && note.length > WITHDRAWAL_NOTE_MAX) {
    return { ok: false, status: 400, error: `Keep the reason under ${WITHDRAWAL_NOTE_MAX} characters`, field: 'note' };
  }
  if (release.state !== 'delivered') {
    const error =
      release.state === 'draft'
        ? 'A draft was never delivered, so there is nothing to withdraw; cancel it instead'
        : release.state === 'withdrawn'
          ? 'This release is already withdrawn'
          : 'A cancelled release was never delivered, so there is nothing to withdraw';
    return { ok: false, status: 409, error, field: 'state' };
  }
  if (!release.store_listed) return { ok: true, note, unlist: false, askToDeletePreviews: false, deletePreviews: false };
  const unlist = planUnlist({ ...(release as ListingFacts), store_listed: true }, req.deletePreviews, now);
  if (!unlist.ok) return { ok: false, status: 409, error: unlist.error, field: unlist.field ?? 'store_listed' };
  return { ok: true, note, unlist: true, askToDeletePreviews: unlist.askToDeletePreviews, deletePreviews: unlist.deletePreviews };
}

/**
 * Why a release cannot be cancelled (or, with `act: 'delete'`, deleted), in
 * the words the member reads; null when it can. Cancel is draft-only: a
 * delivered release is withdrawn, never cancelled. A release entered as
 * already out is still a draft row: it is not deleted, but it can be
 * cancelled.
 */
export function cancelRefusal(release: { state: string; imported_released: boolean }, act: 'cancel' | 'delete' = 'cancel'): string | null {
  const verb = act === 'delete' ? 'cancelled or deleted' : 'cancelled';
  if (release.state === 'delivered') return `Only a draft can be ${verb}. This release was delivered; withdraw it instead`;
  if (release.state === 'withdrawn') return `This release was delivered and then withdrawn; the record is kept, so it cannot be ${verb}`;
  if (act === 'delete' && release.imported_released) return 'This release was entered as already out, so it is not deleted; cancel it instead';
  return null;
}
