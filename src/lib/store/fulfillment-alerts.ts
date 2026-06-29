/**
 * Fulfillment-health classification — pure.
 *
 * Two silent post-sale failures the producer needs to know about:
 *   - `awaiting_stems`: an exclusive sold without a deliverable, so
 *     needs_stems_upload was set — but the producer never uploaded, leaving the
 *     buyer empty-handed.
 *   - `delivery_email_failed`: the purchase recorded but the receipt/download
 *     email never sent (fulfillment_email_sent stayed false), so the buyer may
 *     not even know how to download.
 *
 * Both are time-thresholded — a few minutes/hours of lag is normal; past that
 * it's stuck. Kept pure so "what counts as stuck" is unit-tested; the cron does
 * the I/O (query + notify).
 */

export interface PurchaseRow {
  id: string;
  seller_user_id: string | null;
  status?: string | null;
  needs_stems_upload?: boolean | null;
  fulfillment_email_sent?: boolean | null;
  created_at: string;
}

export type AlertKind = 'awaiting_stems' | 'delivery_email_failed';

export interface FulfillmentAlert {
  purchaseId: string;
  sellerUserId: string;
  kind: AlertKind;
  ageHours: number;
}

export interface StuckThresholds {
  /** How long an exclusive may sit awaiting stems before we nag (hours). */
  stemsHours: number;
  /** How long a paid purchase may have no delivery email before alerting (minutes). */
  emailMinutes: number;
}

/**
 * Classify which paid purchases are stuck. A row can raise both kinds.
 * Only `paid` purchases with a known seller are considered (refunded/disputed
 * are out of scope; a null seller can't be notified).
 */
export function findStuckFulfillments(
  rows: PurchaseRow[],
  now: number,
  { stemsHours, emailMinutes }: StuckThresholds,
): FulfillmentAlert[] {
  const out: FulfillmentAlert[] = [];
  for (const r of rows) {
    if (!r.seller_user_id) continue;
    if (r.status && r.status !== 'paid') continue;
    const ageMs = now - new Date(r.created_at).getTime();
    if (!(ageMs >= 0)) continue; // skip future/invalid timestamps
    const ageHours = ageMs / 3_600_000;

    if (r.needs_stems_upload === true && ageMs >= stemsHours * 3_600_000) {
      out.push({ purchaseId: r.id, sellerUserId: r.seller_user_id, kind: 'awaiting_stems', ageHours });
    }
    if (r.fulfillment_email_sent === false && ageMs >= emailMinutes * 60_000) {
      out.push({ purchaseId: r.id, sellerUserId: r.seller_user_id, kind: 'delivery_email_failed', ageHours });
    }
  }
  return out;
}
