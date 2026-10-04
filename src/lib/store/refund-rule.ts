/**
 * What a Stripe refund or dispute event does to the buyer's access.
 *
 * `charge.refunded` fires for EVERY refund, including a partial one (a goodwill
 * $10 back on a $300 exclusive). Treating each as a full refund revoked the
 * downloads and, for an exclusive, re-listed the track for sale while the buyer
 * still held the license. A partial refund leaves the sale in force; only a
 * refund that returns the whole payment ends it. Disputes always revoke: the
 * money is frozen until the bank rules.
 *
 * An event whose shape we cannot read (neither `refunded` nor both amounts)
 * revokes, as every refund did before this rule: losing a download by mistake
 * is recoverable, handing out files on a refunded sale is not.
 */
export type RefundCharge = {
  refunded?: boolean | null;
  amount?: number | null;
  amount_refunded?: number | null;
};

export type AccessEffect = 'revoke' | 'keep';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function refundAccessEffect(
  eventType: 'charge.refunded' | 'charge.dispute.created',
  charge: RefundCharge,
): AccessEffect {
  if (eventType === 'charge.dispute.created') return 'revoke';
  if (charge.refunded === true) return 'revoke';
  if (isNum(charge.amount) && isNum(charge.amount_refunded)) {
    return charge.amount_refunded >= charge.amount ? 'revoke' : 'keep';
  }
  return charge.refunded === false ? 'keep' : 'revoke';
}
