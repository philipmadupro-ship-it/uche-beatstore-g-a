/**
 * Pure logic for the Beat Listing rows in `/store-editor`.
 *
 * The row is where a producer publishes: it decides what is live, at what
 * price, in what order. All of that used to be a wall of seven icon buttons
 * plus a sentence telling you to go somewhere else to set the price — so the
 * decisions the row exists to support were made on a different screen.
 *
 * Everything here is the part that has to be right whether or not the markup
 * changes: what state a beat is actually in, whether a typed price is a price,
 * and which beats an "attention" issue is talking about.
 */

export type BeatPublishState = 'live' | 'scheduled' | 'draft';

export interface BeatRowTrack {
  id: string;
  store_listed: boolean;
  scheduled_publish_at: string | null;
}

/**
 * Live / Scheduled / Draft.
 *
 * `store_listed` wins over a pending schedule: a beat that is already on the
 * store is live no matter what timestamp is still sitting on the row, and
 * showing it as "Scheduled" would suggest it is not selling yet.
 */
export function beatPublishState(track: BeatRowTrack): BeatPublishState {
  if (track.store_listed) return 'live';
  if (track.scheduled_publish_at) return 'scheduled';
  return 'draft';
}

export type PriceParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: 'not-a-number' | 'negative' | 'too-large' };

/**
 * Parse a typed price into what the API takes.
 *
 * Empty is not an error and not zero — it is `null`, which means "inherit the
 * profile default" (migration 021). Conflating empty with 0 would silently
 * publish someone's catalogue as free.
 *
 * Cents are rounded rather than rejected, because a price arrived at by
 * dividing (a bundle split, a percentage) legitimately produces 19.999999.
 */
export function parsePriceInput(raw: string): PriceParse {
  const trimmed = raw.trim().replace(/^\$/, '').trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, reason: 'not-a-number' };
  if (n < 0) return { ok: false, reason: 'negative' };
  // Stripe line items are integer cents; beyond this the amount overflows what
  // a checkout session will accept, and a typo is likelier than the sale.
  if (n > 999_999) return { ok: false, reason: 'too-large' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export interface AttentionCandidate {
  store_listed: boolean;
  cover_url: string | null;
  peaks_url: string | null;
  bpm: number | null;
  key: string | null;
}

/** The issue kinds the Needs-attention panel can narrow the list to. */
export type AttentionFilter = 'no-cover' | 'no-price' | 'no-bpm-key';

/**
 * Predicate matching the beats one attention issue is about.
 *
 * The panel used to link each issue to `/library/<firstId>` — one beat, on
 * another page, with no way back to the other nine. The same rules that count
 * an issue should be able to filter the list to it, so they live in one
 * function that both sides use.
 */
export function matchesAttentionFilter<T extends AttentionCandidate>(
  filter: AttentionFilter,
  track: T,
  hasReadyPrice: (track: T) => boolean,
): boolean {
  if (!track.store_listed) return false;
  if (filter === 'no-cover') return !track.cover_url;
  if (filter === 'no-price') return !hasReadyPrice(track);
  return track.bpm == null && !track.key;
}

/** Maps an attention issue's label to the filter that narrows to it. */
export function attentionFilterForLabel(label: string): AttentionFilter | null {
  if (label === 'no cover art') return 'no-cover';
  if (label === 'no price set') return 'no-price';
  if (label === 'no BPM or key') return 'no-bpm-key';
  return null;
}

// ── Is this beat actually sellable? ─────────────────────────────────────────

export interface PricedTrack {
  id: string;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
}

export interface PriceLicenseTier {
  id: string;
  price_usd: number | null;
  is_free: boolean;
}

export interface PriceLicenseLink {
  license_id: string;
  enabled: boolean;
  linked: boolean;
  price_override_usd: number | null;
}

export interface PriceContext {
  /** Producer-level fallbacks from `creator_profiles`. Strings: they come
   *  straight off the profile form inputs. */
  defaultLeasePrice: string | number | null | undefined;
  defaultExclusivePrice: string | number | null | undefined;
  tiers: PriceLicenseTier[];
  /** Per-track tier links, keyed by track id. */
  linksByTrack: Record<string, PriceLicenseLink[] | undefined>;
}

/**
 * Whether a beat has a price a buyer could actually pay.
 *
 * This is the rule the "Needs attention" panel counts with AND the rule the
 * row filter narrows by, so it has to be one function — two copies of a
 * pricing rule drift, and the drift shows up as a panel that reports three
 * unpriced beats and a filtered list containing two.
 *
 * The precedence is not obvious and is worth stating: per-track legacy prices
 * or the producer's profile defaults make a beat "ready" on their own, but
 * once license TIERS exist they take over — a beat linked to tiers is ready
 * only if one of those tiers is free or priced. A beat whose links exclude
 * every tier falls back to the legacy prices rather than reading as unsellable.
 *
 * It also used to be a closure declared ~800 lines below its first use in the
 * component, which put it in the temporal dead zone for the row filter.
 */
export function hasSellablePrice<T extends PricedTrack>(track: T, ctx: PriceContext): boolean {
  const legacyReady = (
    (track.lease_price_usd != null && track.lease_price_usd > 0)
    || (track.exclusive_price_usd != null && track.exclusive_price_usd > 0)
    || Number(ctx.defaultLeasePrice) > 0
    || Number(ctx.defaultExclusivePrice) > 0
  );
  if (ctx.tiers.length === 0) return legacyReady;

  const links = ctx.linksByTrack[track.id] ?? [];
  const useLinked = links.some((link) => link.linked);
  const activeTiers = ctx.tiers.filter((tier) => {
    if (!useLinked) return true;
    const link = links.find((row) => row.license_id === tier.id);
    return !!link?.linked && link.enabled;
  });
  const tierReady = activeTiers.some((tier) => {
    if (tier.is_free) return true;
    const override = links.find((row) => row.license_id === tier.id)?.price_override_usd;
    return Number(override ?? tier.price_usd) > 0;
  });
  return tierReady || (activeTiers.length === 0 && legacyReady);
}
