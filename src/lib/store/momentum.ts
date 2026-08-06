/**
 * Storefront social proof — "recent sales momentum" per track.
 *
 * THE GAP THIS CLOSES. The storefront has zero social-proof signals — no
 * "sold this week", no recency, nothing beyond the static catalogue. The
 * data to support it already exists (license_purchases), it was just never
 * aggregated or surfaced. A buyer on the fence sees the same page whether
 * a beat sold twice yesterday or hasn't moved in six months.
 *
 * Pure and dependency-free so the aggregation is unit-tested in isolation —
 * same convention as readiness.ts / activity.ts / kind.ts.
 */

export interface MomentumPurchaseRow {
  track_ids: string[] | null;
  created_at: string;
}

/**
 * Count paid sales per track within the trailing window.
 *
 * A multi-track cart checkout counts once per track it contains — the
 * signal is "this specific beat sold", not "a checkout happened".
 */
export function computeRecentSalesByTrack(
  purchases: MomentumPurchaseRow[],
  windowMs: number,
  now: number = Date.now(),
): Record<string, number> {
  const cutoff = now - windowMs;
  const counts: Record<string, number> = {};
  for (const p of purchases) {
    const ts = Date.parse(p.created_at);
    if (Number.isNaN(ts) || ts < cutoff) continue;
    for (const trackId of p.track_ids ?? []) {
      if (!trackId) continue;
      counts[trackId] = (counts[trackId] ?? 0) + 1;
    }
  }
  return counts;
}

export const MOMENTUM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
