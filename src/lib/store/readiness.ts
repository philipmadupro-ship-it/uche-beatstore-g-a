/**
 * Sell-readiness — what stands between a beat and a buyer.
 *
 * THE GAP THIS CLOSES. The store editor's "needs attention" panel inspects
 * beats that are ALREADY LISTED. A beat uploaded and never listed has no
 * issues by that definition, so it is structurally invisible to the only
 * mechanism that could say it is incomplete. Meanwhile upload itself is a dead
 * end: the dropzone marks the card done, clears it after four seconds, and
 * stops. The beat is untagged, unpriced and unlisted, and nothing says so.
 *
 * The result is a vault full of finished music that cannot be bought, and an
 * app that never mentions it.
 *
 * This computes, for every track, exactly what is missing — so the library can
 * say "43 beats aren't earning, here's why" instead of nothing.
 *
 * Pure and dependency-free so it is unit-testable, per the project rule that
 * logic living in a component cannot be tested and gets silently reverted.
 */

export type ReadinessBlocker =
  /** Not on the store at all — nobody can reach it. */
  | 'not-listed'
  /** No price anywhere: neither per-track nor a profile default. */
  | 'no-price'
  /** No cover. Buyers skip these; it is the first thing they see. */
  | 'no-cover'
  /** No genre or mood tag, so it appears on no discovery page. */
  | 'no-tags'
  /** No BPM or key — the two fields buyers filter on. */
  | 'no-metadata';

export interface ReadinessTrack {
  id: string;
  title: string;
  store_listed?: boolean | null;
  cover_url?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  bpm?: number | null;
  key?: string | null;
  tags?: Array<{ tag: string; category?: string | null }> | null;
}

/**
 * Blockers that make a beat literally unpurchasable, as opposed to merely
 * harder to find or less likely to convert.
 *
 * The distinction is not pedantry. Reporting "0 ready to sell" while five beats
 * are genuinely on the store and priced — just without cover art — is false,
 * and a diagnostic that overstates is one the producer learns to ignore.
 */
const HARD_BLOCKERS: ReadinessBlocker[] = ['not-listed', 'no-price'];

export function isHardBlocker(blocker: ReadinessBlocker): boolean {
  return HARD_BLOCKERS.includes(blocker);
}

export interface TrackReadiness {
  id: string;
  title: string;
  blockers: ReadinessBlocker[];
  /** Nothing at all outstanding. */
  sellable: boolean;
  /** Cannot be bought right now — a hard blocker is present. */
  unpurchasable: boolean;
}

export interface ReadinessSummary {
  tracks: TrackReadiness[];
  /** Tracks with at least one outstanding item. */
  blockedCount: number;
  /** Tracks nobody can buy right now. The number that actually costs money. */
  unpurchasableCount: number;
  /** Tracks that are purchasable, whatever else is outstanding. */
  purchasableCount: number;
  /** Tracks with nothing outstanding at all. */
  sellableCount: number;
  /** How many tracks each blocker affects, most common first. */
  byBlocker: Array<{ blocker: ReadinessBlocker; count: number }>;
}

/** Human copy per blocker. Kept here so the panel and any future surface agree. */
export const BLOCKER_LABELS: Record<ReadinessBlocker, string> = {
  'not-listed': 'Not on the store',
  'no-price': 'No price set',
  'no-cover': 'No cover art',
  'no-tags': 'No genre or mood tag',
  'no-metadata': 'Missing BPM or key',
};

/**
 * Why each blocker costs money — shown alongside the count so the producer can
 * judge what to fix first rather than treating all five as equal chores.
 */
export const BLOCKER_REASONS: Record<ReadinessBlocker, string> = {
  'not-listed': 'Nobody can buy it.',
  'no-price': 'Buyers see no way to purchase.',
  'no-cover': 'The first thing a buyer sees is empty.',
  'no-tags': 'Appears on no discovery page, so search cannot find it.',
  'no-metadata': 'Cannot be found by BPM or key filters.',
};

function hasTagIn(track: ReadinessTrack, categories: string[]): boolean {
  return (track.tags ?? []).some((t) => {
    const category = (t?.category ?? '').toLowerCase();
    return Boolean(t?.tag?.trim()) && categories.includes(category);
  });
}

/**
 * What stands between one track and a sale.
 *
 * `hasDefaultPrice` covers the producer-level fallback: the store falls back to
 * `creator_profiles.license_*_price_usd` when a track has no override, so a
 * track without its own price is only blocked when there is no default either.
 * Reporting "no price" on every track when a perfectly good default exists
 * would be noise, and noise is what makes people ignore a checklist.
 */
export function trackBlockers(
  track: ReadinessTrack,
  hasDefaultPrice: boolean,
): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  if (!track.store_listed) blockers.push('not-listed');

  const hasOwnPrice = (track.lease_price_usd ?? null) != null
    || (track.exclusive_price_usd ?? null) != null;
  if (!hasOwnPrice && !hasDefaultPrice) blockers.push('no-price');

  if (!track.cover_url) blockers.push('no-cover');
  if (!hasTagIn(track, ['genre', 'mood'])) blockers.push('no-tags');
  if (track.bpm == null || !track.key) blockers.push('no-metadata');

  return blockers;
}

/**
 * Summarise a catalogue.
 *
 * Blocked tracks are returned worst-first so the panel can show the beats
 * furthest from earning, and `byBlocker` is ordered by how many tracks each
 * affects — which is the order that makes a bulk fix worth doing.
 */
export function summariseReadiness(
  tracks: ReadinessTrack[],
  hasDefaultPrice: boolean,
): ReadinessSummary {
  const assessed: TrackReadiness[] = tracks
    .filter((t) => t?.id)
    .map((t) => {
      const blockers = trackBlockers(t, hasDefaultPrice);
      return {
        id: t.id,
        title: t.title,
        blockers,
        sellable: blockers.length === 0,
        unpurchasable: blockers.some(isHardBlocker),
      };
    });

  const counts = new Map<ReadinessBlocker, number>();
  for (const t of assessed) {
    for (const b of t.blockers) counts.set(b, (counts.get(b) ?? 0) + 1);
  }

  return {
    // Unpurchasable first, then by how much is outstanding: the beats that
    // cannot be bought at all are the ones worth opening first.
    tracks: assessed.sort((a, b) => (
      Number(b.unpurchasable) - Number(a.unpurchasable)
      || b.blockers.length - a.blockers.length
    )),
    blockedCount: assessed.filter((t) => !t.sellable).length,
    unpurchasableCount: assessed.filter((t) => t.unpurchasable).length,
    purchasableCount: assessed.filter((t) => !t.unpurchasable).length,
    sellableCount: assessed.filter((t) => t.sellable).length,
    byBlocker: [...counts.entries()]
      .map(([blocker, count]) => ({ blocker, count }))
      .sort((a, b) => b.count - a.count),
  };
}
