/**
 * Storefront funnel — event vocabulary + pure aggregation.
 *
 * The `/analytics` funnel view turns raw `store_events` rows into a
 * stage-by-stage drop-off picture. That aggregation is pure logic, so it
 * lives here (Vitest-covered) instead of inside the analytics route or a
 * React component — per the repo rule that logic buried in components gets
 * silently reverted.
 *
 * A "stage reach" is counted **once per session**: a visitor who adds three
 * beats to the cart still counts as one session that reached `add_to_cart`.
 * Each later stage implies the earlier ones for that session, so the funnel
 * is monotonic by construction (a session that started checkout is also
 * counted at pdp_view even if the view event was lost).
 */

/** Ordered funnel stages, top → bottom. */
export const FUNNEL_STAGES = [
  'pdp_view',
  'add_to_cart',
  'checkout_start',
  'purchase',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** Every event type we accept (superset of funnel stages). */
export const STORE_EVENT_TYPES = [
  'pdp_view',
  'add_to_cart',
  'remove_from_cart',
  'checkout_start',
  'purchase',
] as const;
export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

export function isStoreEventType(s: unknown): s is StoreEventType {
  return typeof s === 'string' && (STORE_EVENT_TYPES as readonly string[]).includes(s);
}

/** Zero-based index of a stage in the funnel, or -1 if not a funnel stage. */
function stageRank(type: string): number {
  return (FUNNEL_STAGES as readonly string[]).indexOf(type);
}

export interface FunnelStageResult {
  stage: FunnelStage;
  /** Distinct sessions that reached this stage (or any deeper one). */
  sessions: number;
  /** % of the top stage's sessions (0–100, one decimal). */
  pctOfTop: number;
  /** % retained from the immediately previous stage (0–100, one decimal). */
  pctOfPrev: number;
}

type EventRow = { session_id?: string | null; event_type?: string | null };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Collapse raw events into the ordered funnel. Each session is attributed to
 * the deepest funnel stage it reached; deeper stages back-fill the shallower
 * ones so the funnel never increases as you go down.
 *
 * Events without a session_id or with a non-funnel type are ignored. Rows
 * with a session that only fired `remove_from_cart` (and nothing on the
 * funnel) don't count toward any stage.
 */
export function computeFunnel(events: EventRow[]): FunnelStageResult[] {
  // Deepest funnel stage reached per session.
  const deepestBySession = new Map<string, number>();
  for (const e of events) {
    const sid = e.session_id;
    if (!sid) continue;
    const rank = stageRank(e.event_type ?? '');
    if (rank < 0) continue;
    const prev = deepestBySession.get(sid);
    if (prev === undefined || rank > prev) deepestBySession.set(sid, rank);
  }

  // reachedAtLeast[i] = sessions whose deepest stage is >= i.
  const reachedAtLeast = new Array(FUNNEL_STAGES.length).fill(0);
  for (const deepest of deepestBySession.values()) {
    for (let i = 0; i <= deepest; i++) reachedAtLeast[i]++;
  }

  const top = reachedAtLeast[0] || 0;
  return FUNNEL_STAGES.map((stage, i) => {
    const sessions = reachedAtLeast[i];
    const prev = i === 0 ? sessions : reachedAtLeast[i - 1];
    return {
      stage,
      sessions,
      pctOfTop: top > 0 ? round1((sessions / top) * 100) : 0,
      pctOfPrev: prev > 0 ? round1((sessions / prev) * 100) : 0,
    };
  });
}
