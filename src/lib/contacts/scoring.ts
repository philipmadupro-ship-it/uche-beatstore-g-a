/**
 * Lead scoring — pure, deterministic, time-decayed engagement score.
 *
 * Turns a contact's engagement summary into a 0–100 score + a tier so the
 * producer can sort the pipeline by "hottest" and know who to chase. Buyers
 * and recently-engaged artists rank highest; stale contacts decay.
 *
 * Pure (now is injectable) so the weighting is unit-tested in isolation —
 * the same template as filterAndSortTracks / activity.ts.
 */

export interface ScoreInput {
  sends: number;
  opens: number;
  clicks: number;
  plays: number;
  purchases: number;
  revenue: number;
  /** ISO timestamp of the most recent touch, or null. */
  lastTouch: string | null;
  /** Injectable clock for tests (ms). Defaults to Date.now(). */
  now?: number;
}

export type LeadTier = 'hot' | 'warm' | 'cold' | 'new';

export interface LeadScore {
  score: number;        // 0–100
  tier: LeadTier;
  reasons: string[];    // human-readable drivers, strongest first
}

/* ── Weights ─────────────────────────────────────────────────────────── */

const W = {
  purchase: 25,   // a sale is the strongest signal
  revenuePer10: 1, // +1 per $10, capped
  revenueCap: 20,
  click: 8,
  play: 6,
  open: 4,
  send: 0.5,      // sending is OUR effort, not their engagement — tiny weight
};

/** Recency multiplier — engagement matters more when it's fresh. */
export function recencyMultiplier(lastTouch: string | null, now: number): number {
  if (!lastTouch) return 0.3;
  const days = (now - new Date(lastTouch).getTime()) / 86_400_000;
  if (days < 0) return 1;          // future-dated; treat as now
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.45;
  return 0.2;
}

export function scoreLead(input: ScoreInput): LeadScore {
  const now = input.now ?? Date.now();

  const base =
    input.purchases * W.purchase +
    Math.min(input.revenue / 10 * W.revenuePer10, W.revenueCap) +
    input.clicks * W.click +
    input.plays * W.play +
    input.opens * W.open +
    input.sends * W.send;

  const mult = recencyMultiplier(input.lastTouch, now);
  const score = Math.max(0, Math.min(100, Math.round(base * mult)));

  // Tier: a paying buyer is always at least warm; otherwise threshold on score.
  let tier: LeadTier;
  if (input.purchases > 0 || score >= 60) tier = 'hot';
  else if (score >= 28) tier = 'warm';
  else if (score > 0) tier = 'cold';
  else tier = 'new';

  // Reasons — strongest drivers first, for the badge tooltip / detail.
  const reasons: string[] = [];
  if (input.purchases > 0) {
    reasons.push(`${input.purchases} purchase${input.purchases === 1 ? '' : 's'}${input.revenue > 0 ? ` ($${input.revenue.toLocaleString()})` : ''}`);
  }
  if (input.clicks > 0) reasons.push(`${input.clicks} link click${input.clicks === 1 ? '' : 's'}`);
  if (input.plays > 0) reasons.push(`${input.plays} play${input.plays === 1 ? '' : 's'}`);
  if (input.opens > 0) reasons.push(`${input.opens} email open${input.opens === 1 ? '' : 's'}`);
  if (input.lastTouch) {
    const days = Math.floor((now - new Date(input.lastTouch).getTime()) / 86_400_000);
    if (days <= 7) reasons.push('active this week');
    else if (days > 90) reasons.push('gone quiet (90d+)');
  }
  if (reasons.length === 0) reasons.push('no engagement yet');

  return { score, tier, reasons };
}

/** Display metadata for a tier (color + label), centralized for the UI. */
export const TIER_META: Record<LeadTier, { label: string; color: string; bg: string }> = {
  hot:  { label: 'Hot',  color: '#E8896A', bg: 'rgba(232,137,106,0.14)' },
  warm: { label: 'Warm', color: '#E7D7BE', bg: 'rgba(231,215,190,0.12)' },
  cold: { label: 'Cold', color: '#7d92b0', bg: 'rgba(125,146,176,0.12)' },
  new:  { label: 'New',  color: '#B4AA99', bg: 'rgba(255,255,255,0.04)' },
};
