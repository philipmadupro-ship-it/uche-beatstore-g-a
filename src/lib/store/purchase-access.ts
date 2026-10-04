/**
 * Whether a paid license_purchases row may hand out its files right now.
 *
 * `download_unlocked` is the refund / dispute switch (the webhook clears it).
 * `needs_refund_review` is the other: when two buyers pay for the same
 * exclusive, the webhook lets the second payment through and flags the row,
 * because the claim on the track is an atomic UPDATE that only one of them can
 * win. The loser has paid for rights that already belong to someone else, so
 * their WAV and stems stay put until the producer has looked at the sale —
 * marking it reviewed on /sales (or refunding, which clears
 * `download_unlocked`) is what ends the hold.
 *
 * Both /api/store/delivery and /api/store/download-file ask this, so the page
 * that lists the files and the route that serves them cannot disagree.
 */
export type PurchaseAccessRow = {
  download_unlocked?: boolean | null;
  needs_refund_review?: boolean | null;
};

export type PurchaseAccess =
  | { allowed: true }
  | { allowed: false; reason: 'revoked' | 'under-review'; message: string };

export const REVOKED_MESSAGE = 'Download access revoked (refunded or disputed)';
export const UNDER_REVIEW_MESSAGE =
  'Downloads for this purchase are on hold while the producer reviews it. They will be in touch by email.';

export function purchaseAccess(row: PurchaseAccessRow): PurchaseAccess {
  if (!row.download_unlocked) {
    return { allowed: false, reason: 'revoked', message: REVOKED_MESSAGE };
  }
  if (row.needs_refund_review === true) {
    return { allowed: false, reason: 'under-review', message: UNDER_REVIEW_MESSAGE };
  }
  return { allowed: true };
}
