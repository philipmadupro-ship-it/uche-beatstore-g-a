/**
 * What a share link must satisfy before it may sell anything.
 *
 * The share pages hide Buy unless `sales_enabled`, and refuse to load a
 * revoked, expired or locked share, but `/api/share/[token]/checkout` checked
 * none of that. Anyone holding a token could buy from a share the producer
 * never opened for sale, or had since revoked, and could put any track in the
 * cart, not just the ones the share contains. The rules live here so the
 * checkout and its tests read one definition.
 */

export interface ShareSaleState {
  sales_enabled?: boolean | null;
  revoked_at?: string | null;
  expires_at?: string | null;
}

export type ShareCheckoutBlock = { status: 403 | 410; error: string };

/** Null when the share may sell; otherwise the response to send. */
export function shareCheckoutBlock(share: ShareSaleState, now: number): ShareCheckoutBlock | null {
  if (share.revoked_at) {
    return { status: 410, error: 'This link has been revoked.' };
  }
  if (share.expires_at && new Date(share.expires_at).getTime() < now) {
    return { status: 410, error: 'This link has expired.' };
  }
  if (share.sales_enabled !== true) {
    return { status: 403, error: 'Purchases are not enabled on this link.' };
  }
  return null;
}

/** Requested track ids the share does not contain, in request order, deduped. */
export function tracksOutsideShare(requested: readonly string[], shareTrackIds: readonly string[]): string[] {
  const allowed = new Set(shareTrackIds);
  return [...new Set(requested)].filter((id) => !allowed.has(id));
}
