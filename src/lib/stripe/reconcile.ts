/**
 * Payments reconciliation — pure matching logic.
 *
 * The webhook is the only thing that turns a paid Stripe session into a
 * fulfillment row (license_purchases / project_access_links). If the webhook
 * ever silently fails (deploy gap, bad signature secret, exception before the
 * insert), the buyer paid but got nothing — and nothing surfaces it. The
 * reconciliation cron lists recent *paid* Stripe sessions and checks each has a
 * matching fulfillment row; this helper is the comparison, kept pure so the
 * "what counts as unfulfilled" rule is unit-tested.
 */

export interface StripeSessionLite {
  id: string;
  /** Stripe payment_status — only 'paid' sessions are owed fulfillment. */
  payment_status: string | null;
  amount_total: number | null;
  /** purchase_kind from metadata, for reporting which path should have run. */
  purchase_kind?: string | null;
}

export interface UnfulfilledSession {
  sessionId: string;
  amountUsd: number | null;
  purchaseKind: string | null;
}

/**
 * Return the paid sessions that have no matching fulfillment row.
 * `fulfilledSessionIds` is the union of license_purchases.stripe_session_id and
 * project_access_links.stripe_session_id for the sessions under inspection.
 * Unpaid / incomplete sessions are ignored (they were never owed fulfillment).
 */
export function findUnfulfilledSessions(
  sessions: StripeSessionLite[],
  fulfilledSessionIds: Set<string>,
): UnfulfilledSession[] {
  return sessions
    .filter((s) => s.payment_status === 'paid' && !fulfilledSessionIds.has(s.id))
    .map((s) => ({
      sessionId: s.id,
      amountUsd: s.amount_total != null ? s.amount_total / 100 : null,
      purchaseKind: s.purchase_kind ?? null,
    }));
}
