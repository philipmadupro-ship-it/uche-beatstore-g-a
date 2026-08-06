/**
 * Per-track commercial stats: plays, downloads, revenue.
 *
 * These live on three different tables and none of them is `tracks`, which is
 * why the library's configurable columns shipped without them. Aggregating
 * here — once, purely — means the library, analytics and anything later can
 * agree on what "revenue for this beat" means instead of each deriving it.
 *
 * The revenue split in particular is a judgement call rather than a fact, and
 * one that was previously buried mid-route in /api/analytics. Judgement calls
 * belong somewhere testable and named.
 */

import { parsePurchaseLineItems } from '@/lib/contracts';

export interface TrackStats {
  /** Storefront plays plus share-link plays. */
  plays: number;
  /** Completed free downloads. */
  downloads: number;
  /** Attributed gross, USD. See `aggregateTrackStats` for the split. */
  revenueUsd: number;
  /** Number of purchases this track appeared in. */
  sales: number;
}

export type TrackStatsMap = Record<string, TrackStats>;

export const EMPTY_STATS: TrackStats = { plays: 0, downloads: 0, revenueUsd: 0, sales: 0 };

export interface PurchaseRow {
  amount_usd: number | string | null;
  track_ids: unknown;
  line_items: unknown;
  status?: string | null;
}

export interface PlayRow { track_id: string | null; play_count?: number | null }
export interface DownloadRow { track_id: string | null }

function blank(): TrackStats {
  return { plays: 0, downloads: 0, revenueUsd: 0, sales: 0 };
}

/**
 * Fold raw rows into a per-track map.
 *
 * REVENUE ATTRIBUTION. `license_purchases` stores one total for the whole
 * order and never a per-item amount, so a three-beat cart genuinely does not
 * record what each beat sold for. The order total is therefore split evenly
 * across its line items. That is an approximation, and it is the same one
 * /api/analytics already makes — the point of having it here is that the two
 * cannot drift, and that the assumption is stated once rather than implied
 * twice.
 *
 * Refunded and disputed purchases are excluded. Counting them would show
 * revenue the producer does not have, which is the one direction a money
 * column must never be wrong in.
 */
export function aggregateTrackStats(input: {
  purchases?: readonly PurchaseRow[];
  plays?: readonly PlayRow[];
  downloads?: readonly DownloadRow[];
}): TrackStatsMap {
  const out: TrackStatsMap = {};
  const bucket = (id: string) => (out[id] ??= blank());

  for (const row of input.plays ?? []) {
    if (!row.track_id) continue;
    // The view pre-aggregates; raw play rows count as one each.
    bucket(row.track_id).plays += Number(row.play_count ?? 1) || 0;
  }

  for (const row of input.downloads ?? []) {
    if (!row.track_id) continue;
    bucket(row.track_id).downloads += 1;
  }

  for (const purchase of input.purchases ?? []) {
    const status = (purchase.status ?? 'paid').toLowerCase();
    if (status === 'refunded' || status === 'disputed' || status === 'failed') continue;

    const amount = Number(purchase.amount_usd ?? 0);
    const parsed = parsePurchaseLineItems(purchase.line_items);
    const ids = parsed.length > 0
      ? parsed.map((item) => item.track_id)
      : (Array.isArray(purchase.track_ids) ? purchase.track_ids.filter((x): x is string => typeof x === 'string') : []);

    if (ids.length === 0) continue;
    const perItem = Number.isFinite(amount) ? amount / ids.length : 0;

    for (const id of ids) {
      const b = bucket(id);
      b.revenueUsd += perItem;
      b.sales += 1;
    }
  }

  // Round only at the end: rounding each split first drifts a 3-way $100
  // order to $99.99 or $100.02 depending on the cents.
  for (const id of Object.keys(out)) {
    out[id].revenueUsd = Math.round(out[id].revenueUsd * 100) / 100;
  }

  return out;
}

export function statsFor(map: TrackStatsMap, trackId: string): TrackStats {
  return map[trackId] ?? EMPTY_STATS;
}

/** `$1,240` / `$12.50` — whole dollars once past the point cents stop mattering. */
export function formatRevenue(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '';
  return usd >= 100
    ? `$${Math.round(usd).toLocaleString()}`
    : `$${usd.toFixed(2).replace(/\.00$/, '')}`;
}
