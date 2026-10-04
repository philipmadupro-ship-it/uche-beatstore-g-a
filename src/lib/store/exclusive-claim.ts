import { parsePurchaseLineItem } from './license-entitlements';

/**
 * Did the exclusivity claim fail because ANOTHER buyer holds the track?
 *
 * The webhook claims an exclusive with `UPDATE … WHERE exclusive_sold = false`,
 * so a failed claim means "already sold" — but not necessarily to someone else.
 * Stripe re-delivers events, and the re-run of a purchase that already claimed
 * the track finds it sold by itself. Flagging that as a double sale is harmless
 * when the flag is only a badge, and wrong once the flag holds the buyer's
 * downloads (lib/store/purchase-access.ts): the legitimate winner would be
 * locked out by their own retry.
 *
 * A track is held by another buyer only if some OTHER purchase of it is a live
 * exclusive: still unlocked, and not itself the flagged loser of the same race
 * (the loser's row also names the track and is unlocked).
 */
export type OtherPurchase = {
  track_ids?: unknown;
  line_items?: unknown;
  license_type?: string | null;
  download_unlocked?: boolean | null;
  needs_refund_review?: boolean | null;
};

export function trackHeldByAnotherBuyer(trackId: string, others: OtherPurchase[]): boolean {
  return others.some((p) => {
    if (!p.download_unlocked || p.needs_refund_review === true) return false;
    if (!Array.isArray(p.track_ids) || !p.track_ids.includes(trackId)) return false;
    const items = Array.isArray(p.line_items)
      ? p.line_items.map(parsePurchaseLineItem).filter((i): i is NonNullable<typeof i> => i !== null)
      : [];
    const item = items.find((i) => i.track_id === trackId);
    return item ? item.is_exclusive || item.license_type === 'exclusive' : p.license_type === 'exclusive';
  });
}
